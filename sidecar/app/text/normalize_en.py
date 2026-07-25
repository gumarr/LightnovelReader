"""Chuẩn hoá text tiếng Anh trước khi đưa vào TTS.

Cùng nguyên tắc với `normalize_vi`: mỗi luật một hàm thuần, có test riêng.
Khác biệt chính là **ngày tháng đọc theo kiểu Mỹ (tháng/ngày)** và số thập
phân dùng dấu chấm — đảo ngược hoàn toàn so với tiếng Việt, nên không dùng
chung hàm được dù regex trông giống nhau.
"""

from __future__ import annotations

import re

from .normalize_vi import (
    collapse_whitespace,
    normalize_dashes,
    normalize_quotes,
    strip_decorative_chars,
)
from .numbers_en import decimal_to_words, number_text_to_words, year_to_words

SYMBOL_WORDS: dict[str, str] = {
    "%": "percent",
    "&": "and",
    "@": "at",
    "°C": "degrees Celsius",
    "°F": "degrees Fahrenheit",
    "km/h": "kilometers per hour",
    "m/s": "meters per second",
}

# Viết tắt tiếng Anh. `Mr`/`Mrs`/`Dr` giữ cả bản có dấu chấm vì sentence
# splitter phía trước đã coi chúng là viết tắt và không cắt câu ở đó.
ABBREVIATIONS: dict[str, str] = {
    "Mr": "Mister",
    "Mr.": "Mister",
    "Mrs": "Missus",
    "Mrs.": "Missus",
    "Ms": "Miss",
    "Ms.": "Miss",
    "Dr": "Doctor",
    "Dr.": "Doctor",
    "Prof": "Professor",
    "Prof.": "Professor",
    "St": "Saint",
    "vs": "versus",
    "vs.": "versus",
    "etc": "et cetera",
    "etc.": "et cetera",
    "e.g.": "for example",
    "i.e.": "that is",
}

MONTHS = (
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
)

ORDINAL_SUFFIXES = {1: "first", 2: "second", 3: "third", 5: "fifth", 8: "eighth", 9: "ninth", 12: "twelfth"}


def expand_symbols(text: str) -> str:
    for symbol in sorted(SYMBOL_WORDS, key=len, reverse=True):
        word = SYMBOL_WORDS[symbol]
        if symbol == "%":
            text = re.sub(r"(?<=\d)\s*%", f" {word}", text)
        else:
            text = text.replace(symbol, f" {word}")
    return text


def expand_abbreviations(text: str) -> str:
    def replace(match: re.Match[str]) -> str:
        word = match.group(0)
        return ABBREVIATIONS.get(word, ABBREVIATIONS.get(word.rstrip("."), word))

    pattern = "|".join(sorted((re.escape(key) for key in ABBREVIATIONS), key=len, reverse=True))
    return re.sub(rf"(?<![\w.])(?:{pattern})(?![\w])", replace, text)


def ordinal_to_words(value: int) -> str:
    """Đọc số thứ tự: 1 → "first", 21 → "twenty-first"."""
    if value in ORDINAL_SUFFIXES:
        return ORDINAL_SUFFIXES[value]
    words = number_text_to_words(str(value))
    last_word = words.rsplit("-", 1)[-1].rsplit(" ", 1)[-1]
    tail_value = int(str(value)[-1]) if str(value)[-1] != "0" else 0

    if tail_value in ORDINAL_SUFFIXES:
        replacement = ORDINAL_SUFFIXES[tail_value]
    elif last_word.endswith("y"):
        replacement = f"{last_word[:-1]}ieth"
    else:
        replacement = f"{last_word}th"

    return words[: len(words) - len(last_word)] + replacement


def expand_ordinals(text: str) -> str:
    """`1st`, `2nd`, `23rd` → chữ."""
    return re.sub(
        r"(?<!\w)(\d+)(?:st|nd|rd|th)(?!\w)",
        lambda m: ordinal_to_words(int(m.group(1))),
        text,
        flags=re.IGNORECASE,
    )


def expand_dates(text: str) -> str:
    """`3/12/2024` → "March twelfth, two thousand and..." — thứ tự MỸ.

    Đây là khác biệt lớn nhất so với tiếng Việt: `12/3` ở đây là 12 tháng Ba
    theo kiểu Việt, nhưng ở đây là ngày 3 tháng Mười Hai.
    """

    def replace(match: re.Match[str]) -> str:
        month = match.group("m") or match.group("m2")
        day = match.group("d") or match.group("d2")
        year = match.group("y") or match.group("y2")
        if not (1 <= int(month) <= 12 and 1 <= int(day) <= 31):
            return match.group(0)
        parts = [MONTHS[int(month) - 1], ordinal_to_words(int(day))]
        if year:
            parts.append(year_to_words(int(year)))
        return " ".join(parts)

    # `-` chỉ tính là ngày khi có năm 4 chữ số — cùng lý do như bản VI:
    # `Class 2-5` trong LN Nhật khớp regex ngày và bị đọc thành "February fifth".
    return re.sub(
        r"(?<!\d)(?:"
        r"(?P<m>\d{1,2})/(?P<d>\d{1,2})(?:/(?P<y>\d{4}))?"
        r"|(?P<m2>\d{1,2})-(?P<d2>\d{1,2})-(?P<y2>\d{4})"
        r")(?!\d)",
        replace,
        text,
    )


def expand_times(text: str) -> str:
    """`14:30` → "fourteen thirty", `9:05` → "nine oh five"."""

    def replace(match: re.Match[str]) -> str:
        hour, minute = int(match.group("h")), int(match.group("mi"))
        if hour > 23 or minute > 59:
            return match.group(0)
        if minute == 0:
            return f"{number_text_to_words(str(hour))} o'clock"
        if minute < 10:
            return f"{number_text_to_words(str(hour))} oh {number_text_to_words(str(minute))}"
        return f"{number_text_to_words(str(hour))} {number_text_to_words(str(minute))}"

    return re.sub(r"(?<!\d)(?P<h>\d{1,2}):(?P<mi>\d{2})(?!\d)", replace, text)


def expand_numbers(text: str) -> str:
    """Đọc số còn lại. Chạy SAU ngày/giờ/số thứ tự.

    Dấu phân nhóm là `,` và dấu thập phân là `.` — ngược hẳn tiếng Việt.
    """
    text = re.sub(
        r"(?<!\d)(\d{1,3}(?:,\d{3})+)(?!\d)",
        lambda m: number_text_to_words(m.group(1).replace(",", "")),
        text,
    )

    text = re.sub(
        r"(?<!\d)(\d+)\.(\d+)(?!\d)",
        lambda m: decimal_to_words(m.group(1), m.group(2)),
        text,
    )

    text = re.sub(
        r"\b(?:in|year)\s+(1[0-9]{3}|20[0-9]{2})(?!\d)",
        lambda m: m.group(0)[: m.start(1) - m.start(0)] + year_to_words(int(m.group(1))),
        text,
        flags=re.IGNORECASE,
    )

    text = re.sub(r"(?<![\w])(\d+)(?![\w])", lambda m: number_text_to_words(m.group(1)), text)
    return text


def normalize_en(text: str) -> str:
    """Pipeline chuẩn hoá tiếng Anh. Thứ tự bắt buộc, cùng lý do như VI.

    Thêm một ràng buộc riêng: `expand_ordinals` phải chạy TRƯỚC
    `expand_abbreviations`, vì `1st` chứa `st` sẽ bị luật viết tắt đổi thành
    `1Saint`.
    """
    text = normalize_quotes(text)
    text = normalize_dashes(text)
    text = strip_decorative_chars(text)
    text = expand_symbols(text)
    text = expand_ordinals(text)
    text = expand_abbreviations(text)
    text = expand_dates(text)
    text = expand_times(text)
    text = expand_numbers(text)
    return collapse_whitespace(text)
