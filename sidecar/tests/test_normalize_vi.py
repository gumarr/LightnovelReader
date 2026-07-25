"""Test chuẩn hoá text tiếng Việt — mỗi luật một nhóm test riêng.

Nguyên tắc chung của bộ test này: kiểm cả chiều "đổi đúng thứ cần đổi" lẫn
chiều "KHÔNG đụng vào thứ đang đúng". Chiều thứ hai quan trọng hơn — sửa
nhầm chữ đang đúng thì cả chương audio nghe sai mà không ai biết vì sao.
"""

from __future__ import annotations

import pytest

from app.text.normalize_vi import (
    collapse_whitespace,
    expand_abbreviations,
    expand_dates,
    expand_numbers,
    expand_symbols,
    expand_times,
    normalize_dashes,
    normalize_quotes,
    normalize_vi,
    strip_decorative_chars,
)


class TestGộpKhoảngTrắng:
    def test_gộp_dấu_cách_kép(self) -> None:
        assert collapse_whitespace("a  b   c") == "a b c"

    def test_bỏ_khoảng_trắng_đầu_cuối(self) -> None:
        assert collapse_whitespace("  xin chào  ") == "xin chào"

    def test_xuống_dòng_và_tab_thành_dấu_cách(self) -> None:
        assert collapse_whitespace("a\n\tb") == "a b"


class TestDấuNháy:
    def test_ngoặc_kép_kiểu_sách(self) -> None:
        assert normalize_quotes("“Cậu ổn chứ?”") == '"Cậu ổn chứ?"'

    def test_ngoặc_kiểu_nhật(self) -> None:
        """LN dịch từ tiếng Nhật hay giữ nguyên 「」."""
        assert normalize_quotes("「Chào cậu」") == '"Chào cậu"'
        assert normalize_quotes("『Tiêu đề』") == '"Tiêu đề"'

    def test_nháy_đơn_cong(self) -> None:
        assert normalize_quotes("it’s") == "it's"

    def test_không_đụng_dấu_nháy_thẳng(self) -> None:
        assert normalize_quotes('"đã thẳng"') == '"đã thẳng"'


class TestGạchNgang:
    def test_gạch_dài_thành_gạch_thường(self) -> None:
        assert normalize_dashes("A—B") == "A-B"

    def test_gạch_thoại_được_tách_khỏi_chữ(self) -> None:
        """`—Cậu ổn chứ?` phải thành `- Cậu ổn chứ?`."""
        assert normalize_dashes("—Cậu ổn chứ?") == "- Cậu ổn chứ?"

    def test_gạch_dài_lặp_gộp_thành_một(self) -> None:
        """`——` là lối kéo dài giọng trong LN — gặp thật ở sách mẫu.

        Để `--` thì Piper có thể phát thành tiếng thay vì ngắt nghỉ.
        """
        assert normalize_dashes("À——vâng!") == "À-vâng!"

    def test_gạch_nối_giữa_hai_chữ_giữ_nguyên(self) -> None:
        """Không được chèn dấu cách vào giữa từ ghép."""
        assert normalize_dashes("Hà Nội - Sài Gòn") == "Hà Nội - Sài Gòn"


class TestKýTựTrangTrí:
    def test_bỏ_ký_hiệu_trang_trí(self) -> None:
        assert strip_decorative_chars("Chương 1 ★").strip() == "Chương 1"

    def test_bỏ_dòng_phân_cách(self) -> None:
        result = strip_decorative_chars("Hết phần một * * * * Phần hai")
        assert "*" not in result

    def test_dấu_ba_chấm_thường_giữ_nguyên(self) -> None:
        """"…" một dấu là ngắt nghỉ thật trong hội thoại LN, phải giữ."""
        assert "…" in strip_decorative_chars("Ừ… mình hiểu rồi.")


class TestKýHiệu:
    def test_phần_trăm_sau_số(self) -> None:
        assert "phần trăm" in expand_symbols("giảm 50%")

    def test_phần_trăm_đứng_lẻ_giữ_nguyên(self) -> None:
        """Ký tự `%` không dính số thì có thể là phần của tên/ký hiệu khác."""
        assert expand_symbols("dấu % nằm lẻ") == "dấu % nằm lẻ"

    def test_độ_c(self) -> None:
        assert "độ C" in expand_symbols("38°C")

    def test_đơn_vị_ghép_khớp_trước_dấu_gạch_chéo(self) -> None:
        """`km/h` phải khớp nguyên cụm, không bị `/` cắt thành hai phần."""
        assert "ki lô mét trên giờ" in expand_symbols("60km/h")


class TestViếtTắt:
    def test_mở_viết_tắt(self) -> None:
        assert "thành phố" in expand_abbreviations("TP Hồ Chí Minh")

    def test_vân_vân(self) -> None:
        assert "vân vân" in expand_abbreviations("bánh, kẹo, v.v.")

    def test_không_khớp_giữa_từ(self) -> None:
        """"TPHCM" là một từ liền, không được tách "TP" ra."""
        assert expand_abbreviations("TPHCM") == "TPHCM"

    def test_dấu_chấm_cuối_câu_không_bị_nuốt(self) -> None:
        """`TP.` cuối câu có MỘT dấu chấm làm hai việc: kết viết tắt và kết câu.

        Nuốt mất nó là mất ranh giới câu — TTS đọc dính sang câu sau. Lỗi này
        chỉ lộ ra khi chạy thật, unit test ban đầu chỉ thử viết tắt giữa câu.
        """
        assert expand_abbreviations("học sinh của TP.") == "học sinh của thành phố."
        assert expand_abbreviations("bánh, kẹo, v.v.") == "bánh, kẹo, vân vân."

    def test_không_chẻ_đôi_địa_danh(self) -> None:
        """`TP. Hồ Chí Minh` giữa câu: dấu chấm thuộc viết tắt, không phải kết câu.

        Không đoán theo "chữ sau viết hoa" — dấu hiệu đó giống hệt nhau giữa
        câu này và `sống ở TP. Rồi đi.`, đoán sai thì chẻ đôi một địa danh.
        """
        assert expand_abbreviations("TP. Hồ Chí Minh") == "thành phố Hồ Chí Minh"


class TestNgàyTháng:
    def test_ngày_tháng_năm_kiểu_việt(self) -> None:
        """Việt Nam là NGÀY/tháng/năm — 12/3 là ngày 12 tháng 3."""
        result = expand_dates("12/3/2024")
        assert result.startswith("ngày mười hai tháng ba")
        assert "năm" in result

    def test_ngày_tháng_không_năm(self) -> None:
        assert expand_dates("12/3") == "ngày mười hai tháng ba"

    def test_dấu_gạch_ngang_có_năm(self) -> None:
        assert expand_dates("5-6-2024").startswith("ngày năm tháng sáu năm")

    def test_gạch_ngang_không_năm_KHÔNG_phải_ngày(self) -> None:
        """`lớp 11-5` là khối-lớp kiểu Nhật, không phải ngày 11 tháng 5.

        Lỗi thật gặp trên CẢ HAI cuốn sách mẫu — unit test tổng hợp không lộ
        ra vì không ai nghĩ tới cách ghi lớp học. Dạng `d-m` trong LN gần như
        luôn là lớp, tỉ số hay khoảng; ngày viết bằng `-` mà thiếu năm thì hiếm.
        """
        assert expand_dates("lớp 11-5") == "lớp 11-5"
        assert expand_dates("tỉ số 2-5") == "tỉ số 2-5"

    def test_không_lặp_chữ_ngày(self) -> None:
        """Câu đã có sẵn "ngày" thì không chèn thêm — "ngày ngày mười hai".

        Lỗi này chỉ lộ ra khi chạy thật trên câu văn đầy đủ; test ban đầu chỉ
        đưa vào chuỗi ngày trơ trọi nên không thấy.
        """
        assert expand_dates("Hẹn ngày 12/3 nhé") == "Hẹn ngày mười hai tháng ba nhé"

    def test_vẫn_chèn_ngày_khi_câu_chưa_có(self) -> None:
        assert expand_dates("12/3 là ngày gì?") == "ngày mười hai tháng ba là ngày gì?"

    def test_ngày_tháng_đệm_số_không(self) -> None:
        """`05/06` là ngày 5 tháng 6, không phải "ngày không năm tháng không sáu".

        Luật "số 0 đứng đầu = mã định danh" đúng cho `007` nhưng sai hoàn toàn
        với ngày tháng — chỗ này luôn đệm 0 cho đủ hai chữ số.
        """
        assert expand_dates("05/06") == "ngày năm tháng sáu"

    def test_tháng_quá_12_không_phải_ngày(self) -> None:
        """`20/30` là phân số hoặc tỉ số, để luật số lo."""
        assert expand_dates("20/30") == "20/30"

    def test_không_khớp_giữa_dãy_số_dài(self) -> None:
        assert expand_dates("123/456") == "123/456"


class TestGiờ:
    def test_giờ_phút(self) -> None:
        assert expand_times("14:30") == "mười bốn giờ ba mươi phút"

    def test_phút_bằng_không_thì_bỏ(self) -> None:
        assert expand_times("14:00") == "mười bốn giờ"

    def test_giờ_phút_giây(self) -> None:
        assert expand_times("01:02:03") == "một giờ hai phút ba giây"

    def test_giờ_quá_23_giữ_nguyên(self) -> None:
        """Có thể là tỉ số trận đấu, không phải giờ."""
        assert expand_times("99:30") == "99:30"


class TestSố:
    def test_số_nguyên(self) -> None:
        assert expand_numbers("có 15 người") == "có mười lăm người"

    def test_dấu_phân_nhóm_hàng_nghìn(self) -> None:
        assert expand_numbers("1.234.567") == "một triệu hai trăm ba mươi tư nghìn năm trăm sáu mươi bảy"

    def test_thập_phân_dùng_dấu_phẩy(self) -> None:
        assert expand_numbers("3,14") == "ba phẩy một bốn"

    def test_năm_đọc_rời_từng_chữ_số(self) -> None:
        """"năm 1975" nghe tự nhiên hơn hẳn "một nghìn chín trăm bảy mươi lăm"."""
        assert expand_numbers("năm 1975") == "năm một chín bảy năm"

    def test_số_không_đứng_sau_năm_vẫn_đọc_nguyên(self) -> None:
        assert expand_numbers("1975 cuốn sách").startswith("một nghìn")

    def test_không_đụng_số_dính_chữ(self) -> None:
        """"A4", "COVID19" là mã, tách ra đọc sẽ sai."""
        assert expand_numbers("khổ A4") == "khổ A4"


class TestPipelineĐầyĐủ:
    def test_thứ_tự_ngày_trước_số(self) -> None:
        """Số chạy trước thì `12/3` đã thành "mười hai trên ba"."""
        result = normalize_vi("Hẹn ngày 12/3/2024 nhé.")
        assert "tháng ba" in result
        assert "/" not in result

    def test_thứ_tự_viết_tắt_trước_số(self) -> None:
        """`v.v.` chứa dấu chấm; số chạy trước sẽ coi đó là dấu thập phân."""
        assert "vân vân" in normalize_vi("bánh, kẹo, v.v.")

    def test_câu_hội_thoại_ln(self) -> None:
        result = normalize_vi("「Cậu  ổn  chứ?」 —Ừ, mình 100% ổn.")
        assert '"Cậu ổn chứ?"' in result
        assert "một trăm phần trăm" in result
        assert "  " not in result

    def test_text_thường_không_bị_đụng(self) -> None:
        """Câu văn không có số/ký hiệu phải đi qua nguyên vẹn."""
        text = "Cô ấy quay lại nhìn tôi, ánh mắt đầy nghi hoặc."
        assert normalize_vi(text) == text

    @pytest.mark.parametrize("text", ["", "   ", "\n\n"])
    def test_text_rỗng_không_nổ(self, text: str) -> None:
        assert normalize_vi(text) == ""
