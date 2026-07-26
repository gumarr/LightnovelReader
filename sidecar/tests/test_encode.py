"""Test mã hoá Opus.

Không so bytes với một file chép cứng: libsndfile nâng phiên bản là bytes đổi,
mà test đỏ kiểu đó chẳng nói lên điều gì về chất lượng. Thay vào đó kiểm những
thứ **thật sự quan trọng**: file đọc lại được, đúng thời lượng, đúng tần số, và
bitrate rơi đúng khoảng đã chọn.
"""

from __future__ import annotations

import io

import numpy as np
import pytest
import soundfile as sf

from app.audio.encode import (
    DEFAULT_BITRATE,
    SUPPORTED_BITRATES,
    EncodeError,
    encode_opus,
    quality_for_bitrate,
    write_opus,
)

RATE = 24000


def _speech_like(seconds: float = 3.0, rate: int = RATE) -> np.ndarray:
    """Tín hiệu gần giọng nói: sóng mang trầm + hài + chút nhiễu.

    Dùng thay cho sine thuần vì Opus là codec tối ưu cho giọng nói — nén một
    sine thuần cho bitrate thấp bất thường và không phản ánh dữ liệu thật.
    """
    rs = np.random.RandomState(0)
    t = np.arange(int(rate * seconds), dtype=np.float64) / rate
    envelope = 0.6 + 0.4 * np.sin(2 * np.pi * 3 * t)
    signal = 0.3 * np.sin(2 * np.pi * 160 * t) * envelope
    signal += 0.12 * np.sin(2 * np.pi * 700 * t)
    signal += 0.03 * rs.randn(t.size)
    return signal.astype(np.float32)


class TestQualityForBitrate:
    @pytest.mark.parametrize("bitrate", SUPPORTED_BITRATES)
    def test_moi_bitrate_ho_tro_deu_co_muc_nen(self, bitrate: int) -> None:
        level = quality_for_bitrate(bitrate)
        assert 0.0 <= level <= 1.0

    def test_bitrate_cao_hon_thi_nen_it_hon(self) -> None:
        """`compression_level` của libsndfile NGƯỢC chiều với bitrate.

        Đảo dấu là lỗi rất dễ mắc, và hậu quả là chọn 32 kbps lại ra file nhỏ
        hơn 16 kbps — không ai để ý cho tới lúc so dung lượng.
        """
        assert quality_for_bitrate(32) < quality_for_bitrate(24) < quality_for_bitrate(16)

    def test_bitrate_khong_ho_tro_thi_nem(self) -> None:
        """Im lặng rơi về mặc định là loại lỗi chỉ lộ ra khi user so dung lượng."""
        with pytest.raises(EncodeError, match="không hỗ trợ"):
            quality_for_bitrate(48)


class TestEncodeOpus:
    def test_doc_lai_duoc_va_dung_tan_so(self) -> None:
        encoded = encode_opus(_speech_like(), RATE, DEFAULT_BITRATE)

        data, rate = sf.read(io.BytesIO(encoded.data))
        assert rate == RATE
        assert data.size > 0

    def test_thoi_luong_tinh_tu_so_mau_dau_vao(self) -> None:
        """Không đọc lại file đã mã hoá để lấy thời lượng.

        Opus đệm thêm mẫu im lặng ở đầu (pre-skip) nên đọc lại ra dài hơn thật
        vài chục ms — đủ để timing từng từ trôi lệch dần về cuối segment.
        """
        encoded = encode_opus(_speech_like(seconds=2.0), RATE, DEFAULT_BITRATE)
        assert encoded.duration_ms == 2000

    @pytest.mark.parametrize("bitrate", SUPPORTED_BITRATES)
    def test_bitrate_roi_dung_khoang(self, bitrate: int) -> None:
        """Bảng quy đổi phải cho ra bitrate gần đúng con số user chọn.

        Khoảng ±35% là rộng, nhưng đây là VBR trên tín hiệu tổng hợp — mục đích
        là bắt lỗi lệch **bậc** (chọn 16 mà ra 130 kbps), không phải đo chính xác.
        """
        seconds = 5.0
        encoded = encode_opus(_speech_like(seconds=seconds), RATE, bitrate)
        measured = encoded.size_bytes * 8 / seconds / 1000
        assert bitrate * 0.65 <= measured <= bitrate * 1.35

    def test_bitrate_cao_cho_file_lon_hon(self) -> None:
        audio = _speech_like(seconds=5.0)
        sizes = [encode_opus(audio, RATE, b).size_bytes for b in (16, 24, 32)]
        assert sizes[0] < sizes[1] < sizes[2]

    def test_tan_so_opus_khong_nhan_thi_nem_kem_huong_dan(self) -> None:
        """22050 Hz là đúng cái Piper xuất ra — lỗi này sẽ gặp thật nếu quên resample."""
        with pytest.raises(EncodeError, match="resample"):
            encode_opus(_speech_like(rate=22050), 22050, DEFAULT_BITRATE)

    def test_tu_choi_mang_rong(self) -> None:
        with pytest.raises(EncodeError):
            encode_opus(np.zeros(0, dtype=np.float32), RATE, DEFAULT_BITRATE)

    def test_tu_choi_audio_nhieu_kenh(self) -> None:
        with pytest.raises(EncodeError):
            encode_opus(np.zeros((100, 2), dtype=np.float32), RATE, DEFAULT_BITRATE)

    def test_cat_ngon_vuot_bien_do(self) -> None:
        """Vượt [-1, 1] thì libsndfile cuộn vòng thành tiếng 'tách' rất rõ."""
        loud = (_speech_like(seconds=1.0) * 5.0).astype(np.float32)
        encoded = encode_opus(loud, RATE, DEFAULT_BITRATE)

        data, _ = sf.read(io.BytesIO(encoded.data))
        # Cho phép vọt nhẹ do codec, nhưng không được cuộn vòng sang dấu ngược.
        assert float(np.max(np.abs(data))) < 1.5


class TestWriteOpus:
    def test_ghi_ra_dia_va_doc_lai_duoc(self, tmp_path) -> None:
        encoded = encode_opus(_speech_like(seconds=1.0), RATE, DEFAULT_BITRATE)
        target = tmp_path / "book" / "seg1.ogg"

        write_opus(target, encoded)

        assert target.is_file()
        assert target.stat().st_size == encoded.size_bytes
        _, rate = sf.read(target)
        assert rate == RATE

    def test_khong_de_lai_file_part(self, tmp_path) -> None:
        """`.part` còn sót nghĩa là lần ghi trước chết giữa chừng mà không dọn."""
        encoded = encode_opus(_speech_like(seconds=1.0), RATE, DEFAULT_BITRATE)
        target = tmp_path / "seg1.ogg"

        write_opus(target, encoded)

        assert list(tmp_path.glob("*.part")) == []

    def test_tu_tao_thu_muc_cha(self, tmp_path) -> None:
        """Thư mục `{audioDir}/{bookId}/` chưa tồn tại ở segment đầu tiên của sách."""
        encoded = encode_opus(_speech_like(seconds=0.5), RATE, DEFAULT_BITRATE)
        target = tmp_path / "chua" / "co" / "seg.ogg"

        write_opus(target, encoded)

        assert target.is_file()
