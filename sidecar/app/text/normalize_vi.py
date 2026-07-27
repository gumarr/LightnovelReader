"""Chuẩn hoá text tiếng Việt trước khi đưa vào TTS.

Mỗi luật là một hàm thuần riêng, có test riêng (xem `tests/test_normalize_vi.py`).
Thứ tự áp dụng trong `normalize_vi` là bắt buộc — xem chú thích ở đó.

Nguyên tắc: chỉ đổi thứ Piper đọc sai. Piper đọc chữ thường tốt, nên đụng càng
ít vào chữ càng an toàn. Rủi ro lớn nhất không phải "bỏ sót" mà là "sửa nhầm
chữ đang đúng".
"""

from __future__ import annotations

import re

from .lexicon_jp import transcribe_japanese
from .mapping import NormalizedText, compose, diff_to_normalized, identity
from .numbers_vi import (
    decimal_to_words,
    digits_to_words,
    integer_to_words,
    number_text_to_words,
)

# --- Ký hiệu đọc thành chữ ---------------------------------------------------

# Chỉ những ký hiệu mà Piper đọc trượt hẳn. `&` `+` `=` giữ nguyên nếu đứng
# trong công thức thì nghe lạ, nhưng trong LN chúng gần như luôn là văn xuôi.
SYMBOL_WORDS: dict[str, str] = {
    "%": "phần trăm",
    "&": "và",
    "@": "a còng",
    "°C": "độ C",
    "°F": "độ F",
    "km/h": "ki lô mét trên giờ",
    "m/s": "mét trên giây",
}

# Viết tắt hay gặp trong LN dịch. Chỉ nhận khi đứng riêng thành từ.
ABBREVIATIONS: dict[str, str] = {
    "TP": "thành phố",
    "TP.": "thành phố",
    "ĐH": "đại học",
    "THPT": "trung học phổ thông",
    "THCS": "trung học cơ sở",
    "vd": "ví dụ",
    "v.v": "vân vân",
    "v.v.": "vân vân",
    "tp": "thành phố",
}

MONTH_WORD = "tháng"
DAY_WORD = "ngày"
YEAR_WORD = "năm"


def collapse_whitespace(text: str) -> str:
    """Gộp mọi khoảng trắng liên tiếp thành một dấu cách, bỏ đầu/cuối.

    Text từ PDF hay có khoảng trắng kép và tab; TTS coi chúng là ngắt nghỉ
    khiến câu nghe giật.
    """
    return re.sub(r"\s+", " ", text).strip()


def normalize_quotes(text: str) -> str:
    """Đưa dấu nháy/ngoặc kép kiểu sách về dạng thẳng.

    LN dịch dùng lẫn lộn “ ” ‘ ’ 「 」 『 』 « ». Piper đọc phần lớn là im lặng
    nhưng một số ký tự lại thành tiếng lạ, nên chuẩn hoá hết về " và '.
    """
    mapping = {
        "“": '"',
        "”": '"',
        "„": '"',
        "«": '"',
        "»": '"',
        "「": '"',
        "」": '"',
        "『": '"',
        "』": '"',
        "‘": "'",
        "’": "'",
        "‚": "'",
    }
    return text.translate(str.maketrans(mapping))


def normalize_dashes(text: str) -> str:
    """Gạch dài/gạch ngang thoại → gạch thường có khoảng trắng hai bên.

    `—Cậu ổn chứ?` phải thành `- Cậu ổn chứ?`, nếu không Piper dính gạch vào
    từ đầu câu và đọc chệch.
    """
    # Gạch dài lặp (`——`) là lối kéo dài giọng rất hay gặp trong LN. Gộp về
    # MỘT gạch: để `--` thì Piper có thể phát thành tiếng thay vì ngắt nghỉ.
    text = re.sub(r"[—―–]+", "-", text)
    # Gạch dính liền chữ ở đầu vế thoại
    text = re.sub(r"(^|[\s\"'(])-(?=\S)", r"\1- ", text)
    return text


def strip_decorative_chars(text: str) -> str:
    """Bỏ ký tự trang trí không mang nghĩa đọc.

    LN hay có `♪`, `★`, `…` lặp, dòng phân cách `＊＊＊`. Piper đọc chúng thành
    tiếng ú ớ hoặc im bặt giữa câu.
    """
    text = re.sub(r"[★☆♪♫◆◇【】＊]+", " ", text)
    # Dãy dấu chấm/sao dùng làm đường phân cách
    text = re.sub(r"(?:\s*[*.…]){4,}\s*", " ", text)
    return text


def expand_symbols(text: str) -> str:
    """Đổi ký hiệu thành chữ đọc được.

    Sắp xếp theo độ dài giảm dần để `km/h` khớp trước `/`, `°C` trước `°`.
    """
    for symbol in sorted(SYMBOL_WORDS, key=len, reverse=True):
        word = SYMBOL_WORDS[symbol]
        # `%` phải dính ngay sau số mới đổi ("50%"), đứng lẻ thì để nguyên
        if symbol == "%":
            text = re.sub(r"(?<=\d)\s*%", f" {word}", text)
        else:
            text = text.replace(symbol, f" {word} " if symbol.isalnum() else f" {word}")
    return text


def expand_abbreviations(text: str) -> str:
    """Mở viết tắt. Chỉ khớp khi đứng riêng thành từ."""

    def replace(match: re.Match[str]) -> str:
        word = match.group(0)
        expanded = ABBREVIATIONS.get(word, ABBREVIATIONS.get(word.rstrip("."), word))

        # Dấu chấm cuối câu bị nuốt mất là mất luôn ranh giới câu — TTS đọc
        # dính sang câu sau. `TP.` cuối chuỗi ("...học sinh của TP.") chỉ có
        # MỘT dấu chấm làm cả hai việc, phải trả lại.
        #
        # Chỉ xét cuối chuỗi, KHÔNG đoán theo "chữ sau viết hoa": `TP. Hồ Chí
        # Minh` và `sống ở TP. Rồi đi.` giống hệt nhau ở dấu hiệu đó, mà đoán
        # sai vế đầu thì chẻ đôi một địa danh. Segmenter đã cắt text theo câu
        # trước khi tới đây, nên "cuối chuỗi" gần như luôn là cuối câu thật.
        if word.endswith(".") and expanded != word and text[match.end() :].strip() == "":
            return f"{expanded}."
        return expanded

    pattern = "|".join(
        sorted((re.escape(key) for key in ABBREVIATIONS), key=len, reverse=True)
    )
    return re.sub(rf"(?<![\w.])(?:{pattern})(?![\w])", replace, text)


def expand_dates(text: str) -> str:
    """Đọc ngày tháng dạng `12/3/2024`, `12/3` và `12-3-2024`.

    Ngày Việt Nam là ngày/tháng/năm. Chỉ nhận khi tháng ≤ 12 và ngày ≤ 31 —
    ngoài khoảng đó thì đây là phân số hoặc tỉ số, để luật khác lo.

    **Dấu `-` chỉ tính là ngày khi có năm 4 chữ số đi kèm.** Chạy trên sách
    thật mới lộ ra: LN Nhật ghi lớp học kiểu `lớp 11-5`, `Class 2-5` (khối-lớp)
    và nó khớp regex ngày y hệt — cả hai cuốn mẫu đều dính, đọc thành
    "lớp ngày mười một tháng năm". Dạng `11-5` trong LN gần như luôn là lớp,
    tỉ số hay khoảng, còn ngày viết bằng `-` mà không có năm thì hiếm.
    Dấu `/` thì vẫn nhận cả khi không có năm — `12/3` hầu như chỉ là ngày.
    """

    def replace(match: re.Match[str]) -> str:
        day = match.group("d") or match.group("d2")
        month = match.group("m") or match.group("m2")
        year = match.group("y") or match.group("y2")
        if not (1 <= int(day) <= 31 and 1 <= int(month) <= 12):
            return match.group(0)

        # Câu văn thường đã có sẵn chữ "ngày" ("Hẹn ngày 12/3") — thêm nữa
        # thành "ngày ngày mười hai". Chỉ chèn khi phía trước chưa có.
        # `integer_to_words` chứ không phải `number_text_to_words`: ngày/tháng
        # hay được đệm 0 (`05/06`), mà hàm kia coi số 0 đứng đầu là mã định danh.
        parts: list[str] = []
        if not re.search(rf"\b{DAY_WORD}\s*$", text[: match.start()], flags=re.IGNORECASE):
            parts.append(DAY_WORD)
        parts += [integer_to_words(int(day)), MONTH_WORD, integer_to_words(int(month))]
        if year:
            parts += [YEAR_WORD, integer_to_words(int(year))]
        return " ".join(parts)

    # Hai dạng riêng biệt: `/` nhận cả khi thiếu năm, `-` bắt buộc có năm.
    return re.sub(
        r"(?<!\d)(?:"
        r"(?P<d>\d{1,2})/(?P<m>\d{1,2})(?:/(?P<y>\d{4}))?"
        r"|(?P<d2>\d{1,2})-(?P<m2>\d{1,2})-(?P<y2>\d{4})"
        r")(?!\d)",
        replace,
        text,
    )


def expand_times(text: str) -> str:
    """Đọc giờ dạng `14:30` và `14:30:05`.

    Dùng `integer_to_words` chứ không phải `number_text_to_words`: giờ/phút
    /giây luôn đệm số 0 cho đủ hai chữ số, mà `number_text_to_words` lại coi
    số 0 đứng đầu là mã định danh → `01:02` đọc thành "không một giờ không hai".
    """

    def replace(match: re.Match[str]) -> str:
        hour, minute, second = match.group("h"), match.group("mi"), match.group("s")
        if int(hour) > 23 or int(minute) > 59:
            return match.group(0)
        parts = [integer_to_words(int(hour)), "giờ"]
        if int(minute) != 0:
            parts += [integer_to_words(int(minute)), "phút"]
        if second is not None:
            if int(second) > 59:
                return match.group(0)
            parts += [integer_to_words(int(second)), "giây"]
        return " ".join(parts)

    return re.sub(
        r"(?<!\d)(?P<h>\d{1,2}):(?P<mi>\d{2})(?::(?P<s>\d{2}))?(?!\d)",
        replace,
        text,
    )


def expand_numbers(text: str) -> str:
    """Đọc số còn lại thành chữ.

    Chạy SAU ngày/giờ, nếu không `12/3` đã bị đọc thành "mười hai trên ba".

    Bốn dạng, theo thứ tự ưu tiên:
    - `1.234.567` / `1,234,567` → bỏ dấu phân nhóm rồi đọc như số nguyên
    - `3,14` / `3.14` → số thập phân
    - `1975` đứng sau "năm" → đọc rời từng chữ số ("một chín bảy năm")
    - còn lại → số nguyên
    """
    # Dấu phân nhóm hàng nghìn: nhóm 3 chữ số lặp lại
    text = re.sub(
        r"(?<!\d)(\d{1,3}(?:([.,])\d{3})+)(?!\d)",
        lambda m: number_text_to_words(re.sub(r"[.,]", "", m.group(1))),
        text,
    )

    # Thập phân
    text = re.sub(
        r"(?<!\d)(\d+)[.,](\d+)(?!\d)",
        lambda m: decimal_to_words(m.group(1), m.group(2)),
        text,
    )

    # Năm: "năm 1975" đọc rời chữ số nghe tự nhiên hơn "một nghìn chín trăm..."
    text = re.sub(
        r"\b(năm)\s+(1[0-9]{3}|20[0-9]{2})(?!\d)",
        lambda m: f"{m.group(1)} {digits_to_words(m.group(2))}",
        text,
        flags=re.IGNORECASE,
    )

    # Số nguyên còn lại
    text = re.sub(r"(?<![\w])(\d+)(?![\w])", lambda m: number_text_to_words(m.group(1)), text)
    return text


def normalize_vi(text: str) -> str:
    """Pipeline chuẩn hoá tiếng Việt. Thứ tự bắt buộc.

    1. `normalize_quotes` / `normalize_dashes` / `strip_decorative_chars` —
       dọn ký tự lạ trước để các luật sau khớp được regex.
    2. `transcribe_japanese` sớm, ngay sau khi dọn ký tự: tên riêng phải được
       thay khi còn nguyên mặt chữ Latin. Chạy sau `expand_numbers` thì
       `Class 2-5` đã thành chữ và không còn nhận ra token nào nữa.
    3. `expand_abbreviations` trước `expand_numbers`: `v.v.` chứa dấu chấm,
       để số chạy trước thì dấu chấm đã bị coi là dấu thập phân.
    4. `expand_dates` / `expand_times` trước `expand_numbers`: cả hai đều ăn
       chữ số, chạy sau thì không còn số nguyên vẹn để nhận dạng.
    5. `collapse_whitespace` cuối cùng — các luật trên đều chèn dấu cách.

    Trả `str` để giữ nguyên hợp đồng cũ. Nơi nào cần ánh xạ offset về text gốc
    (để highlight bám đúng chữ) thì gọi `normalize_vi_mapped`.
    """
    return normalize_vi_mapped(text).spoken


def normalize_vi_mapped(
    text: str, overrides: dict[str, str] | None = None
) -> NormalizedText:
    """Như `normalize_vi` nhưng trả kèm **đường quy ngược về text gốc**.

    Vì sao cần: TTS đọc bản đã chuẩn hoá, nên mốc thời gian bám theo bản đó.
    Nhưng UI tô chữ trên bản gốc — thứ user đang nhìn. Xem `mapping.py` và
    plan.md mục 8.1.

    Cách lấy mapping: các hàm luật đều là `str -> str` viết bằng regex, không
    tự khai báo được mình đã đổi khoảng nào. Thay vì viết lại cả tám hàm, ta
    **suy ngược** bằng cách so chuỗi vào với chuỗi ra (`diff_to_normalized`).
    Nhờ vậy luật thêm về sau tự động có mapping đúng mà không phải sửa gì.

    Riêng `transcribe_japanese` tự sinh mapping chính xác nên dùng thẳng, không
    phải suy ngược — đây cũng là bước gây sai lệch nhiều nhất.
    """
    stage = identity(text)

    for rule in (normalize_quotes, normalize_dashes, strip_decorative_chars):
        stage = compose(stage, diff_to_normalized(stage.spoken, rule(stage.spoken)))

    # Tên riêng Nhật: bước duy nhất có mapping chính xác thay vì suy ngược.
    stage = compose(stage, transcribe_japanese(stage.spoken, overrides))

    for rule in (
        expand_symbols,
        expand_abbreviations,
        expand_dates,
        expand_times,
        expand_numbers,
        collapse_whitespace,
    ):
        stage = compose(stage, diff_to_normalized(stage.spoken, rule(stage.spoken)))

    return stage
