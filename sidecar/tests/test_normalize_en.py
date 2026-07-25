"""Test chuẩn hoá text tiếng Anh.

Điểm cần soi kỹ nhất là **ngày tháng đảo ngược so với tiếng Việt**: cùng
chuỗi `3/12` mà VI đọc "ngày ba tháng mười hai", EN đọc "March twelfth".
Dùng nhầm hàm giữa hai ngôn ngữ sẽ ra ngày sai mà không có gì báo lỗi.
"""

from __future__ import annotations

import pytest

from app.text.normalize_en import (
    expand_abbreviations,
    expand_dates,
    expand_numbers,
    expand_ordinals,
    expand_symbols,
    expand_times,
    normalize_en,
    ordinal_to_words,
)
from app.text.numbers_en import integer_to_words, year_to_words


class TestSốNguyên:
    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            (0, "zero"),
            (13, "thirteen"),
            (21, "twenty-one"),
            (100, "one hundred"),
            (105, "one hundred and five"),
            (1_000, "one thousand"),
            (1_000_000, "one million"),
        ],
    )
    def test_đọc_đúng(self, value: int, expected: str) -> None:
        assert integer_to_words(value) == expected


class TestNăm:
    @pytest.mark.parametrize(
        ("year", "expected"),
        [
            (1975, "nineteen seventy-five"),
            (1900, "nineteen hundred"),
            (1905, "nineteen oh five"),
            # 2000–2009 đọc nguyên, "twenty oh five" chỉ hợp văn nói
            (2005, "two thousand and five"),
            (2024, "twenty twenty-four"),
        ],
    )
    def test_đọc_đúng(self, year: int, expected: str) -> None:
        assert year_to_words(year) == expected


class TestSốThứTự:
    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            (1, "first"),
            (2, "second"),
            (3, "third"),
            (4, "fourth"),
            (5, "fifth"),
            (12, "twelfth"),
            (20, "twentieth"),
            (21, "twenty-first"),
            (23, "twenty-third"),
        ],
    )
    def test_đọc_đúng(self, value: int, expected: str) -> None:
        assert ordinal_to_words(value) == expected

    def test_nhận_dạng_trong_câu(self) -> None:
        assert expand_ordinals("the 1st time") == "the first time"
        assert expand_ordinals("23rd floor") == "twenty-third floor"


class TestKýHiệu:
    def test_phần_trăm(self) -> None:
        assert "percent" in expand_symbols("50%")

    def test_độ_f(self) -> None:
        assert "degrees Fahrenheit" in expand_symbols("98°F")


class TestViếtTắt:
    def test_danh_xưng(self) -> None:
        assert expand_abbreviations("Mr. Smith") == "Mister Smith"
        assert expand_abbreviations("Dr. Who") == "Doctor Who"

    def test_versus(self) -> None:
        assert "versus" in expand_abbreviations("A vs. B")

    def test_không_khớp_giữa_từ(self) -> None:
        """"Street" chứa "St" nhưng không được đổi."""
        assert expand_abbreviations("Street") == "Street"


class TestNgàyTháng:
    def test_thứ_tự_mỹ_tháng_trước_ngày(self) -> None:
        """`3/12/2024` là ngày 12 tháng Ba — NGƯỢC với cách đọc tiếng Việt."""
        result = expand_dates("3/12/2024")
        assert result.startswith("March twelfth")

    def test_không_có_năm(self) -> None:
        assert expand_dates("7/4") == "July fourth"

    def test_tháng_quá_12_giữ_nguyên(self) -> None:
        assert expand_dates("20/30") == "20/30"

    def test_gạch_ngang_không_năm_KHÔNG_phải_ngày(self) -> None:
        """`Class 2-5` là khối-lớp kiểu Nhật — lỗi thật gặp trên sách mẫu EN."""
        assert expand_dates("Class 2-5") == "Class 2-5"

    def test_gạch_ngang_có_năm_vẫn_là_ngày(self) -> None:
        assert expand_dates("3-12-2024").startswith("March twelfth")


class TestGiờ:
    def test_giờ_tròn(self) -> None:
        assert expand_times("9:00") == "nine o'clock"

    def test_phút_dưới_mười_đọc_oh(self) -> None:
        assert expand_times("9:05") == "nine oh five"

    def test_giờ_phút(self) -> None:
        assert expand_times("14:30") == "fourteen thirty"


class TestSố:
    def test_dấu_phân_nhóm_là_dấu_phẩy(self) -> None:
        """Ngược tiếng Việt: EN dùng `,` phân nhóm và `.` thập phân."""
        assert expand_numbers("1,234") == "one thousand two hundred and thirty-four"

    def test_thập_phân_dùng_dấu_chấm(self) -> None:
        assert expand_numbers("3.14") == "three point one four"

    def test_không_đụng_số_dính_chữ(self) -> None:
        assert expand_numbers("size A4") == "size A4"


class TestPipelineĐầyĐủ:
    def test_thứ_tự_số_thứ_tự_trước_viết_tắt(self) -> None:
        """`1st` chứa `st`; viết tắt chạy trước sẽ đổi thành `1Saint`."""
        result = normalize_en("the 1st day")
        assert "first" in result
        assert "Saint" not in result

    def test_câu_có_danh_xưng_và_số(self) -> None:
        result = normalize_en("Mr. Smith arrived at 9:05 with 50% of the books.")
        assert "Mister Smith" in result
        assert "nine oh five" in result
        assert "percent" in result

    def test_text_thường_không_bị_đụng(self) -> None:
        text = "She turned around and looked at me."
        assert normalize_en(text) == text

    @pytest.mark.parametrize("text", ["", "   "])
    def test_text_rỗng_không_nổ(self, text: str) -> None:
        assert normalize_en(text) == ""
