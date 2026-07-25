"""Test đọc số tiếng Việt.

Trọng tâm là bốn chỗ đọc chệch — "lăm", "mốt", "tư", "lẻ". Đọc máy móc vẫn
qua được test nếu chỉ thử 1, 2, 3, nên các case ở đây cố tình nhắm vào chúng.
"""

from __future__ import annotations

import pytest

from app.text.numbers_vi import (
    decimal_to_words,
    digits_to_words,
    integer_to_words,
    number_text_to_words,
)


class TestChữSốĐơn:
    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            (0, "không"),
            (1, "một"),
            (5, "năm"),
            (9, "chín"),
        ],
    )
    def test_đọc_đúng(self, value: int, expected: str) -> None:
        assert integer_to_words(value) == expected


class TestHàngChục:
    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            (10, "mười"),
            (11, "mười một"),
            # "mười lăm" chứ không phải "mười năm" — chỗ chệch thứ nhất
            (15, "mười lăm"),
            (20, "hai mươi"),
            # "hai mươi mốt" chứ không phải "hai mươi một"
            (21, "hai mươi mốt"),
            # "hai mươi tư" chứ không phải "hai mươi bốn"
            (24, "hai mươi tư"),
            (25, "hai mươi lăm"),
            (99, "chín mươi chín"),
        ],
    )
    def test_đọc_đúng(self, value: int, expected: str) -> None:
        assert integer_to_words(value) == expected

    def test_mười_không_phải_một_mươi(self) -> None:
        assert integer_to_words(10) == "mười"
        assert integer_to_words(20) == "hai mươi"


class TestHàngTrăm:
    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            (100, "một trăm"),
            # "lẻ" chỉ xuất hiện khi hàng chục trống mà có hàng trăm đứng trước
            (105, "một trăm lẻ năm"),
            (101, "một trăm lẻ một"),
            (110, "một trăm mười"),
            (115, "một trăm mười lăm"),
            (121, "một trăm hai mươi mốt"),
            (999, "chín trăm chín mươi chín"),
        ],
    )
    def test_đọc_đúng(self, value: int, expected: str) -> None:
        assert integer_to_words(value) == expected


class TestSốLớn:
    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            (1_000, "một nghìn"),
            (1_005, "một nghìn không trăm lẻ năm"),
            (10_000, "mười nghìn"),
            (1_000_000, "một triệu"),
            (1_000_000_000, "một tỷ"),
        ],
    )
    def test_đọc_đúng(self, value: int, expected: str) -> None:
        assert integer_to_words(value) == expected

    def test_nhóm_giữa_rỗng_vẫn_phân_biệt_được(self) -> None:
        """1_020_000 và 1_200_000 phải đọc khác nhau.

        Bỏ "không trăm" ở nhóm không phải cao nhất thì cả hai cùng ra
        "một triệu hai mươi nghìn" — nghe giống hệt nhau.
        """
        assert integer_to_words(1_020_000) == "một triệu không trăm hai mươi nghìn"
        assert integer_to_words(1_200_000) == "một triệu hai trăm nghìn"
        assert integer_to_words(1_020_000) != integer_to_words(1_200_000)


class TestSốÂm:
    def test_thêm_tiền_tố_âm(self) -> None:
        assert integer_to_words(-5) == "âm năm"
        assert integer_to_words(-21) == "âm hai mươi mốt"


class TestĐọcRờiChữSố:
    def test_đọc_từng_chữ_số(self) -> None:
        assert digits_to_words("1975") == "một chín bảy năm"

    def test_bỏ_qua_ký_tự_không_phải_số(self) -> None:
        assert digits_to_words("09-12") == "không chín một hai"


class TestSốThậpPhân:
    def test_phần_lẻ_đọc_rời_từng_chữ_số(self) -> None:
        """"3,14" là "ba phẩy một bốn", không phải "ba phẩy mười bốn"."""
        assert decimal_to_words("3", "14") == "ba phẩy một bốn"

    def test_số_không_ở_đầu_phần_lẻ_không_bị_mất(self) -> None:
        """"3,05" phải nghe khác "3,5" — nếu đọc phần lẻ như số nguyên thì mất."""
        assert decimal_to_words("3", "05") == "ba phẩy không năm"
        assert decimal_to_words("3", "5") == "ba phẩy năm"


class TestChuỗiChữSố:
    def test_số_thường(self) -> None:
        assert number_text_to_words("21") == "hai mươi mốt"

    def test_toàn_số_không(self) -> None:
        assert number_text_to_words("000") == "không"

    def test_số_không_đứng_đầu_là_mã_định_danh(self) -> None:
        """"007" là mã, phải đọc rời — đọc thành "bảy" là mất thông tin."""
        assert number_text_to_words("007") == "không không bảy"

    def test_số_quá_dài_đọc_rời(self) -> None:
        """Chuỗi 20 chữ số gần như chắc chắn là ISBN/mã số, không phải số đếm."""
        result = number_text_to_words("1" * 20)
        assert result == " ".join(["một"] * 20)
