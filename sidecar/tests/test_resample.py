"""Test cho bộ resample polyphase.

Đây là module dễ sai một cách **im lặng** nhất của P2.4: resample hỏng thì audio
vẫn phát được, chỉ là nhỏ tiếng, méo, hoặc lệch cao độ — không có exception nào
để bắt. Nên test ở đây đo **tính chất tín hiệu** (hệ số khuếch đại, tần số, độ
dài) chứ không so từng mẫu với một mảng chép cứng.

Hai lỗi thật đã bị bắt bằng chính những test này khi viết P2.4:

1. Chuẩn hoá bộ lọc về "tổng = 1" thay vì "tổng mỗi pha = 1" → audio nhỏ đi 160
   lần, gần như câm.
2. Tần số cắt lấy `1/up` thay vì `1/max(up, down)` → 4 kHz gập xuống 2 kHz.
"""

from __future__ import annotations

import math

import numpy as np
import pytest

from app.audio.resample import (
    PIPER_SAMPLE_RATE,
    ResampleError,
    design_lowpass,
    resample,
)

SRC = 22050
DST = 24000


def _sine(freq: float, rate: int, seconds: float = 1.0, amp: float = 0.5) -> np.ndarray:
    t = np.arange(int(rate * seconds), dtype=np.float64) / rate
    return (amp * np.sin(2 * np.pi * freq * t)).astype(np.float32)


def _rms(x: np.ndarray) -> float:
    return float(np.sqrt(np.mean(x.astype(np.float64) ** 2)))


def _dominant_freq(x: np.ndarray, rate: int) -> float:
    """Tần số có năng lượng lớn nhất, dùng cửa sổ Hann để bớt rò phổ."""
    windowed = x.astype(np.float64) * np.hanning(x.size)
    spectrum = np.abs(np.fft.rfft(windowed))
    return float(np.argmax(spectrum) * rate / x.size)


class TestDesignLowpass:
    def test_tong_moi_pha_bang_mot(self) -> None:
        """Bất biến quan trọng nhất: mỗi mẫu ra chỉ chạm MỘT pha của bộ lọc.

        Vì vậy điều kiện giữ nguyên biên độ là "tổng mỗi pha = 1", không phải
        "tổng cả bộ lọc = 1". Chuẩn hoá nhầm về 1 làm audio nhỏ đi đúng `up` lần.
        """
        up, down = 160, 147
        taps = design_lowpass(up, down)

        for phase in (0, 1, up // 2, up - 1):
            assert taps[phase::up].sum() == pytest.approx(1.0, abs=1e-3)

    def test_tong_toan_bo_bang_up(self) -> None:
        up, down = 160, 147
        assert design_lowpass(up, down).sum() == pytest.approx(up, rel=1e-9)

    def test_bo_loc_doi_xung(self) -> None:
        """FIR pha tuyến tính phải đối xứng — lệch là tín hiệu ra bị méo pha."""
        taps = design_lowpass(160, 147)
        assert np.allclose(taps, taps[::-1], atol=1e-12)

    def test_up_down_khong_hop_le(self) -> None:
        with pytest.raises(ResampleError):
            design_lowpass(0, 147)
        with pytest.raises(ResampleError):
            design_lowpass(160, -1)


class TestResampleTinhChatTinHieu:
    @pytest.mark.parametrize("freq", [100, 440, 1000, 4000, 8000])
    def test_giu_nguyen_bien_do_trong_dai_thong(self, freq: int) -> None:
        """Giọng nói nằm gọn dưới 8 kHz — cả dải này phải đi qua gần như nguyên vẹn."""
        src = _sine(freq, SRC)
        out = resample(src, SRC, DST)

        # Bỏ biên: đầu và cuối luôn có hiệu ứng quá độ của FIR.
        gain = _rms(out[900:-900]) / _rms(src[900:-900])
        assert gain == pytest.approx(1.0, abs=0.02)

    @pytest.mark.parametrize("freq", [100, 440, 1000, 4000])
    def test_khong_doi_tan_so(self, freq: int) -> None:
        """Bắt đúng lỗi tần số cắt sai: 4 kHz từng bị gập xuống 2 kHz."""
        out = resample(_sine(freq, SRC), SRC, DST)
        assert _dominant_freq(out[900:-900], DST) == pytest.approx(freq, rel=0.01)

    def test_giu_nguyen_thanh_phan_mot_chieu(self) -> None:
        out = resample(np.full(SRC, 0.5, dtype=np.float32), SRC, DST)
        assert float(np.mean(out[2000:-2000])) == pytest.approx(0.5, abs=1e-3)

    def test_do_dai_dung_ti_le(self) -> None:
        out = resample(_sine(440, SRC, seconds=2.0), SRC, DST)
        assert out.size == math.ceil(SRC * 2 * DST / SRC)

    def test_khong_vuot_bien_do_cho_phep(self) -> None:
        """Vượt [-1, 1] sẽ bị cắt ngọn (clip) lúc mã hoá, nghe thành rè."""
        out = resample(_sine(440, SRC, amp=0.95), SRC, DST)
        assert float(np.max(np.abs(out))) < 1.0


class TestResampleTruongHopBien:
    def test_cung_tan_so_thi_tra_nguyen_ban(self) -> None:
        """Lọc thừa một lần là mất một chút dải cao mà chẳng được gì."""
        src = _sine(440, SRC)
        assert np.array_equal(resample(src, SRC, SRC), src)

    def test_mang_rong(self) -> None:
        out = resample(np.zeros(0, dtype=np.float32), SRC, DST)
        assert out.size == 0

    def test_tra_ve_float32(self) -> None:
        """soundfile ghi thẳng float32; trả float64 là tăng gấp đôi bộ nhớ vô ích."""
        assert resample(_sine(440, SRC), SRC, DST).dtype == np.float32

    def test_tu_choi_audio_nhieu_kenh(self) -> None:
        with pytest.raises(ResampleError):
            resample(np.zeros((100, 2), dtype=np.float32), SRC, DST)

    def test_tu_choi_tan_so_khong_duong(self) -> None:
        with pytest.raises(ResampleError):
            resample(_sine(440, SRC), 0, DST)
        with pytest.raises(ResampleError):
            resample(_sine(440, SRC), SRC, -1)

    def test_tan_so_nguon_cua_piper(self) -> None:
        """Khoá lại con số: đổi nó là mọi voice trong catalog phải đổi theo."""
        assert PIPER_SAMPLE_RATE == 22050
