"""Test từ điển phiên âm Nhật + ghép ba tầng (plan.md mục 8.1).

Nhóm test đáng chú ý nhất là `TestKhongPhaTiengViet`: text LN dịch **là** tiếng
Việt, nên nuốt nhầm một từ Việt xảy ra thường xuyên hơn nuốt nhầm tiếng Anh và
hậu quả nặng hơn. Nới luật romaji mà quên nhóm này là hỏng ngay.
"""

from __future__ import annotations

import pytest

from app.text.lexicon_jp import (
    LexiconError,
    _parse_entries,
    load_lexicon,
    lookup,
    transcribe_japanese,
)

# Âm tiết tiếng Việt không dấu, viết thường lẫn viết hoa đầu câu — không được
# đụng tới bất kỳ từ nào.
VIETNAMESE_WORDS = [
    "mua", "ban", "con", "hoa", "nam", "tai", "hai", "cho", "chi",
    "chu", "nha", "tau", "bai", "moi", "gian", "nho", "hieu", "noi",
    "nhin", "ngu", "ngoi", "sach", "xe", "may", "bay", "thay", "cao",
    "nhanh", "cham", "tot", "xau", "dep", "vui", "yeu", "biet", "xem",
]


class TestLoadLexicon:
    def test_doc_duoc_tu_dien_ship_san(self) -> None:
        table = load_lexicon()
        assert len(table) > 100, "từ điển ship sẵn phải có ít nhất 100 mục"

    def test_khoa_deu_viet_thuong(self) -> None:
        # Tra cứu dựa vào khoá đã chuẩn hoá — khoá hoa sẽ không bao giờ khớp.
        for key in load_lexicon():
            assert key == key.lower()

    def test_gia_tri_khong_chua_khoang_trang(self) -> None:
        # Dấu cách khiến Piper chèn khoảng nghỉ giữa các âm tiết.
        for key, value in load_lexicon().items():
            assert " " not in value, f"mục {key!r} chứa khoảng trắng"

    def test_co_nhung_muc_quan_trong(self) -> None:
        table = load_lexicon()
        for key in ("tokyo", "kyoto", "shinkansen", "senpai", "sensei"):
            assert key in table


class TestParseEntries:
    def test_tu_choi_khong_phai_object(self) -> None:
        with pytest.raises(LexiconError):
            _parse_entries([])

    def test_tu_choi_thieu_entries(self) -> None:
        with pytest.raises(LexiconError):
            _parse_entries({"version": 1})

    def test_tu_choi_gia_tri_khong_phai_chuoi(self) -> None:
        with pytest.raises(LexiconError):
            _parse_entries({"entries": {"tokyo": 123}})

    def test_tu_choi_gia_tri_rong(self) -> None:
        with pytest.raises(LexiconError):
            _parse_entries({"entries": {"tokyo": ""}})

    def test_chuan_hoa_khoa_ve_chu_thuong(self) -> None:
        table = _parse_entries({"entries": {"TOKYO": "Tô-ki-ô"}})
        assert table == {"tokyo": "Tô-ki-ô"}


class TestLookup:
    def test_tu_dien_thang_luat_romaji(self) -> None:
        # Từ điển cho "Tô-ki-ô", luật romaji cho "Tô-kiô" — từ điển phải thắng.
        assert lookup("Tokyo") == "Tô-ki-ô"

    def test_override_thang_tu_dien(self) -> None:
        assert lookup("Tokyo", {"tokyo": "Đông-Kinh"}) == "Đông-Kinh"

    def test_override_khong_phan_biet_hoa_thuong(self) -> None:
        assert lookup("TOKYO", {"tokyo": "Đông-Kinh"}) is not None

    def test_luat_romaji_lo_phan_duoi(self) -> None:
        # Không có trong từ điển nhưng vẫn phiên âm được.
        assert lookup("Kaneki") is not None

    def test_giu_dang_chu_hoa(self) -> None:
        # Từ điển lưu sẵn dạng viết hoa. `_match_case` chỉ hoa-hoá thêm khi từ
        # gốc viết hoa, KHÔNG thường-hoá — chữ hoa/thường không đổi cách Piper
        # đọc, nên hạ chữ chỉ tốn công mà không được gì.
        assert lookup("Tokyo") == "Tô-ki-ô"
        assert lookup("TOKYO") == "TÔ-KI-Ô"

    def test_luat_romaji_giu_dang_chu_hoa_cua_tu_goc(self) -> None:
        # Tầng luật thì tự lo, và ở đây phân biệt được vì luật sinh chữ thường.
        assert lookup("Kaneki") == "Ca-nê-ki"

    def test_tra_none_khi_khong_tang_nao_nhan(self) -> None:
        assert lookup("computer") is None

    def test_luat_romaji_chi_ap_cho_token_viet_hoa(self) -> None:
        # `Kaneki` viết hoa → nhận. `kaneki` viết thường → bỏ, vì token thường
        # giữa câu gần như luôn là tiếng Việt.
        assert lookup("Kaneki") is not None
        assert lookup("kaneki") is None

    def test_tu_dien_van_nhan_token_viet_thuong(self) -> None:
        # Ràng buộc chữ hoa chỉ áp cho tầng luật, không áp cho từ điển.
        assert lookup("senpai") is not None
        assert lookup("bentou") is not None


class TestTranscribeJapanese:
    def test_thay_ten_trong_cau(self) -> None:
        result = transcribe_japanese("Chuyến Shinkansen từ Tokyo đến Kyoto.")
        assert result.spoken == "Chuyến Sin-can-xên từ Tô-ki-ô đến Ki-ô-tô."

    def test_giu_nguyen_text_goc(self) -> None:
        source = "Đi Tokyo chơi"
        assert transcribe_japanese(source).source == source

    def test_quy_nguoc_offset_ve_text_goc(self) -> None:
        result = transcribe_japanese("Đi Tokyo chơi")
        index = result.spoken.index("Tô")
        # Bất kỳ mảnh nào của phiên âm cũng nới về trọn từ gốc "Tokyo".
        assert result.to_source_range(index, index + 2) == (3, 8)

    def test_cum_gach_noi_tra_nguyen_cum_truoc(self) -> None:
        result = transcribe_japanese("Onii-chan ơi")
        assert result.spoken.startswith("Ô-ni-chan")

    def test_cum_gach_noi_tra_tung_phan_khi_khong_khop_ca_cum(self) -> None:
        result = transcribe_japanese("Asuka-senpai")
        assert "xêm-pai" in result.spoken.lower()

    def test_text_khong_co_ten_nhat_giu_nguyen(self) -> None:
        source = "Hôm nay trời đẹp quá."
        assert transcribe_japanese(source).spoken == source

    def test_text_rong(self) -> None:
        assert transcribe_japanese("").spoken == ""

    def test_khong_dung_toi_tieng_anh(self) -> None:
        source = "The computer system is running well."
        assert transcribe_japanese(source).spoken == source

    def test_override_ap_dung_trong_cau(self) -> None:
        result = transcribe_japanese("Đến Tokyo", {"tokyo": "Đông-Kinh"})
        assert result.spoken == "Đến Đông-Kinh"

    def test_nhieu_ten_trong_mot_cau(self) -> None:
        result = transcribe_japanese("Tokyo, Osaka và Kyoto")
        assert "Tô-ki-ô" in result.spoken
        assert "Ô-xa-ca" in result.spoken
        assert "Ki-ô-tô" in result.spoken


class TestKhongPhaTiengViet:
    """Lớp chặn quan trọng nhất — xem chú thích đầu file."""

    @pytest.mark.parametrize("word", VIETNAMESE_WORDS)
    def test_khong_dung_toi_tu_viet_thuong(self, word: str) -> None:
        assert lookup(word) is None, f"{word!r} là tiếng Việt, không được phiên âm"

    @pytest.mark.parametrize("word", VIETNAMESE_WORDS)
    def test_khong_dung_toi_tu_viet_dau_cau(self, word: str) -> None:
        # Từ Việt đứng đầu câu bị viết hoa — không được lọt qua cửa chữ hoa.
        capitalized = word.capitalize()
        assert lookup(capitalized) is None, f"{capitalized!r} đầu câu bị phiên âm nhầm"

    def test_cau_tieng_viet_thuan_giu_nguyen(self) -> None:
        for sentence in (
            "Mua sách ở hiệu sách gần nhà.",
            "Tôi nhìn thấy chi tiết đó, ban đầu không hiểu.",
            "Con hoa mua nam nay no rat dep.",
        ):
            assert transcribe_japanese(sentence).spoken == sentence

    def test_cau_lan_lon_chi_doi_ten_nhat(self) -> None:
        result = transcribe_japanese("Cô ấy mua bentou ở konbini.")
        # "mua" giữ nguyên, "bentou" và "konbini" được phiên âm.
        assert "mua" in result.spoken
        assert "bên-tô" in result.spoken
        assert "côn-bi-ni" in result.spoken
