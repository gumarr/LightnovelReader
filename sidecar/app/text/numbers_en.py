"""Đọc số thành chữ tiếng Anh.

Không dùng thư viện ngoài (`num2words`) vì phần cần dùng chỉ vài chục dòng,
mà thêm dependency thì phải kéo theo cả bộ locale không bao giờ chạm tới.
"""

from __future__ import annotations

ONES = (
    "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
    "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
    "seventeen", "eighteen", "nineteen",
)

TENS = ("", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety")

SCALES = ("", "thousand", "million", "billion", "trillion")

MAX_SPELLED_DIGITS = 15


def _under_thousand(value: int) -> list[str]:
    words: list[str] = []
    hundreds, rest = divmod(value, 100)
    if hundreds:
        words += [ONES[hundreds], "hundred"]
    if rest == 0:
        return words
    if words:
        words.append("and")  # "one hundred and five" — kiểu Anh, hợp LN dịch
    if rest < 20:
        words.append(ONES[rest])
    else:
        tens, ones = divmod(rest, 10)
        words.append(TENS[tens] if ones == 0 else f"{TENS[tens]}-{ONES[ones]}")
    return words


def integer_to_words(value: int) -> str:
    if value < 0:
        return f"minus {integer_to_words(-value)}"
    if value < 20:
        return ONES[value]

    groups: list[int] = []
    remaining = value
    while remaining > 0:
        remaining, group = divmod(remaining, 1000)
        groups.append(group)

    if len(groups) > len(SCALES):
        return digits_to_words(str(value))

    words: list[str] = []
    for position in range(len(groups) - 1, -1, -1):
        group = groups[position]
        if group == 0:
            continue
        # "two thousand and five": kiểu Anh chèn "and" trước nhóm cuối khi
        # nhóm đó dưới 100. Nhóm ≥ 100 thì "and" đã nằm sẵn bên trong
        # `_under_thousand` ("one hundred and five"), thêm nữa là thừa.
        if words and position == 0 and group < 100:
            words.append("and")
        words += _under_thousand(group)
        if SCALES[position]:
            words.append(SCALES[position])
    return " ".join(words)


def digits_to_words(digits: str) -> str:
    """Đọc rời từng chữ số — mã số, số điện thoại."""
    return " ".join(ONES[int(ch)] for ch in digits if ch.isdigit())


def year_to_words(year: int) -> str:
    """Đọc năm kiểu Anh: 1975 → "nineteen seventy-five".

    2000–2009 đọc nguyên ("two thousand and five") vì "twenty oh five" chỉ
    thông dụng ở văn nói.
    """
    if year < 1100 or year > 2099:
        return integer_to_words(year)
    if 2000 <= year <= 2009:
        return integer_to_words(year)
    high, low = divmod(year, 100)
    if low == 0:
        return f"{integer_to_words(high)} hundred"
    if low < 10:
        return f"{integer_to_words(high)} oh {ONES[low]}"
    return f"{integer_to_words(high)} {integer_to_words(low)}"


def decimal_to_words(integer_part: str, fraction_part: str) -> str:
    head = number_text_to_words(integer_part)
    tail = digits_to_words(fraction_part)
    return f"{head} point {tail}" if tail else head


def number_text_to_words(digits: str) -> str:
    stripped = digits.lstrip("0")
    if stripped == "":
        return ONES[0]
    if len(stripped) != len(digits):
        return digits_to_words(digits)
    if len(stripped) > MAX_SPELLED_DIGITS:
        return digits_to_words(stripped)
    return integer_to_words(int(stripped))
