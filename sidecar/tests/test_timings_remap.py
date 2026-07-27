"""Test quy `char_start`/`char_end` từ text đã chuẩn hoá về text gốc.

Đây là mắt xích cuối của P3.5: mọi thứ trước đó đúng mà bước này sai thì
highlight vẫn lệch. Và lệch kiểu **im lặng** — không lỗi nào nổ ra, chỉ có chữ
sáng sai chỗ khi nhìn app chạy.
"""

from __future__ import annotations

from app.audio.timings import (
    WordTiming,
    estimate_word_timings,
    remap_to_source,
)
from app.text import normalize_mapped
from app.text.mapping import Replacement, apply_replacements, identity


class TestRemapToSource:
    def test_khong_co_span_thi_giu_nguyen(self) -> None:
        timings = [WordTiming(w="a", start_ms=0, end_ms=10, char_start=0, char_end=1)]
        assert remap_to_source(timings, identity("")) == timings

    def test_text_khong_doi_thi_offset_khong_doi(self) -> None:
        normalized = identity("Xin chào bạn")
        timings = estimate_word_timings(normalized.spoken, 1000)
        result = remap_to_source(timings, normalized)
        assert [(t.char_start, t.char_end) for t in result] == [
            (t.char_start, t.char_end) for t in timings
        ]

    def test_quy_ve_tu_goc_khi_co_thay_the(self) -> None:
        normalized = apply_replacements("Đi Tokyo chơi", [Replacement(3, 8, "Tô-ki-ô")])
        timings = estimate_word_timings(normalized.spoken, 1000)
        result = remap_to_source(timings, normalized)

        # Mọi mảnh của "Tô-ki-ô" đều trỏ về trọn "Tokyo" = [3, 8)
        middle = [t for t in result if 3 <= t.char_start < 8]
        assert middle, "phải có ít nhất một từ trỏ vào vùng đã thay"
        for timing in middle:
            assert (timing.char_start, timing.char_end) == (3, 8)

    def test_giu_nguyen_tu_da_doc_trong_truong_w(self) -> None:
        # `w` là từ Piper THỰC SỰ đọc — đổi thành từ gốc sẽ che mất thông tin
        # cần khi truy lỗi phát âm.
        normalized = apply_replacements("Đi Tokyo", [Replacement(3, 8, "Tô-ki-ô")])
        timings = estimate_word_timings(normalized.spoken, 1000)
        result = remap_to_source(timings, normalized)
        assert [t.w for t in result] == [t.w for t in timings]

    def test_giu_nguyen_moc_thoi_gian(self) -> None:
        normalized = apply_replacements("Đi Tokyo", [Replacement(3, 8, "Tô-ki-ô")])
        timings = estimate_word_timings(normalized.spoken, 1000)
        result = remap_to_source(timings, normalized)
        assert [(t.start_ms, t.end_ms) for t in result] == [
            (t.start_ms, t.end_ms) for t in timings
        ]

    def test_offset_luon_nam_trong_text_goc(self) -> None:
        source = "Chuyến Shinkansen từ Tokyo lúc 14:30."
        normalized = normalize_mapped(source, "vi")
        timings = estimate_word_timings(normalized.spoken, 5000)
        result = remap_to_source(timings, normalized)

        for timing in result:
            assert 0 <= timing.char_start <= timing.char_end <= len(source)

    def test_danh_sach_rong(self) -> None:
        normalized = apply_replacements("Tokyo", [Replacement(0, 5, "Tô-ki-ô")])
        assert remap_to_source([], normalized) == []


class TestPipelineDauCuoi:
    """Chạy trọn `normalize_mapped` rồi kiểm offset — gần nhất với thực tế."""

    def test_ten_nhat_quy_ve_dung_vi_tri(self) -> None:
        source = "Chuyến Shinkansen từ Tokyo đến Kyoto."
        normalized = normalize_mapped(source, "vi")

        assert "Sin-can-xên" in normalized.spoken
        assert "Tô-ki-ô" in normalized.spoken

        # Vị trí "Tokyo" trong bản gốc
        tokyo_start = source.index("Tokyo")
        tokyo_end = tokyo_start + len("Tokyo")

        # Mọi ký tự của "Tô-ki-ô" ở bản đọc phải quy về đúng khoảng đó
        spoken_start = normalized.spoken.index("Tô-ki-ô")
        for offset in range(len("Tô-ki-ô")):
            index = spoken_start + offset
            assert normalized.to_source_range(index, index + 1) == (tokyo_end - 5, tokyo_end)

    def test_cau_co_ca_ten_nhat_va_so(self) -> None:
        source = "Năm 2024, Asuka đến Osaka."
        normalized = normalize_mapped(source, "vi")
        timings = estimate_word_timings(normalized.spoken, 4000)
        result = remap_to_source(timings, normalized)

        for timing in result:
            assert 0 <= timing.char_start <= timing.char_end <= len(source)

    def test_text_thuan_viet_khong_bi_doi(self) -> None:
        source = "Hôm nay trời đẹp quá."
        normalized = normalize_mapped(source, "vi")
        assert normalized.spoken == source

    def test_offset_khop_khi_khong_co_gi_thay_doi(self) -> None:
        source = "Hôm nay trời đẹp quá."
        normalized = normalize_mapped(source, "vi")
        timings = estimate_word_timings(normalized.spoken, 2000)
        result = remap_to_source(timings, normalized)

        # Không đổi gì → offset phải trùng khít, và cắt ra đúng từ đó.
        for timing in result:
            assert source[timing.char_start : timing.char_end] == timing.w

    def test_lang_en_van_co_mapping(self) -> None:
        normalized = normalize_mapped("Chapter 3 begins.", "en")
        timings = estimate_word_timings(normalized.spoken, 2000)
        result = remap_to_source(timings, normalized)
        for timing in result:
            assert 0 <= timing.char_start <= timing.char_end <= len(normalized.source)

    def test_text_rong(self) -> None:
        normalized = normalize_mapped("", "vi")
        assert normalized.spoken == ""
        assert remap_to_source([], normalized) == []
