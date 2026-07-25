"""Đọc số thành chữ tiếng Việt.

Tách riêng khỏi `normalize_vi` vì đây là phần dày luật nhất và cần test riêng:
tiếng Việt có bốn chỗ đọc chệch mà đọc máy móc sẽ ra sai — "mười lăm" (không
phải "mười năm"), "hai mươi mốt" (không phải "hai mươi một"), "hai mươi tư",
và "một trăm lẻ năm" (không phải "một trăm không năm").
"""

from __future__ import annotations

DIGITS = ("không", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín")

# Đơn vị theo nhóm ba chữ số. Tiếng Việt lặp lại "nghìn/triệu/tỷ" nên chỉ cần
# tới tỷ rồi ghép ("nghìn tỷ", "triệu tỷ") cho số lớn hơn.
GROUP_UNITS = ("", "nghìn", "triệu", "tỷ")

# Trần đọc được: 4 nhóm ba chữ số (tới hàng tỷ) × ghép "tỷ" một lần = 10^18.
# Số dài hơn thế trong sách gần như chắc chắn là mã số/ISBN chứ không phải số
# đếm — đọc từng chữ số dễ hiểu hơn.
MAX_SPELLED_DIGITS = 18


def _two_digits(tens: int, ones: int, *, is_leading_group: bool) -> list[str]:
    """Đọc hai chữ số cuối của một nhóm."""
    if tens == 0:
        if ones == 0:
            return []
        # "một trăm lẻ năm" — chữ "lẻ" chỉ xuất hiện khi có hàng trăm đứng
        # trước. Không có hàng trăm thì đọc trần chữ số ("một nghìn"), tuyệt
        # đối không bỏ đi: bỏ thì 1000 đọc thành "nghìn".
        return [DIGITS[ones]] if is_leading_group else ["lẻ", DIGITS[ones]]

    if tens == 1:
        words = ["mười"]
        if ones == 5:
            words.append("lăm")  # "mười lăm", không phải "mười năm"
        elif ones != 0:
            words.append(DIGITS[ones])
        return words

    words = [DIGITS[tens], "mươi"]
    if ones == 1:
        words.append("mốt")  # "hai mươi mốt"
    elif ones == 4:
        words.append("tư")  # "hai mươi tư"
    elif ones == 5:
        words.append("lăm")  # "hai mươi lăm"
    elif ones != 0:
        words.append(DIGITS[ones])
    return words


def _group_to_words(group: int, *, is_leading_group: bool) -> list[str]:
    """Đọc một nhóm ba chữ số (0–999).

    `is_leading_group` = nhóm cao nhất của cả số. Nhóm không phải cao nhất luôn
    đọc đủ ba chữ số ("một triệu không trăm hai mươi nghìn"), nếu không thì
    1_020_000 và 1_200_000 đọc giống hệt nhau.
    """
    hundreds, rest = divmod(group, 100)
    tens, ones = divmod(rest, 10)

    words: list[str] = []
    if hundreds > 0:
        words += [DIGITS[hundreds], "trăm"]
    elif not is_leading_group:
        words += ["không", "trăm"]

    words += _two_digits(tens, ones, is_leading_group=is_leading_group and hundreds == 0)
    return words


def integer_to_words(value: int) -> str:
    """Đọc số nguyên thành chữ. Số âm thêm tiền tố "âm"."""
    if value < 0:
        return f"âm {integer_to_words(-value)}"
    if value < 10:
        return DIGITS[value]

    # Cắt thành các nhóm ba chữ số, nhóm thấp trước
    groups: list[int] = []
    remaining = value
    while remaining > 0:
        remaining, group = divmod(remaining, 1000)
        groups.append(group)

    words: list[str] = []
    for position in range(len(groups) - 1, -1, -1):
        group = groups[position]
        is_leading = position == len(groups) - 1

        # Nhóm rỗng ở giữa vẫn phải giữ đơn vị của nó nếu là mốc tỷ, còn nhóm
        # "không trăm không mươi không nghìn" thì bỏ hẳn cho khỏi lải nhải.
        if group == 0 and not is_leading:
            continue

        words += _group_to_words(group, is_leading_group=is_leading)
        unit = _unit_for_position(position)
        if unit:
            words.append(unit)

    return " ".join(words)


def _unit_for_position(position: int) -> str:
    """Đơn vị của nhóm thứ `position` (0 = hàng đơn vị).

    Quá hàng tỷ thì ghép thêm "tỷ": 10^12 = "nghìn tỷ", 10^15 = "triệu tỷ".
    """
    if position < len(GROUP_UNITS):
        return GROUP_UNITS[position]
    base = GROUP_UNITS[position % 3] if position % 3 else "tỷ"
    extra_billions = position // 3
    if position % 3 == 0:
        return " ".join(["tỷ"] * extra_billions)
    return " ".join([base] + ["tỷ"] * extra_billions)


def digits_to_words(digits: str) -> str:
    """Đọc từng chữ số một — dùng cho mã số, số điện thoại, năm dài."""
    return " ".join(DIGITS[int(ch)] for ch in digits if ch.isdigit())


def decimal_to_words(integer_part: str, fraction_part: str) -> str:
    """Đọc số thập phân: phần nguyên + "phẩy" + từng chữ số phần lẻ.

    Phần lẻ đọc từng chữ số vì "3,14" là "ba phẩy một bốn", không phải
    "ba phẩy mười bốn" — và "3,05" phải nghe khác "3,5".
    """
    head = number_text_to_words(integer_part)
    tail = digits_to_words(fraction_part)
    return f"{head} phẩy {tail}" if tail else head


def number_text_to_words(digits: str) -> str:
    """Đọc chuỗi chữ số. Quá dài thì đọc rời từng chữ số."""
    stripped = digits.lstrip("0")
    if stripped == "":
        return DIGITS[0]
    # Số bắt đầu bằng 0 ("007") là mã định danh, không phải số đếm
    if len(stripped) != len(digits):
        return digits_to_words(digits)
    if len(stripped) > MAX_SPELLED_DIGITS:
        return digits_to_words(stripped)
    return integer_to_words(int(stripped))
