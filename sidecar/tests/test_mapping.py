"""Test ánh xạ offset giữa text gốc và text đã chuẩn hoá.

Đây là phần đỡ toàn bộ P3.5: sai ở đây thì highlight lệch mà không có lỗi nào
nổ ra — thứ chỉ lộ khi *nhìn* app chạy. Nên test dày hơn mức thường.
"""

from __future__ import annotations

from app.text.mapping import (
    NormalizedText,
    Replacement,
    Span,
    apply_replacements,
    compose,
    identity,
    to_source_range,
)


class TestIdentity:
    def test_giu_nguyen_text(self) -> None:
        result = identity("Xin chào")
        assert result.spoken == "Xin chào"
        assert result.source == "Xin chào"

    def test_anh_xa_dung_tung_ky_tu(self) -> None:
        result = identity("Xin chào")
        assert result.to_source_range(4, 8) == (4, 8)

    def test_text_rong(self) -> None:
        result = identity("")
        assert result.spoken == ""
        assert result.spans == ()

    def test_khoang_rong_van_quy_duoc(self) -> None:
        result = identity("abc")
        assert result.to_source_range(1, 1) == (1, 1)


class TestApplyReplacements:
    def test_mot_thay_the_giua_cau(self) -> None:
        text = "Đi Tokyo chơi"
        result = apply_replacements(text, [Replacement(3, 8, "Tô-ki-ô")])
        assert result.spoken == "Đi Tô-ki-ô chơi"

    def test_quy_nguoc_ve_ca_tu_goc(self) -> None:
        text = "Đi Tokyo chơi"
        result = apply_replacements(text, [Replacement(3, 8, "Tô-ki-ô")])
        # "Tô" nằm trong đoạn đã thay → nới ra trọn "Tokyo"
        assert result.to_source_range(3, 5) == (3, 8)
        # "ki" cũng vậy
        assert result.to_source_range(6, 8) == (3, 8)

    def test_doan_khong_doi_van_chinh_xac_tung_ky_tu(self) -> None:
        text = "Đi Tokyo chơi"
        result = apply_replacements(text, [Replacement(3, 8, "Tô-ki-ô")])
        # "chơi" ở sau chỗ thay — offset dịch nhưng vẫn ánh xạ đúng
        spoken_index = result.spoken.index("chơi")
        assert result.to_source_range(spoken_index, spoken_index + 4) == (9, 13)

    def test_doan_truoc_cho_thay_giu_nguyen_offset(self) -> None:
        text = "Đi Tokyo chơi"
        result = apply_replacements(text, [Replacement(3, 8, "Tô-ki-ô")])
        assert result.to_source_range(0, 2) == (0, 2)

    def test_nhieu_thay_the(self) -> None:
        text = "Tokyo và Kyoto"
        result = apply_replacements(
            text, [Replacement(0, 5, "Tô-ki-ô"), Replacement(9, 14, "Ki-ô-tô")]
        )
        assert result.spoken == "Tô-ki-ô và Ki-ô-tô"
        assert result.to_source_range(0, 2) == (0, 5)
        last = result.spoken.index("Ki-ô-tô")
        assert result.to_source_range(last, last + 2) == (9, 14)

    def test_thay_the_dau_chuoi(self) -> None:
        result = apply_replacements("Tokyo đẹp", [Replacement(0, 5, "Tô-ki-ô")])
        assert result.spoken == "Tô-ki-ô đẹp"

    def test_thay_the_cuoi_chuoi(self) -> None:
        result = apply_replacements("Đến Tokyo", [Replacement(4, 9, "Tô-ki-ô")])
        assert result.spoken == "Đến Tô-ki-ô"
        assert result.to_source_range(4, 6) == (4, 9)

    def test_thay_the_toan_chuoi(self) -> None:
        result = apply_replacements("Tokyo", [Replacement(0, 5, "Tô-ki-ô")])
        assert result.spoken == "Tô-ki-ô"
        assert result.to_source_range(0, 7) == (0, 5)

    def test_khong_co_thay_the_nao(self) -> None:
        result = apply_replacements("Xin chào", [])
        assert result.spoken == "Xin chào"
        assert result.to_source_range(4, 8) == (4, 8)

    def test_bo_qua_thay_the_chong_lan(self) -> None:
        # Hai luật cùng đòi sửa một chỗ — giữ luật đến trước, bỏ luật sau.
        text = "Tokyo"
        result = apply_replacements(
            text, [Replacement(0, 5, "Tô-ki-ô"), Replacement(2, 4, "XX")]
        )
        assert result.spoken == "Tô-ki-ô"

    def test_bo_qua_thay_the_vuot_do_dai(self) -> None:
        result = apply_replacements("abc", [Replacement(1, 99, "X")])
        assert result.spoken == "abc"

    def test_bo_qua_thay_the_rong(self) -> None:
        result = apply_replacements("abc", [Replacement(1, 1, "X")])
        assert result.spoken == "abc"

    def test_thay_the_khong_theo_thu_tu_van_dung(self) -> None:
        text = "Tokyo và Kyoto"
        result = apply_replacements(
            text, [Replacement(9, 14, "Ki-ô-tô"), Replacement(0, 5, "Tô-ki-ô")]
        )
        assert result.spoken == "Tô-ki-ô và Ki-ô-tô"

    def test_text_rong(self) -> None:
        result = apply_replacements("", [Replacement(0, 1, "X")])
        assert result.spoken == ""

    def test_thay_the_ngan_hon_goc(self) -> None:
        # Bản đọc ngắn hơn bản gốc: offset phía sau phải lùi lại.
        text = "Konnichiwa nhé"
        result = apply_replacements(text, [Replacement(0, 10, "Kô-ni-chi-goa")])
        tail = result.spoken.index("nhé")
        assert result.to_source_range(tail, tail + 3) == (11, 14)


class TestCompose:
    def test_noi_hai_luot(self) -> None:
        # Lượt 1: Tokyo → Tô-ki-ô. Lượt 2 chạy trên kết quả lượt 1.
        first = apply_replacements("Đi Tokyo 2024", [Replacement(3, 8, "Tô-ki-ô")])
        index = first.spoken.index("2024")
        second = apply_replacements(
            first.spoken, [Replacement(index, index + 4, "hai không hai tư")]
        )
        result = compose(first, second)

        assert result.source == "Đi Tokyo 2024"
        assert result.spoken == "Đi Tô-ki-ô hai không hai tư"

    def test_quy_nguoc_qua_hai_luot(self) -> None:
        first = apply_replacements("Đi Tokyo 2024", [Replacement(3, 8, "Tô-ki-ô")])
        index = first.spoken.index("2024")
        second = apply_replacements(
            first.spoken, [Replacement(index, index + 4, "hai không hai tư")]
        )
        result = compose(first, second)

        # "hai" đầu tiên của phần số → quy về đúng "2024" ở bản gốc
        pos = result.spoken.index("hai")
        assert result.to_source_range(pos, pos + 3) == (9, 13)

    def test_doan_da_thay_o_luot_dau_van_giu_co(self) -> None:
        first = apply_replacements("Đi Tokyo nhé", [Replacement(3, 8, "Tô-ki-ô")])
        second = apply_replacements(first.spoken, [])
        result = compose(first, second)

        # Dù lượt 2 không thay gì, "Tô" vẫn phải nới về trọn "Tokyo"
        assert result.to_source_range(3, 5) == (3, 8)

    def test_luot_dau_khong_doi(self) -> None:
        first = identity("Tokyo")
        second = apply_replacements("Tokyo", [Replacement(0, 5, "Tô-ki-ô")])
        result = compose(first, second)
        assert result.spoken == "Tô-ki-ô"
        assert result.source == "Tokyo"
        assert result.to_source_range(0, 2) == (0, 5)

    def test_luot_sau_khong_doi(self) -> None:
        first = apply_replacements("Tokyo", [Replacement(0, 5, "Tô-ki-ô")])
        second = identity(first.spoken)
        result = compose(first, second)
        assert result.spoken == "Tô-ki-ô"
        assert result.source == "Tokyo"

    def test_ca_hai_deu_rong(self) -> None:
        result = compose(identity(""), identity(""))
        assert result.spoken == ""


class TestToSourceRange:
    def test_spans_rong_tra_nguyen_khoang(self) -> None:
        assert to_source_range((), 2, 5) == (2, 5)

    def test_khoang_dao_nguoc_van_xu_ly_duoc(self) -> None:
        spans = identity("abcdef").spans
        assert to_source_range(spans, 5, 2) == (2, 5)

    def test_khoang_vuot_qua_cuoi_bi_kep(self) -> None:
        spans = identity("abc").spans
        start, end = to_source_range(spans, 0, 99)
        assert (start, end) == (0, 3)

    def test_mot_span_bi_thay_bung_ra_hai_bien(self) -> None:
        span = Span(
            source_start=0, source_end=5, spoken_start=0, spoken_end=20, replaced=True
        )
        assert to_source_range((span,), 7, 9) == (0, 5)

    def test_khoang_trai_dai_qua_nhieu_span(self) -> None:
        text = "Tokyo và Kyoto"
        result = apply_replacements(
            text, [Replacement(0, 5, "Tô-ki-ô"), Replacement(9, 14, "Ki-ô-tô")]
        )
        # Trải từ đầu tới cuối → phủ trọn cả chuỗi gốc
        assert result.to_source_range(0, len(result.spoken)) == (0, 14)


class TestNormalizedTextInvariants:
    """Bất biến phải đúng với mọi kết quả chuẩn hoá."""

    def _cases(self) -> list[NormalizedText]:
        return [
            identity("Xin chào Tokyo"),
            apply_replacements("Đi Tokyo chơi", [Replacement(3, 8, "Tô-ki-ô")]),
            apply_replacements(
                "Tokyo và Kyoto",
                [Replacement(0, 5, "Tô-ki-ô"), Replacement(9, 14, "Ki-ô-tô")],
            ),
            apply_replacements("Konnichiwa nhé", [Replacement(0, 10, "Kô-ni-chi-goa")]),
        ]

    def test_span_noi_lien_khong_ho(self) -> None:
        for case in self._cases():
            for previous, current in zip(case.spans, case.spans[1:], strict=False):
                assert previous.source_end == current.source_start
                assert previous.spoken_end == current.spoken_start

    def test_span_phu_tron_hai_ban(self) -> None:
        for case in self._cases():
            assert case.spans[0].source_start == 0
            assert case.spans[0].spoken_start == 0
            assert case.spans[-1].source_end == len(case.source)
            assert case.spans[-1].spoken_end == len(case.spoken)

    def test_doan_khong_doi_thi_hai_ben_dai_bang_nhau(self) -> None:
        for case in self._cases():
            for span in case.spans:
                if not span.replaced:
                    assert span.source_length == span.spoken_length

    def test_moi_khoang_quy_nguoc_deu_nam_trong_text_goc(self) -> None:
        for case in self._cases():
            for start in range(len(case.spoken)):
                source_start, source_end = case.to_source_range(start, start + 1)
                assert 0 <= source_start <= source_end <= len(case.source)
