"""Test cho `speaker_fbank` — fbank Kaldi bản numpy.

Không so trực tiếp với torchaudio ở đây: torch **không** nằm trong dependency của
sidecar (và cả lý do tồn tại của module này là để khỏi cài nó). Phép đối chiếu
với torchaudio nằm ở `sidecar/probe/speaker_probe.py`, chạy tay trong venv riêng.

Ở đây khoá các **tính chất bất biến** — thứ vỡ ra ngay nếu ai đó chỉnh tham số
hoặc viết lại vòng lặp khung.
"""

from __future__ import annotations

import numpy as np
import pytest

from app.audio.fbank import N_MELS, SPEAKER_SAMPLE_RATE, speaker_fbank


def _tone(seconds: float, freq: float = 220.0, rate: int = SPEAKER_SAMPLE_RATE) -> np.ndarray:
    """Sóng sin ở thang int16 — đúng quy ước đầu vào của `speaker_fbank`."""
    t = np.arange(int(seconds * rate), dtype=np.float64) / rate
    return (np.sin(2.0 * np.pi * freq * t) * 16_000.0).astype(np.float32)


def _speechlike(
    seconds: float,
    freq: float = 220.0,
    rate: int = SPEAKER_SAMPLE_RATE,
    noise: float = 200.0,
) -> np.ndarray:
    """Tín hiệu **không dừng**: sin có bao biên độ thay đổi + chút nhiễu.

    Sin thuần là ca suy biến ở đây: mọi khung giống hệt nhau, nên bước trừ trung
    bình theo cột triệt tiêu sạch và fbank về ~1e-14. Đó là tính chất đúng của
    phép biến đổi, nhưng làm tín hiệu này vô dụng để so sánh nội dung phổ. Giọng
    người thì luôn biến thiên — dùng tín hiệu biến thiên mới đo được thứ cần đo.
    """
    n = int(seconds * rate)
    t = np.arange(n, dtype=np.float64) / rate
    envelope = 0.5 + 0.5 * np.sin(2.0 * np.pi * 3.0 * t)
    rng = np.random.default_rng(1234)
    grain = rng.standard_normal(n) * noise
    return (np.sin(2.0 * np.pi * freq * t) * envelope * 12_000.0 + grain).astype(np.float32)


def test_shape_theo_cong_thuc_khung() -> None:
    """1 giây 16 kHz: khung 400 mẫu, bước 160 → 1 + (16000-400)//160 = 98 khung."""
    out = speaker_fbank(_tone(1.0))
    assert out.shape == (98, N_MELS)


def test_tra_ve_float32() -> None:
    # ONNX session khai báo input float32; trả float64 là lỗi kiểu lúc chạy thật.
    assert speaker_fbank(_tone(0.5)).dtype == np.float32


def test_audio_ngan_hon_mot_khung_tra_mang_rong() -> None:
    """Ngắn hơn 25 ms thì không đủ một khung — phải trả rỗng, không được ném."""
    out = speaker_fbank(_tone(0.01))
    assert out.shape == (0, N_MELS)


def test_mang_rong_tra_mang_rong() -> None:
    out = speaker_fbank(np.zeros(0, dtype=np.float32))
    assert out.shape == (0, N_MELS)


def test_da_tru_trung_binh_theo_tung_he_so() -> None:
    """`mean_norm` bật: trung bình mỗi cột phải ~0. Quên bước này thì embedding
    lệch hẳn vì encoder được huấn luyện trên đặc trưng đã chuẩn hoá."""
    out = speaker_fbank(_tone(1.0))
    assert np.abs(out.mean(axis=0)).max() < 1e-3


def test_khong_co_nan_hay_inf_voi_audio_im_lang() -> None:
    """Audio toàn 0 → power = 0 → log(0) = -inf nếu thiếu sàn eps.

    Đây là ca thật: đoạn lặng đầu file thu là chuyện thường.
    """
    out = speaker_fbank(np.zeros(SPEAKER_SAMPLE_RATE, dtype=np.float32))
    assert np.isfinite(out).all()


def test_bat_bien_voi_do_lech_mot_chieu() -> None:
    """Cộng thêm hằng số (lệch DC) không được đổi kết quả: Kaldi bỏ DC theo từng
    khung trước preemphasis. Rơi mất bước đó là test này đỏ."""
    clean = _speechlike(0.5)
    shifted = clean + 500.0
    assert np.allclose(speaker_fbank(clean), speaker_fbank(shifted), atol=1e-2)


def test_tan_so_khac_nhau_cho_dac_trung_khac_nhau() -> None:
    """Phép kiểm tỉnh táo: fbank phải thật sự phản ánh nội dung phổ, chứ không
    phải trả ra cùng một mảng cho mọi đầu vào.

    So **năng lượng tại đúng dải mel của từng tần số**, không so `argmax` toàn
    cục: bao biên độ 3 Hz và nhiễu nền chi phối các bin thấp nên `argmax` của cả
    hai đều rơi vào bin 2, không phân biệt được gì.
    """
    low = speaker_fbank(_speechlike(0.5, freq=150.0, noise=0.0))
    high = speaker_fbank(_speechlike(0.5, freq=3000.0, noise=0.0))
    assert not np.allclose(low, high, atol=0.5)

    # Dải bin **đo được**, không phải đoán: 150 Hz kích bin 3–6, 3000 Hz kích
    # bin 51–53. Dùng phương sai vì bao biên độ 3 Hz làm năng lượng dao động
    # theo thời gian đúng ở dải chứa sóng mang.
    low_band, high_band = slice(3, 7), slice(51, 54)
    assert low[:, low_band].var() > high[:, low_band].var()
    assert high[:, high_band].var() > low[:, high_band].var()


def test_sin_tuan_hoan_theo_buoc_khung_bi_triet_tieu() -> None:
    """Ghi lại ca suy biến để phiên sau khỏi tưởng là lỗi.

    Bước khung là 160 mẫu ở 16 kHz = 100 Hz. Sin có tần số **chia hết** cho 100 Hz
    (150 Hz thì 160 mẫu đúng 1.5 chu kỳ, 3000 Hz đúng 30 chu kỳ) khiến mọi khung
    giống hệt nhau, nên bước trừ trung bình theo cột triệt tiêu sạch → fbank ≈ 0.
    Tần số không chia hết (220 Hz) thì các khung lệch pha dần và fbank khác 0.

    Đây là hệ quả đúng của `mean_norm` trên tín hiệu dừng, **không phải fbank
    hỏng** — và là lý do các test so sánh phổ phải dùng `_speechlike`.
    """
    assert np.abs(speaker_fbank(_tone(0.5, freq=150.0))).max() < 1e-6
    assert np.abs(speaker_fbank(_tone(0.5, freq=3000.0))).max() < 1e-6
    assert np.abs(speaker_fbank(_tone(0.5, freq=220.0))).max() > 1.0


@pytest.mark.parametrize("seconds", [0.03, 0.5, 2.0])
def test_so_khung_tang_don_dieu_theo_do_dai(seconds: float) -> None:
    out = speaker_fbank(_tone(seconds))
    expected = 1 + (int(seconds * SPEAKER_SAMPLE_RATE) - 400) // 160
    assert out.shape[0] == max(expected, 0)


def test_nhan_dau_vao_1_chieu_bat_ke_kieu() -> None:
    """Người gọi hay đưa float64 từ soxr — không được ném."""
    out = speaker_fbank(_tone(0.5).astype(np.float64))
    assert out.shape[0] > 0
