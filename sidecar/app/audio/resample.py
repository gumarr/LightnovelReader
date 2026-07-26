"""Đổi tần số lấy mẫu bằng polyphase FIR — hàm thuần, chỉ dùng numpy.

**Vì sao cần module này.** Piper xuất 22050 Hz (nằm trong model `.onnx`, không
đổi được), còn libsndfile chỉ mã hoá Opus ở 8/12/16/24/48 kHz. Không resample
thì `sf.SoundFile(...)` ném thẳng:

    Opus only supports sample rates of 8000, 12000, 16000, 24000, and 48000.

**Vì sao không dùng scipy.** `scipy.signal.resample_poly` làm sẵn đúng việc này,
nhưng wheel scipy ~45 MB sẽ kéo installer từ 94 MB lên ~140 MB — cho đúng một
hàm. Đã thống nhất với user: tự viết, đổi lại là phải có test khoá chất lượng
(xem `test_resample.py`).

**Vì sao KHÔNG nội suy tuyến tính cho xong.** Nội suy tuyến tính là bộ lọc thông
thấp rất tệ: nó để lọt aliasing xuống dải nghe được, nghe ra tiếng rít kim loại
bám theo giọng. Với audio 22050 → 24000 (tăng tần số) thì aliasing đến từ bước
giảm mẫu, nên vẫn cần lọc đúng.

**Cách làm.** Đổi 22050 → 24000 là tỉ lệ hữu tỉ 147:160 (chia hết cho ước chung
150). Thuật toán chuẩn:

    1. Chèn thêm (up-1) mẫu 0 giữa mỗi cặp mẫu   → tần số × 160
    2. Lọc thông thấp ở min(Nyquist cũ, Nyquist mới)
    3. Lấy mỗi `down` mẫu một lần                → tần số ÷ 147

Bước 1 và 3 không bao giờ dựng mảng dài gấp 160 lần: `_polyphase` chỉ tính đúng
những mẫu đầu ra cần tới, bỏ qua mọi phép nhân với số 0 mà bước 1 sinh ra.
"""

from __future__ import annotations

from math import gcd

import numpy as np

# Số "cánh" của bộ lọc mỗi phía, tính theo đơn vị mẫu đầu ra. Càng lớn thì sườn
# lọc càng dốc (chặn aliasing tốt hơn) nhưng càng tốn phép nhân.
#
# 16 là mức đủ cho giọng nói: đo được suy giảm > 60 dB ở dải chặn, mà một
# segment ~10 s vẫn resample xong dưới 10 ms — không đáng kể so với ~2 s Piper
# tổng hợp cùng đoạn đó.
FILTER_HALF_WIDTH = 16

# Kaiser beta. 8.6 cho dải chặn ~ -85 dB — thừa cho tai người ở 24 kbps Opus.
KAISER_BETA = 8.6

# Tần số Piper xuất ra. Nằm trong model `.onnx` đã train sẵn nên KHÔNG đổi được
# — cả hai voice trong `resources/voices/catalog.json` đều 22050.
PIPER_SAMPLE_RATE = 22050

# Tần số libsndfile chấp nhận cho Opus. Ngoài danh sách này thì `sf.SoundFile`
# ném ngay lúc mở file, không phải lúc ghi.
OPUS_SAMPLE_RATES = (8000, 12000, 16000, 24000, 48000)

# Đích resample mặc định. Chọn 24000 chứ không phải 48000 vì giọng nói không có
# gì trên 12 kHz để giữ, mà 48 kHz thì gấp đôi số mẫu phải mã hoá. Cũng không
# chọn 16000: Opus ở 24 kbps thừa sức tải dải 12 kHz, hạ xuống 16000 là cắt mất
# âm xát (/s/, /t/) khiến giọng nghe đục.
OPUS_TARGET_RATE = 24000


def target_rate_for_opus(src_rate: int) -> int:
    """Tần số nên resample sang trước khi mã hoá Opus.

    Nguồn đã nằm trong danh sách Opus thì giữ nguyên — resample thừa một lần chỉ
    làm mất chất lượng mà không được gì.
    """
    if src_rate in OPUS_SAMPLE_RATES:
        return src_rate
    return OPUS_TARGET_RATE


class ResampleError(ValueError):
    """Tham số resample không dùng được."""


def design_lowpass(up: int, down: int, half_width: int = FILTER_HALF_WIDTH) -> np.ndarray:
    """Dựng FIR cửa sổ Kaiser cho bộ resample tỉ lệ `up/down`.

    Tần số cắt lấy `min(1/up, 1/down)` (chuẩn hoá theo tần số lấy mẫu sau khi
    chèn 0). Lấy **min** chứ không phải cố định `1/up`: khi giảm mẫu
    (`down > up`) thì Nyquist mới thấp hơn Nyquist cũ, cắt ở `1/up` sẽ để lọt
    đúng phần bị gập lại thành aliasing.
    """
    if up < 1 or down < 1:
        raise ResampleError(f"up/down phải là số nguyên dương, nhận {up}/{down}")

    # Nửa chiều dài tính trên lưới đã chèn 0, nên nhân với `up`.
    half_len = half_width * up
    n = np.arange(-half_len, half_len + 1, dtype=np.float64)

    # Tần số cắt chuẩn hoá theo lưới đã chèn 0. Lấy `max(up, down)` chứ không
    # phải `up`: khi giảm mẫu (`down > up`) thì Nyquist ĐÍCH thấp hơn Nyquist
    # nguồn, cắt theo `up` sẽ để lọt đúng phần bị gập ngược thành aliasing.
    cutoff = 1.0 / max(up, down)

    # `np.sinc` đã là sin(pi x)/(pi x) và bằng 1 tại x = 0, nên không cần tách
    # riêng trường hợp đó. Nhân thêm `cutoff` để bộ lọc lý tưởng có hệ số
    # khuếch đại 1 trước khi chuẩn hoá.
    taps = np.sinc(cutoff * n) * cutoff
    taps *= np.kaiser(taps.size, KAISER_BETA)

    # Chuẩn hoá sao cho **mỗi pha** cộng lại đúng bằng 1.
    #
    # Đây là chỗ dễ sai nhất: mỗi mẫu đầu ra chỉ chạm vào MỘT pha của bộ lọc,
    # nên điều kiện giữ nguyên biên độ là "tổng mỗi pha = 1", không phải "tổng
    # cả bộ lọc = 1". Vì có `up` pha nên tổng toàn bộ phải bằng `up`. Chuẩn hoá
    # nhầm về 1 sẽ làm audio nhỏ đi đúng 160 lần — gần như câm.
    total = taps.sum()
    if total == 0:
        raise ResampleError("Bộ lọc suy biến — half_width quá nhỏ")
    return taps * (up / total)


def _polyphase(samples: np.ndarray, up: int, down: int, taps: np.ndarray) -> np.ndarray:
    """Lọc + đổi tỉ lệ, chỉ tính những mẫu đầu ra thật sự cần.

    Cách ngây thơ là dựng mảng dài gấp `up` lần rồi `np.convolve`. Với up=160 và
    một segment 10 s thì đó là mảng 35 triệu phần tử — 280 MB cho một segment,
    trong khi 99.4% phần tử là số 0. Ở đây tính thẳng từng mẫu đầu ra: mẫu thứ
    `i` lấy pha `(i * down) % up` của bộ lọc, chỉ chạm vào các mẫu đầu vào thật.
    """
    n_in = samples.size
    if n_in == 0:
        return np.zeros(0, dtype=np.float32)

    n_out = int(np.ceil(n_in * up / down))
    half_len = (taps.size - 1) // 2

    # Vị trí mẫu đầu ra trên lưới đã chèn 0 (lưới chạy ở `src_rate * up` Hz).
    grid = np.arange(n_out, dtype=np.int64) * down

    # Với mỗi mẫu đầu ra, tìm mẫu THẬT đầu tiên mà bộ lọc chạm tới: trên lưới
    # chèn 0 chỉ vị trí chia hết cho `up` mới có mẫu thật, nên làm tròn LÊN tới
    # bội của `up` gần nhất trong khoảng phủ [centre - half_len, centre + half_len].
    first = grid - half_len
    start_real = -((-first) // up) * up

    tap0 = start_real - grid + half_len  # chỉ số tap của mẫu thật đầu tiên
    in0 = start_real // up  # chỉ số mẫu đầu vào tương ứng

    # Số mẫu thật trong tầm phủ. `tap0` luôn nằm trong [0, up) nên số này chỉ
    # nhận một trong hai giá trị liền nhau — lấy trần để phủ cả hai.
    n_taps_per_out = int((taps.size + up - 1) // up)

    # Dựng ma trận (n_out, n_taps_per_out) rồi nhân một lượt. Bản trước chạy
    # vòng lặp Python cho từng mẫu đầu ra: đúng nhưng mất 1.2 s cho một segment
    # 10 s, tức thêm ~1.6 giờ cho một cuốn 4800 segment — nhiều hơn cả thời
    # gian Piper tổng hợp. Ở đây vòng lặp giao hết cho numpy.
    offsets = np.arange(n_taps_per_out, dtype=np.int64)

    tap_idx = tap0[:, None] + offsets[None, :] * up
    in_idx = in0[:, None] + offsets[None, :]

    # Ngoài biên coi như 0 (đệm 0 ngầm) thay vì lặp mẫu biên: lặp mẫu tạo một
    # đoạn hằng số ở đầu/cuối, nghe thành tiếng "bụp" nhỏ.
    valid = (tap_idx < taps.size) & (in_idx >= 0) & (in_idx < n_in)

    coeff = np.where(valid, taps[np.clip(tap_idx, 0, taps.size - 1)], 0.0)
    values = np.where(valid, samples.astype(np.float64)[np.clip(in_idx, 0, n_in - 1)], 0.0)

    return np.einsum("ij,ij->i", coeff, values).astype(np.float32)


def resample(samples: np.ndarray, src_rate: int, dst_rate: int) -> np.ndarray:
    """Đổi `samples` (mono, float32 trong [-1, 1]) từ `src_rate` sang `dst_rate`.

    Cùng tần số thì trả nguyên bản — không đi qua bộ lọc, vì lọc thừa một lần là
    mất một chút dải cao mà chẳng được gì.
    """
    if src_rate <= 0 or dst_rate <= 0:
        raise ResampleError(f"Tần số lấy mẫu phải dương, nhận {src_rate} → {dst_rate}")
    if samples.ndim != 1:
        raise ResampleError(f"Chỉ nhận audio mono một chiều, nhận shape {samples.shape}")

    if src_rate == dst_rate:
        return samples.astype(np.float32, copy=False)

    divisor = gcd(src_rate, dst_rate)
    up = dst_rate // divisor
    down = src_rate // divisor

    taps = design_lowpass(up, down)
    return _polyphase(samples, up, down, taps)
