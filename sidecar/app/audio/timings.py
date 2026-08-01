"""Dựng `WordTiming` — mốc thời gian từng từ trong một segment.

Hai đường, cùng một đầu ra (khớp `WordTiming` ở `packages/shared/src/types.ts`):

1. **`word_timings_from_phonemes`** — dùng alignment thật của Piper. Piper 1.6
   trả về số mẫu audio cho **từng phoneme**, gộp lại theo ranh giới từ là ra
   mốc thời gian sát thực tế.
2. **`estimate_word_timings`** — chia theo **số âm tiết**. Kém chính xác hơn,
   nhưng luôn chạy được.

**P6.1 đã đổi (2) từ đếm ký tự sang đếm âm tiết.** Đo bằng
`sidecar/probe/timing_probe.py` trên voice thật, lấy đường (1) làm chuẩn vàng:
lệch trung bình **126.6 → 60.4 ms (−52%)**, tỉ lệ từ lệch quá 150 ms
**27.4% → 8.4%**. Sàn lý thuyết của mô hình chỉ-đếm-âm-tiết là ~55 ms, nên
đường (2) hiện đã sát giới hạn — muốn tốt hơn nữa phải biết nội dung ngữ âm của
từng từ, tức là quay lại forced alignment (đã loại, xem plan.md).

**Vì sao vẫn giữ đường (2).** Alignment cần model được vá (`include_alignments`)
và package `onnx`. Piper **không ném lỗi** khi thiếu — nó chỉ ghi log rồi trả
`None`. Nên đường (2) là lưới an toàn, và đó cũng là lý do `synthesize` báo rõ
đã dùng đường nào (`timingSource`) thay vì im lặng.

Cả hai đều cho `alignStatus = 'estimated'`. Chỉ CTC forced alignment ở Phase 4
mới được nâng lên `'aligned'` — đường (1) chính xác hơn (2) nhiều nhưng vẫn là
độ dài phoneme do chính model sinh ra, không phải đo trên audio thật.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass, replace

from app.text.mapping import NormalizedText

# Một "từ" để highlight. Bắt cả chữ có dấu tiếng Việt và số.
#
# Dùng `\w` với cờ UNICODE thay vì liệt kê dải chữ cái: `[a-zA-Z]` sẽ cắt
# "Chitose" ra khỏi "trở" và làm vỡ mọi từ có dấu.
_WORD_PATTERN = re.compile(r"\w+(?:['’]\w+)*", re.UNICODE)

# Phoneme của espeak dùng các ký tự này làm ranh giới từ / dấu nhấn, không phải
# âm thật. Chúng vẫn chiếm thời lượng nên KHÔNG bỏ đi khi cộng dồn — chỉ không
# tính vào việc "phoneme này thuộc từ nào".
_WORD_BREAK_PHONEMES = frozenset({" ", "^", "$", "\n"})


@dataclass(frozen=True)
class WordSpan:
    """Vị trí một từ trong `text` gốc. `char_start`/`char_end` để UI tô đúng chỗ."""

    word: str
    char_start: int
    char_end: int


@dataclass(frozen=True)
class WordTiming:
    """Khớp `WordTiming` bên TypeScript — tên field giữ nguyên `w` cho gọn file."""

    w: str
    start_ms: int
    end_ms: int
    char_start: int
    char_end: int


def split_words(text: str) -> list[WordSpan]:
    """Tách từ kèm vị trí ký tự.

    Giữ **vị trí trong chuỗi gốc** chứ không chỉ trả danh sách từ: UI cần
    `charStart`/`charEnd` để tô đúng đoạn text đang đọc, mà tính ngược lại từ
    danh sách từ sẽ sai ngay khi có dấu câu hoặc khoảng trắng đôi.
    """
    return [
        WordSpan(word=m.group(0), char_start=m.start(), char_end=m.end())
        for m in _WORD_PATTERN.finditer(text)
    ]


def count_syllables_vi(word: str) -> int:  # noqa: ARG001 — giữ cho khớp `Estimator`
    """Số âm tiết của một từ tiếng Việt — gần như luôn là 1.

    Tiếng Việt là ngôn ngữ **đơn âm tiết**: mỗi từ chính tả là một âm tiết, đọc
    hết gần như cùng một khoảng thời gian bất kể viết ra mấy chữ cái. `nghiêng`
    (7 ký tự) và `à` (1 ký tự) mất thời gian đọc xấp xỉ nhau.

    **Gần như luôn trả 1**, và đó là chủ ý chứ không phải hàm chưa làm xong.

    Không xử lý gạch nối ở đây: `_WORD_PATTERN` **không** nhận `-`, nên
    `"Tô-ki-ô"` đã bị `split_words` tách sẵn thành ba từ trước khi tới đây, mỗi
    từ một âm tiết — đúng như mong muốn. Thêm nhánh tách gạch nối sẽ là code
    chết. Dấu nháy thì ngược lại: `_WORD_PATTERN` giữ `"don't"` thành một token,
    nhưng với tiếng Việt đó vẫn là một âm tiết.
    """
    return 1


def count_syllables_en(word: str) -> int:
    """Ước lượng âm tiết tiếng Anh bằng cụm nguyên âm.

    Đếm số **cụm** nguyên âm liền nhau: `international` → in-ter-na-tio-nal.
    Không chính xác tuyệt đối (`queue` đếm 2, thực tế 1) nhưng bám sát thời gian
    đọc hơn hẳn đếm ký tự, và không cần từ điển phát âm.

    `e` câm cuối từ bị trừ đi (`make` → 1, không phải 2), trừ khi trừ xong còn 0.
    """
    lowered = word.lower()
    groups = re.findall(r"[aeiouy]+", lowered)
    count = len(groups)
    if count > 1 and lowered.endswith("e") and not lowered.endswith(("le", "ee", "ye")):
        count -= 1
    return max(count, 1)


# Trọng số âm tiết theo ngôn ngữ. Thêm ngôn ngữ = thêm một dòng, khớp cách
# `app/text/__init__.py` đăng ký normalizer.
_SYLLABLE_COUNTERS: dict[str, Callable[[str], int]] = {
    "vi": count_syllables_vi,
    "en": count_syllables_en,
}

# Từ **cuối segment** đọc dài hơn các từ giữa. Đây là hiện tượng ngữ âm có thật
# (phrase-final lengthening): người đọc — và model học theo người — kéo dài âm
# cuối trước khi ngắt hơi.
#
# Trên 10 segment thật, tỉ lệ "thời lượng từ cuối / trung bình từ giữa" nằm
# trong khoảng 1.08–1.49 (trung bình 1.32) và **không segment nào** đi ngược
# chiều — hiện tượng có thật, không phải nhiễu.
#
# Nhưng giá trị dùng ở đây là **1.22**, không phải 1.32. Hai con số trả lời hai
# câu hỏi khác nhau: 1.32 là tỉ lệ trung bình quan sát được, còn 1.22 là hệ số
# **cực tiểu hoá sai số thực tế** khi quét toàn dải trên cùng tập segment. Lấy
# trung bình quan sát nghe hợp lý hơn nhưng đo ra tệ hơn, vì sai số bị lệch bởi
# vài segment có từ cuối rất dài. Ta tối ưu cho cái đo được, không cho cái nghe
# xuôi tai.
#
# Bỏ hệ số này thì mọi từ giữa segment bị cấp dư một chút, cộng dồn lại đẩy phần
# cuối segment sớm dần — đúng kiểu lỗi trôi mà mắt bắt được.
_FINAL_WORD_STRETCH = 1.22

# **KHÔNG có trọng số nghỉ cho dấu câu.** Đây là kết luận từ phép đo, không
# phải thiếu sót — đừng "bổ sung" lại.
#
# Trực giác nói dấu phẩy nghỉ ~100–200 ms, và bản đầu của P6.1 có cấp thêm
# thời lượng cho dấu câu. Đo trên alignment thật của Piper (10 segment, 12 dấu
# phẩy, cùng các dấu kết câu) thì khoảng nghỉ **luôn đúng bằng 0 ms**.
#
# Lý do là cấu trúc: `group_phonemes_by_word` gộp khoảng lặng vào từ liền kề,
# nên thời gian nghỉ **đã nằm trong** thời lượng của chính từ đó và không bao
# giờ hiện ra thành khe hở. Cấp thêm một lần nữa là tính hai lần — nó ăn bớt
# thời lượng của các từ còn lại và đẩy toàn bộ phần sau của segment sớm dần.
#
# Đo được: bản có trọng số nghỉ làm 11/95 từ tệ đi quá 50 ms so với bản cũ, tệ
# nhất −242 ms, dù trung bình vẫn đẹp. Bỏ nó đi thì còn 0 từ.
def estimate_word_timings(
    text: str, duration_ms: int, lang: str = "vi"
) -> list[WordTiming]:
    """Chia thời lượng theo **số âm tiết** của từng từ.

    Lưới an toàn khi không có alignment thật.

    **Vì sao âm tiết chứ không phải ký tự.** Bản trước chia theo độ dài ký tự,
    đúng về mặt "từ dài đọc lâu hơn" nhưng sai đơn vị với tiếng Việt: `nghiêng`
    được cấp 13% thời lượng segment trong khi `à` chỉ được 1.9%, dù thực tế hai
    từ đọc gần bằng nhau (~7%). Trên segment 10 giây đó là lệch ~580 ms cho một
    từ — mắt thấy rõ. Đo bằng `sidecar/probe/timing_probe.py`.

    **Vì sao vẫn nhận `lang`.** Đếm âm tiết ≈ đếm từ chỉ đúng với ngôn ngữ đơn
    âm tiết. Tiếng Anh `"international"` (5 âm tiết) và `"a"` (1) thì áp trọng số
    1-1 sẽ tệ hơn hẳn đếm ký tự, nên mỗi ngôn ngữ có hàm đếm riêng.

    Ba tính chất của bản cũ **giữ nguyên** (đã đúng, đừng "sửa"):

    - Khoảng trắng và dấu câu thuộc về từ **đứng trước** → mốc nối liền nhau,
      không có khe hở làm highlight nhấp nháy.
    - Từ cuối chốt đúng `duration_ms` → sai số không tích luỹ.
    - Trả `[]` khi không có từ nào hoặc `duration_ms <= 0`.
    """
    words = split_words(text)
    if not words or duration_ms <= 0:
        return []

    counter = _SYLLABLE_COUNTERS.get(lang.lower(), count_syllables_vi)

    # Trọng số mỗi từ = số âm tiết của nó. Không cộng gì cho dấu câu đi kèm —
    # xem chú thích "KHÔNG có trọng số nghỉ cho dấu câu" phía trên.
    weights = [float(counter(span.word)) for span in words]
    # Từ cuối kéo dài hơn — xem `_FINAL_WORD_STRETCH`.
    weights[-1] *= _FINAL_WORD_STRETCH
    total_weight = sum(weights)
    if total_weight <= 0:
        return []

    timings: list[WordTiming] = []
    elapsed = 0.0
    per_weight = duration_ms / total_weight

    for index, span in enumerate(words):
        start_ms = int(round(elapsed))
        elapsed += weights[index] * per_weight
        # Từ cuối chốt đúng `duration_ms` để không thừa/thiếu vài ms do làm tròn.
        end_ms = duration_ms if index == len(words) - 1 else int(round(elapsed))
        timings.append(
            WordTiming(
                w=span.word,
                start_ms=start_ms,
                end_ms=max(end_ms, start_ms),
                char_start=span.char_start,
                char_end=span.char_end,
            )
        )

    return timings


def group_phonemes_by_word(
    phonemes: list[str], samples_per_phoneme: list[int]
) -> list[int]:
    """Gộp phoneme thành từng nhóm-một-từ, trả về tổng số mẫu mỗi nhóm.

    espeak sinh phoneme theo thứ tự đọc, ngăn cách bằng khoảng trắng. Ký tự
    ranh giới (`^`, `$`, khoảng trắng) vẫn **chiếm thời lượng thật** nên số mẫu
    của chúng phải được cộng vào một nhóm nào đó — bỏ đi thì tổng thời lượng
    ngắn hơn audio và mọi mốc phía sau bị trôi dần.
    """
    groups: list[int] = []
    current = 0
    started = False

    for phoneme, samples in zip(phonemes, samples_per_phoneme, strict=True):
        if phoneme in _WORD_BREAK_PHONEMES:
            if started:
                groups.append(current)
                current = 0
                started = False
            # Khoảng lặng trước từ kế tiếp gộp vào chính từ đó.
            current += int(samples)
            continue
        started = True
        current += int(samples)

    if started:
        groups.append(current)

    return groups


@dataclass(frozen=True)
class PhonemeChunk:
    """Một câu do Piper tổng hợp: phoneme + số mẫu, đã khớp độ dài."""

    phonemes: list[str]
    samples_per_phoneme: list[int]


def word_timings_from_phonemes(
    text: str,
    chunks: list[PhonemeChunk],
    sample_rate: int,
) -> list[WordTiming]:
    """Gộp thời lượng phoneme thành thời lượng từ, trên **toàn bộ segment**.

    Nhận danh sách chunk chứ không phải một mảng phoneme phẳng: Piper tổng hợp
    **mỗi câu một chunk**, nên một segment 1–3 câu sẽ có nhiều chunk nối tiếp
    nhau. Bản đầu chỉ nhận một chunk rồi so với số từ của cả segment, nên câu
    `"Ừ. À. Ồ."` (3 chunk, mỗi chunk 1 từ) luôn lệch và rơi về ước lượng —
    trong khi alignment hoàn toàn dùng được.

    Trả `[]` khi không khớp để nơi gọi rơi về `estimate_word_timings`. Cố đoán
    khi số nhóm lệch số từ sẽ gán lệch một nhịp cho **mọi** từ phía sau, tệ hơn
    hẳn ước lượng đều.
    """
    if sample_rate <= 0 or not chunks:
        return []

    words = split_words(text)
    if not words:
        return []

    groups: list[int] = []
    for chunk in chunks:
        if len(chunk.phonemes) != len(chunk.samples_per_phoneme):
            # Hợp đồng của Piper bị vi phạm — alignment hỏng, đừng đoán tiếp.
            return []
        groups.extend(group_phonemes_by_word(chunk.phonemes, chunk.samples_per_phoneme))

    # Số nhóm phải khớp số từ. Lệch là do espeak tách khác regex của ta: chữ số
    # đọc thành nhiều từ (`30` → "ba mươi"), hoặc mã như `A2` đọc thành hai từ.
    if len(groups) != len(words):
        return []

    timings: list[WordTiming] = []
    elapsed_samples = 0

    for span, group_samples in zip(words, groups, strict=True):
        start_ms = round(elapsed_samples * 1000 / sample_rate)
        elapsed_samples += group_samples
        end_ms = round(elapsed_samples * 1000 / sample_rate)
        timings.append(
            WordTiming(
                w=span.word,
                start_ms=start_ms,
                end_ms=max(end_ms, start_ms),
                char_start=span.char_start,
                char_end=span.char_end,
            )
        )

    return timings


def remap_to_source(
    timings: list[WordTiming], normalized: NormalizedText
) -> list[WordTiming]:
    """Quy `char_start`/`char_end` từ text **đã chuẩn hoá** về text **gốc**.

    Timing sinh ra trên bản đọc (`"Tô-ki-ô"`), nhưng UI tô chữ trên bản gốc
    (`"Tokyo"`) — thứ user đang nhìn. Không quy ngược thì highlight lệch ngay ở
    câu đầu tiên có tên riêng hoặc chữ số.

    Giữ nguyên `w` là **từ đã đọc**, không đổi thành từ gốc: `w` dùng để kiểm
    tra và ghi log, còn cái UI cần là cặp offset. Đổi `w` sẽ che mất thông tin
    "Piper thực sự đọc gì" — đúng thứ cần khi truy lỗi phát âm.

    Nhiều từ đọc có thể trỏ về **cùng một** từ gốc (`"Tô"`, `"ki"`, `"ô"` đều
    về `"Tokyo"`). Đó là đúng chủ ý: cả từ gốc sáng lên trong suốt thời gian
    đọc mọi mảnh của nó, thay vì tô nham nhở từng phần.
    """
    if not normalized.spans:
        return timings

    remapped: list[WordTiming] = []
    for timing in timings:
        char_start, char_end = normalized.to_source_range(
            timing.char_start, timing.char_end
        )
        remapped.append(replace(timing, char_start=char_start, char_end=char_end))

    return remapped
