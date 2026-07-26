"""Dựng `WordTiming` — mốc thời gian từng từ trong một segment.

Hai đường, cùng một đầu ra (khớp `WordTiming` ở `packages/shared/src/types.ts`):

1. **`word_timings_from_phonemes`** — dùng alignment thật của Piper. Piper 1.6
   trả về số mẫu audio cho **từng phoneme**, gộp lại theo ranh giới từ là ra
   mốc thời gian sát thực tế.
2. **`estimate_word_timings`** — chia đều theo độ dài ký tự. Kém chính xác hơn
   rõ rệt, nhưng luôn chạy được.

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
from dataclasses import dataclass

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


def estimate_word_timings(text: str, duration_ms: int) -> list[WordTiming]:
    """Chia thời lượng theo **độ dài ký tự** của từng từ.

    Lưới an toàn khi không có alignment. Phân bổ theo số ký tự của từ chứ không
    chia đều số từ: "Chitose" và "à" rõ ràng không mất cùng một khoảng thời gian.

    Khoảng trắng và dấu câu giữa các từ được tính vào từ **đứng trước** — nhờ
    vậy các mốc nối liền nhau, không có khe hở làm highlight nhấp nháy.
    """
    words = split_words(text)
    if not words or duration_ms <= 0:
        return []

    total_chars = sum(len(w.word) for w in words)
    if total_chars == 0:
        return []

    timings: list[WordTiming] = []
    elapsed = 0.0
    per_char = duration_ms / total_chars

    for index, span in enumerate(words):
        start_ms = int(round(elapsed))
        elapsed += len(span.word) * per_char
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
