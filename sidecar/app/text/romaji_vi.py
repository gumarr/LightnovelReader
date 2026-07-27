"""Chuyển romaji Nhật sang âm tiết tiếng Việt để Piper VI đọc được.

Đây là **tầng 2** trong ba tầng ở plan.md mục 8.1. Từ điển (tầng 1) phủ tên phổ
biến, còn tầng này lo phần đuôi: mỗi bộ LN có tên nhân vật riêng, không từ điển
nào liệt kê hết được — mà yêu cầu là app tự xử lý, không bắt user soạn.

Làm được vì romaji là hệ **rất đều**: khoảng 100 âm tiết mora, ghép theo luật
phụ âm + nguyên âm. Tách được thành mora thì tra bảng là xong.

Rủi ro lớn nhất **không phải bỏ sót mà là nhận nhầm**: `"computer"` đọc theo
luật romaji sẽ thành thứ tệ hơn hẳn để nguyên. Nên `looks_like_romaji` cố tình
chặt tay — bỏ sót thì nghe như hiện tại, nhận nhầm thì phá từ đang đọc đúng.
"""

from __future__ import annotations

import re

# Bảng mora: romaji → âm tiết Việt.
#
# Nguyên tắc chọn chữ: lấy âm tiết tiếng Việt **có thật** và gần nhất về âm,
# không phải chuyển tự máy móc. Piper đọc chữ Việt có thật thì chuẩn, còn gặp
# tổ hợp lạ (`shi`, `tsu`) lại rơi về đoán theo chính tả.
#
# Vài lựa chọn đáng nêu:
# - `tsu` → `xư`: âm /tsɯ/ không có trong tiếng Việt, `xư` gần hơn `su` hay `tu`.
# - `fu` → `phư`: /ɸɯ/ gần `ph` hơn `f` (tiếng Việt không có /f/ tách khỏi /ph/).
# - `ra ri ru re ro` → `ra ri ru rê rô`: âm /ɾ/ Nhật nằm giữa `r` và `l`, nhưng
#   `r` giữ được cảm giác tên Nhật hơn khi nghe.
# - `chi` giữ `chi`, `shi` → `si`: đều đọc đúng, không cần bịa.
MORA_TABLE: dict[str, str] = {
    # Nguyên âm đơn
    "a": "a", "i": "i", "u": "ư", "e": "ê", "o": "ô",
    # K
    "ka": "ca", "ki": "ki", "ku": "cư", "ke": "kê", "ko": "cô",
    "kya": "kia", "kyu": "kiu", "kyo": "kiô",
    # G
    "ga": "ga", "gi": "ghi", "gu": "gư", "ge": "ghê", "go": "gô",
    "gya": "gia", "gyu": "giu", "gyo": "giô",
    # S
    "sa": "xa", "shi": "si", "su": "xư", "se": "xê", "so": "xô",
    "sha": "sa", "shu": "su", "sho": "sô",
    # Z
    "za": "da", "ji": "ji", "zu": "dư", "ze": "dê", "zo": "dô",
    "ja": "ja", "ju": "ju", "jo": "jô",
    # T
    "ta": "ta", "chi": "chi", "tsu": "xư", "te": "tê", "to": "tô",
    "cha": "cha", "chu": "chu", "cho": "chô",
    # D
    "da": "đa", "di": "đi", "du": "đư", "de": "đê", "do": "đô",
    # N
    "na": "na", "ni": "ni", "nu": "nư", "ne": "nê", "no": "nô",
    "nya": "nha", "nyu": "nhu", "nyo": "nhô",
    # H
    "ha": "ha", "hi": "hi", "fu": "phư", "he": "hê", "ho": "hô",
    "hya": "hia", "hyu": "hiu", "hyo": "hiô",
    # B
    "ba": "ba", "bi": "bi", "bu": "bư", "be": "bê", "bo": "bô",
    "bya": "bia", "byu": "biu", "byo": "biô",
    # P
    "pa": "pa", "pi": "pi", "pu": "pư", "pe": "pê", "po": "pô",
    "pya": "pia", "pyu": "piu", "pyo": "piô",
    # M
    "ma": "ma", "mi": "mi", "mu": "mư", "me": "mê", "mo": "mô",
    "mya": "mia", "myu": "miu", "myo": "miô",
    # Y
    "ya": "ia", "yu": "iu", "yo": "iô",
    # R
    "ra": "ra", "ri": "ri", "ru": "ru", "re": "rê", "ro": "rô",
    "rya": "ria", "ryu": "riu", "ryo": "riô",
    # W
    "wa": "goa", "wo": "ô",
    # N cuối — xử lý riêng trong `_split_mora`
    "n": "n",
}

# Tách mora dài trước mora ngắn: `shi` phải khớp trước `s`+`hi`, `tsu` trước `tu`.
_MORA_KEYS = sorted(MORA_TABLE, key=len, reverse=True)

# Trường âm: `ou`/`oo` → `ô` dài, `uu` → `ư`, `ei` → `ê`.
# Piper không kéo dài nguyên âm theo dấu, nên chỉ rút về một âm thay vì lặp chữ.
_LONG_VOWELS = (
    ("ou", "o"),
    ("oo", "o"),
    ("uu", "u"),
    ("ei", "e"),
    ("ee", "e"),
    ("aa", "a"),
    ("ii", "i"),
)

# Phụ âm kép (sokuon): `kk`, `tt`, `pp`, `ss` → nghỉ ngắn trước phụ âm.
# Bỏ hẳn phụ âm đầu thì `Hokkaido` thành `Hô-cai-đô`, mất nhịp ngắt đặc trưng.
_DOUBLE_CONSONANTS = frozenset("kstpgdbjcz")

# Chỉ chữ cái Latin không dấu mới có thể là romaji.
_ROMAJI_SHAPE = re.compile(r"^[a-z]+$")

# Âm tiết tiếng Việt viết không dấu mà hình thái trùng romaji hoàn toàn.
#
# Đây là lớp chặn quan trọng nhất — quan trọng hơn cả lọc tiếng Anh. Text LN
# dịch là tiếng Việt, nên nuốt nhầm một từ Việt xảy ra thường xuyên hơn nhiều
# so với nuốt nhầm tiếng Anh, và hậu quả nặng hơn: `mua` đọc thành "mư-a" giữa
# câu tiếng Việt nghe hỏng hẳn.
#
# Lọc theo chữ hoa (xem `lexicon_jp.lookup`) bắt được phần lớn, nhưng không cứu
# được từ Việt **đứng đầu câu** — `Mua sách...`. Nên cần danh sách này.
#
# Chỉ liệt kê âm tiết **thông dụng và không dấu trùng romaji**. Không cần phủ
# hết tiếng Việt: âm tiết có dấu (`chào`, `nhiều`) đã bị `_ROMAJI_SHAPE` loại,
# còn âm tiết hiếm thì rủi ro gặp thấp hơn rủi ro chặn nhầm tên nhân vật.
_VIETNAMESE_SYLLABLES = frozenset(
    {
        "mua", "ban", "tai", "hai", "cho", "chi", "chu", "nha", "tau",
        "bai", "moi", "gian", "nho", "hieu", "noi", "nhin", "ngu", "ngoi",
        "con", "hoa", "nam", "kia", "cai", "hai", "sao", "sau", "dau",
        "mai", "mat", "tay", "toi", "goi", "hoi", "khi", "kho", "khu",
        "ngay", "nghe", "nhau", "quan", "sang", "tam", "than", "thanh",
        "tien", "tinh", "trong", "truoc", "vao", "vui", "xin", "yeu",
        "buon", "canh", "chan", "danh", "duoc", "gia", "giai", "hanh",
        "hoan", "keo", "lai", "long", "mang", "minh", "muon", "ngon",
        "nguoi", "phai", "qua", "rieng", "song", "tao", "thai", "toan",
        # Âm tiết `-ao`: cần từ khi bỏ chặn nguyên âm đôi `ao` để cứu `Aoi`,
        # `Nao`, `Kaori`. Không có mấy mục này thì `Nào`/`Bao`/`Gạo` viết không
        # dấu đứng đầu câu bị đọc thành `Na-ô`/`Ba-ô`/`Ga-ô`.
        "dao", "mao", "nao", "bao", "gao", "cao", "lao", "rao", "sao", "vao",
        "hao", "chao", "thao", "khao", "ngao", "nhao", "trao", "giao",
    }
)

# Tổ hợp phụ âm không tồn tại trong romaji — dấu hiệu chắc chắn là tiếng Anh.
# `computer` có `mp`, `world` có `rl`, `strong` có `str`.
#
# KHÔNG liệt kê `n` + phụ âm (`nk`, `ns`, `nt`, `nd`, `ng`) dù chúng rất "Anh":
# đó cũng là romaji hợp lệ với `n` mũi — `Shinkansen`, `Ginza`, `Honda`. Chặn ở
# đây thì mất đúng những cái tên phổ biến nhất. Việc loại từ tiếng Anh có `n` +
# phụ âm nhường cho ải 4 (tách mora) và các cụm còn lại trong danh sách này.
_NON_ROMAJI_CLUSTERS = (
    "bl", "br", "cl", "cr", "dr", "fl", "fr", "gl", "gr", "mp", "mb",
    "pl", "pr", "rd", "rl", "rk", "rm", "rn",
    "rt", "sc", "sk", "sl", "sm", "sp", "st", "sw", "tr", "tw",
    "wh", "wr", "ck", "ct", "ft", "ld", "lf", "lk", "lm", "lp", "lt",
    "ph", "th", "gh", "qu", "x", "v", "l",
)

# Đuôi tiếng Anh rất hay gặp trong LN dịch — chặn sớm cho chắc.
_ENGLISH_SUFFIXES = ("ing", "tion", "ment", "ness", "able", "ible", "ous", "ful")

# Nguyên âm đôi không tồn tại trong romaji Hepburn: `ea` (`season`, `reason`),
# `oa`, `ue`. Lưu ý `ai`, `ui`, `oi`, `ei` KHÔNG có ở đây — chúng là romaji
# hợp lệ (`Saitama`, `Sensei`, `Koi`), chặn thì mất tên Nhật thật.
#
# `ao` và `eo` cũng KHÔNG có ở đây dù trông rất "Tây". Đó là hai nguyên âm rời
# đứng cạnh nhau, hoàn toàn hợp lệ: `Aoi`, `Nao`, `Naoki`, `Kaori`, `Naofumi`,
# `Reo`, `Kaoru`, `Aoba`. Đo trên danh sách 291 tên LN thì chặn `ao`/`eo` làm
# mất 6 tên thật — nhiều hơn số từ Tây mà nó cứu được, vì phần lớn từ Tây có
# `ao`/`eo` (`chaos`, `people`, `video`, `theory`) đã chết ở ải 4 rồi.
_NON_ROMAJI_VOWEL_PAIRS = ("ea", "oa", "ue", "iu", "uo")

# Từ tiếng Anh thông dụng mà hình thái trùng romaji hoàn toàn — không luật nào
# tách được, đành liệt kê. `game` và `minute` có cấu trúc y hệt `kane`/`chitose`
# (phụ âm-nguyên âm xen kẽ, kết thúc bằng nguyên âm), nên chỉ chặn được bằng
# cách biết trước mặt chữ.
#
# Danh sách cố tình ngắn: chỉ những từ **thật sự hay gặp** trong LN dịch. Dài
# quá thì rủi ro chặn nhầm tên nhân vật lại tăng.
_ENGLISH_WORDS = frozenset(
    {
        "game", "name", "date", "time", "note", "site", "site", "code",
        "mode", "role", "rate", "line", "side", "size", "type", "case",
        "base", "face", "page", "home", "move", "make", "take", "come",
        "same", "some", "more", "here", "there", "where", "these", "those",
        "minute", "future", "nature", "picture", "figure", "culture",
        "reason", "season", "person", "poison", "prison", "cotton",
        "before", "become", "became", "machine", "medicine", "magazine",
        "senate", "private", "delete", "compete", "concrete",
        # Lọt lưới sau khi bỏ chặn `ao`/`eo` — đều tách mora trọn vẹn nên
        # không luật nào bắt được, đành liệt kê. Chỉ những từ thật sự hay gặp.
        "radio", "audio", "video", "piano", "neon", "rodeo", "romeo", "oreo",
        "studio", "ratio", "stereo", "cameo", "scenario",
    }
)


def _strip_long_vowels(word: str) -> str:
    """Rút gọn trường âm về nguyên âm đơn."""
    for pattern, replacement in _LONG_VOWELS:
        word = word.replace(pattern, replacement)
    return word


def _split_mora(word: str) -> list[str] | None:
    """Tách một từ romaji thành danh sách mora.

    Trả `None` khi gặp ký tự không tách được — nghĩa là từ này **không phải**
    romaji, và nơi gọi phải để nguyên thay vì đọc bừa.
    """
    mora: list[str] = []
    index = 0
    length = len(word)

    while index < length:
        char = word[index]

        # Phụ âm kép: `kk` trong `Hokkaido` → nghỉ ngắn.
        if (
            index + 1 < length
            and char == word[index + 1]
            and char in _DOUBLE_CONSONANTS
        ):
            mora.append("'")
            index += 1
            continue

        # `n` đứng trước phụ âm (hoặc cuối từ) là âm mũi độc lập.
        if char == "n":
            next_char = word[index + 1] if index + 1 < length else ""
            if next_char == "" or next_char not in "aiueoy":
                mora.append("n")
                index += 1
                continue

        for key in _MORA_KEYS:
            if key != "n" and word.startswith(key, index):
                mora.append(key)
                index += len(key)
                break
        else:
            return None

    return mora or None


# Nguyên âm đứng sau gộp vào âm tiết trước thành nguyên âm đôi tiếng Việt:
# `pa` + `i` → `pai` chứ không phải `pa-i`. Tách rời thì Piper đọc thành hai
# nhịp, nghe như đánh vần.
_DIPHTHONG_TAILS = {"i": "i", "ư": "u", "ô": "o", "ê": "e"}

# Nguyên âm kết thúc âm tiết — chỉ những âm tiết này mới nhận được đuôi ghép.
_VOWEL_ENDINGS = "aăâeêioôơuưy"


def _join_mora(mora: list[str]) -> list[str]:
    """Ghép danh sách mora thành các âm tiết tiếng Việt đọc được.

    Ba luật ghép, tất cả đều để tránh Piper đọc rời từng nhịp:

    1. **`n` mũi dính vào âm tiết trước**: `ko`+`n`+`ni` → `Côn-ni` chứ không
       phải `Cô-n-ni`. `n` đứng một mình bị đọc thành tên chữ cái.
    2. **Nguyên âm đôi**: `pa`+`i` → `pai`, `ka`+`i` → `cai`.
    3. **Sokuon** (`'`) nhân đôi phụ âm đầu của âm tiết sau: `ho`+`'`+`ka` →
       `Hốc-ca`, giữ được nhịp ngắt đặc trưng của `Hokkaido`.
    """
    syllables: list[str] = []
    pending_sokuon = False

    for item in mora:
        if item == "'":
            pending_sokuon = True
            continue

        piece = MORA_TABLE[item]

        # Luật 1: `n` mũi dính vào âm tiết liền trước.
        if item == "n" and syllables and syllables[-1][-1:] in _VOWEL_ENDINGS:
            syllables[-1] += "n"
            pending_sokuon = False
            continue

        # Luật 2: nguyên âm đơn đứng sau gộp thành nguyên âm đôi.
        if (
            not pending_sokuon
            and item in _DIPHTHONG_TAILS
            and syllables
            and syllables[-1][-1:] in _VOWEL_ENDINGS
            and len(syllables[-1]) <= 3
        ):
            syllables[-1] += _DIPHTHONG_TAILS[item]
            continue

        # Luật 3: sokuon — đóng âm tiết trước bằng phụ âm đầu của âm tiết này.
        if pending_sokuon and syllables and piece:
            first = piece[0]
            if first not in _VOWEL_ENDINGS:
                # `c`/`k` đóng âm tiết trong tiếng Việt luôn viết `c`.
                syllables[-1] += "c" if first in "ck" else first
            pending_sokuon = False

        syllables.append(piece)

    return syllables


def looks_like_romaji(word: str) -> bool:
    """Đoán xem `word` có phải tên Nhật viết bằng romaji không.

    Cố tình **chặt tay**. Bốn cửa ải, qua hết mới nhận:

    1. Chỉ chữ cái Latin không dấu, dài 3–20 ký tự. Từ 1–2 ký tự quá mơ hồ.
    2. Không chứa `l`, `v`, `x`, `q` — romaji Hepburn không dùng.
    3. Không chứa tổ hợp phụ âm kiểu tiếng Anh, không có đuôi tiếng Anh.
    4. Tách được trọn vẹn thành mora.

    Ải 3 là ải quan trọng nhất: nó loại `computer`, `strong`, `world` — những từ
    tiếng Anh mà ải 4 vẫn có thể tách nhầm.
    """
    lowered = word.lower()

    if not _ROMAJI_SHAPE.match(lowered) or not 3 <= len(lowered) <= 20:
        return False

    if any(bad in lowered for bad in ("l", "v", "x", "q")):
        return False

    if lowered in _VIETNAMESE_SYLLABLES or lowered in _ENGLISH_WORDS:
        return False

    if any(lowered.endswith(suffix) for suffix in _ENGLISH_SUFFIXES):
        return False

    if any(pair in lowered for pair in _NON_ROMAJI_VOWEL_PAIRS):
        return False

    # Bỏ trường âm trước khi soi tổ hợp phụ âm: `ou`/`ei` là romaji hợp lệ.
    probe = _strip_long_vowels(lowered)
    for cluster in _NON_ROMAJI_CLUSTERS:
        if cluster in probe:
            # Phụ âm kép hợp lệ (`kk`, `tt`, `ss`, `pp`) không tính là tổ hợp lạ.
            if len(cluster) == 2 and cluster[0] == cluster[1]:
                continue
            return False

    return _split_mora(probe) is not None


def romaji_to_vi(word: str) -> str | None:
    """Chuyển một từ romaji thành chuỗi âm tiết Việt nối bằng gạch nối.

    Trả `None` nếu không phải romaji — nơi gọi giữ nguyên từ gốc.

    Dùng **gạch nối** chứ không phải dấu cách: `Tô-ki-ô` giữ nhịp một-từ, còn
    `Tô ki ô` khiến Piper chèn khoảng nghỉ giữa các âm tiết, nghe rời rạc.
    """
    if not looks_like_romaji(word):
        return None

    mora = _split_mora(_strip_long_vowels(word.lower()))
    if mora is None:
        return None

    syllables = _join_mora(mora)
    if not syllables:
        return None

    result = "-".join(syllables)
    # Giữ chữ hoa đầu để câu vẫn đúng chính tả khi nhìn log.
    if word[:1].isupper():
        result = result[:1].upper() + result[1:]
    return result
