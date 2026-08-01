"""Test dựng `WordTiming`.

Dữ liệu phoneme trong file này lấy **từ chạy thật** với model
`vi_VN-vais1000-medium`, không bịa: đó là lý do các test biên (`"Ừ. À. Ồ."`,
`"Lớp 11-5"`) phản ánh đúng thứ sẽ gặp trên sách thật.
"""

from __future__ import annotations

import pytest

from app.audio.timings import (
    PhonemeChunk,
    estimate_word_timings,
    group_phonemes_by_word,
    split_words,
    word_timings_from_phonemes,
)

RATE = 22050


def _chunk(raw: str, samples: int = 512) -> PhonemeChunk:
    """Dựng chunk từ chuỗi phoneme, mỗi phoneme cùng số mẫu.

    Số mẫu bằng nhau để test tập trung vào **cách gộp nhóm**, không lẫn với
    chuyện phân bổ thời lượng.
    """
    phonemes = list(raw)
    return PhonemeChunk(phonemes=phonemes, samples_per_phoneme=[samples] * len(phonemes))


class TestSplitWords:
    def test_giu_dung_vi_tri_ky_tu(self) -> None:
        """UI cần `charStart`/`charEnd` để tô đúng đoạn text đang đọc."""
        spans = split_words("Xin chào bạn")

        assert [s.word for s in spans] == ["Xin", "chào", "bạn"]
        assert (spans[1].char_start, spans[1].char_end) == (4, 8)

    def test_giu_nguyen_chu_co_dau_tieng_viet(self) -> None:
        """`[a-zA-Z]` sẽ xé 'trở' thành 'tr' + 'ở' — lỗi làm vỡ mọi từ có dấu."""
        assert [s.word for s in split_words("Chitose trở về")] == ["Chitose", "trở", "về"]

    def test_bo_dau_cau_ra_ngoai_tu(self) -> None:
        spans = split_words("Cô ấy nói: “Đi thôi!”")
        assert [s.word for s in spans] == ["Cô", "ấy", "nói", "Đi", "thôi"]

    def test_giu_chu_so_lam_mot_tu(self) -> None:
        assert [s.word for s in split_words("Lớp 11 có 30 bạn")] == [
            "Lớp",
            "11",
            "có",
            "30",
            "bạn",
        ]

    def test_chuoi_rong(self) -> None:
        assert split_words("") == []
        assert split_words("!!! ,,,") == []


class TestEstimateWordTimings:
    def test_phu_kin_toan_bo_thoi_luong(self) -> None:
        """Từ đầu bắt đầu ở 0, từ cuối kết thúc đúng `duration_ms`."""
        timings = estimate_word_timings("một hai ba", 3000)

        assert timings[0].start_ms == 0
        assert timings[-1].end_ms == 3000

    def test_cac_moc_noi_lien_nhau(self) -> None:
        """Khe hở giữa hai từ làm highlight nhấp nháy khi phát."""
        timings = estimate_word_timings("một hai ba bốn", 4000)

        for before, after in zip(timings, timings[1:], strict=False):
            assert before.end_ms == after.start_ms

    def test_tu_nhieu_ky_tu_khong_duoc_nhieu_thoi_gian_hon_khi_cung_am_tiet(
        self,
    ) -> None:
        """Tiếng Việt đơn âm tiết: `nghiêng` và `à` đọc gần bằng nhau.

        Đây là **đảo ngược có chủ ý** so với bản trước P6.1. Bản cũ chia theo độ
        dài ký tự nên cấp cho `nghiêng` gấp 7 lần `à`; đo trên alignment thật của
        Piper thì hai từ chênh nhau không đáng kể. Xem `sidecar/probe/`.
        """
        timings = estimate_word_timings("nghiêng à", 2000)

        dai = timings[0].end_ms - timings[0].start_ms
        ngan = timings[1].end_ms - timings[1].start_ms
        # Chỉ chênh do hệ số kéo dài từ cuối, không do số ký tự.
        assert ngan > dai

    def test_tu_phien_am_co_gach_noi_thanh_nhieu_tu(self) -> None:
        """`Tô-ki-ô` được `split_words` tách sẵn thành 3 từ, mỗi từ 1 âm tiết.

        Khoá lại hành vi này vì `count_syllables_vi` **dựa vào** nó: nếu sau này
        `_WORD_PATTERN` nhận thêm `-` thì cả ba âm tiết dồn vào một từ và bị cấp
        thời lượng của một âm tiết — highlight sẽ lệch ở mọi tên riêng phiên âm.
        """
        timings = estimate_word_timings("Tô-ki-ô à", 2000)

        assert [t.w for t in timings] == ["Tô", "ki", "ô", "à"]

    def test_tieng_anh_dem_theo_cum_nguyen_am(self) -> None:
        """EN không đơn âm tiết: `international` phải dài hơn `a` nhiều."""
        timings = estimate_word_timings("international a", 2000, "en")

        dai = timings[0].end_ms - timings[0].start_ms
        ngan = timings[1].end_ms - timings[1].start_ms
        assert dai > ngan * 2

    def test_dau_cau_khong_duoc_cap_them_thoi_luong(self) -> None:
        """Piper gộp khoảng lặng vào chính từ — cấp thêm là tính hai lần.

        Đo trên 12 dấu phẩy trong audio thật: khe hở luôn đúng bằng 0 ms.
        Khoá lại vì đây là thứ trực giác rất muốn "sửa" ngược lại.
        """
        co_dau = estimate_word_timings("một, hai ba", 3000)
        khong_dau = estimate_word_timings("một hai ba", 3000)

        assert [t.start_ms for t in co_dau] == [t.start_ms for t in khong_dau]

    def test_tu_cuoi_duoc_keo_dai_hon(self) -> None:
        """Phrase-final lengthening: từ cuối segment đọc dài hơn từ giữa."""
        timings = estimate_word_timings("một hai ba", 3000)

        giua = timings[1].end_ms - timings[1].start_ms
        cuoi = timings[2].end_ms - timings[2].start_ms
        assert cuoi > giua

    def test_ngon_ngu_la_roi_ve_vi(self) -> None:
        """Ngôn ngữ chưa hỗ trợ vẫn phải chạy, không ném lỗi."""
        assert estimate_word_timings("một hai", 2000, "de") == estimate_word_timings(
            "một hai", 2000, "vi"
        )

    def test_thoi_luong_khong_hop_le(self) -> None:
        assert estimate_word_timings("một hai", 0) == []
        assert estimate_word_timings("một hai", -5) == []

    def test_khong_co_tu_nao(self) -> None:
        assert estimate_word_timings("!!!", 1000) == []


class TestGroupPhonemesByWord:
    def test_gom_theo_khoang_trang(self) -> None:
        groups = group_phonemes_by_word(list("ab cd"), [100] * 5)
        assert len(groups) == 2

    def test_giu_tron_so_mau(self) -> None:
        """Ký tự ranh giới vẫn chiếm thời lượng thật — bỏ đi là timing trôi dần."""
        samples = [100] * 5
        assert sum(group_phonemes_by_word(list("ab cd"), samples)) == sum(samples)

    def test_bo_qua_dau_bat_dau_ket_thuc(self) -> None:
        """`^` và `$` của espeak là mốc câu, không phải từ."""
        groups = group_phonemes_by_word(list("^ab cd$"), [100] * 7)
        assert len(groups) == 2


class TestWordTimingsFromPhonemes:
    def test_khop_so_tu_thi_dung_alignment(self) -> None:
        # "Xin chào." → ^sˈin|tʃˈaː2w.$  (lấy từ chạy thật)
        chunks = [_chunk("^sin tʃaw.$")]
        timings = word_timings_from_phonemes("Xin chào.", chunks, RATE)

        assert [t.w for t in timings] == ["Xin", "chào"]
        assert timings[0].start_ms == 0

    def test_cac_moc_noi_lien_nhau(self) -> None:
        chunks = [_chunk("^sin tʃaw.$")]
        timings = word_timings_from_phonemes("Xin chào.", chunks, RATE)

        for before, after in zip(timings, timings[1:], strict=False):
            assert before.end_ms == after.start_ms

    def test_nhieu_cau_thi_noi_tiep_nhau(self) -> None:
        """Piper tổng hợp MỖI CÂU MỘT CHUNK.

        Bản đầu chỉ nhận một mảng phoneme phẳng rồi so với số từ của cả segment,
        nên `"Ừ. À. Ồ."` (3 chunk, mỗi chunk 1 từ) luôn lệch và rơi về ước lượng
        — trong khi alignment hoàn toàn dùng được. Đây là ca chạy thật đã bắt
        được lỗi đó.
        """
        chunks = [_chunk("^y2.$"), _chunk("^a2.$"), _chunk("^o2.$")]
        timings = word_timings_from_phonemes("Ừ. À. Ồ.", chunks, RATE)

        assert [t.w for t in timings] == ["Ừ", "À", "Ồ"]
        # Mốc phải tăng dần xuyên qua ranh giới chunk, không reset về 0.
        assert timings[0].end_ms == timings[1].start_ms
        assert timings[1].end_ms == timings[2].start_ms

    def test_lech_so_tu_thi_tra_rong(self) -> None:
        """`"Lớp 11-5"`: espeak đọc số thành nhiều từ nên số nhóm lệch số từ.

        Gán lệch một nhịp sẽ sai cho MỌI từ phía sau — tệ hơn hẳn ước lượng đều,
        nên trả rỗng để nơi gọi rơi về `estimate_word_timings`.
        """
        chunks = [_chunk("^a b c d$")]
        assert word_timings_from_phonemes("chỉ hai từ", chunks, RATE) == []

    def test_do_dai_khong_khop_thi_tra_rong(self) -> None:
        """Vi phạm hợp đồng của Piper — alignment hỏng, không đoán tiếp."""
        bad = PhonemeChunk(phonemes=["a", "b"], samples_per_phoneme=[100])
        assert word_timings_from_phonemes("một hai", [bad], RATE) == []

    def test_khong_co_chunk_nao(self) -> None:
        assert word_timings_from_phonemes("một hai", [], RATE) == []

    def test_tan_so_khong_hop_le(self) -> None:
        assert word_timings_from_phonemes("một", [_chunk("^a$")], 0) == []

    def test_giu_vi_tri_ky_tu_trong_text_goc(self) -> None:
        chunks = [_chunk("^sin tʃaw.$")]
        timings = word_timings_from_phonemes("Xin chào.", chunks, RATE)

        assert (timings[1].char_start, timings[1].char_end) == (4, 8)

    @pytest.mark.parametrize("rate", [22050, 24000])
    def test_thoi_luong_ti_le_nghich_voi_tan_so(self, rate: int) -> None:
        """Cùng số mẫu, tần số cao hơn thì thời lượng ngắn hơn."""
        chunks = [PhonemeChunk(["a"], [rate])]
        timings = word_timings_from_phonemes("một", chunks, rate)
        assert timings[0].end_ms == 1000
