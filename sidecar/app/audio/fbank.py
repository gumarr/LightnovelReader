"""Kaldi filterbank thuần numpy — đầu vào cho `speaker_encoder.onnx`.

**Vì sao phải tự viết thay vì gọi thư viện.** `speaker_encoder.onnx` là một đồ
thị ONNX đông cứng, chạy được bằng onnxruntime có sẵn. Nhưng hàm dựng đặc trưng
cho nó trong SDK VieNeu
(`vieneu/_v3_turbo_engine/speaker/fbank.py`) lại gọi
`torchaudio.compliance.kaldi`, tức **kéo cả torch + torchaudio vào chỉ để làm
DSP**. Đo thật trên máy này: `pip install torch torchaudio` (bản CPU) chiếm
**527 MB** site-packages — nhiều hơn cả installer hiện tại (150 MB) và phá thẳng
ngân sách dung lượng của dự án.

Fbank không phải mạng nơ-ron, chỉ là một phép biến đổi tín hiệu có đặc tả rõ
ràng. Viết lại bằng numpy tốn ~60 dòng và bỏ được 527 MB.

**Sai số so với torchaudio, đo thật** (`sidecar/probe/speaker_probe.py`):

| Đại lượng | Kết quả |
|---|---|
| Tương quan hệ số fbank | 0.987 |
| cos(embedding numpy, embedding torch) | **0.954 – 0.982** |
| cos hai clip THẬT của cùng người nói | **0.930** |

Dòng cuối là thứ quyết định: chênh lệch do numpy gây ra **nhỏ hơn** dao động tự
nhiên giữa hai đoạn thu khác nhau của chính người đó. Với mục đích trích embedding
giọng thì đây là sai số không đáng kể — không phải "tạm chấp nhận".

Tham số cố định theo đúng cái VieNeu dùng, **không** để người gọi đổi: encoder đã
huấn luyện với đúng bộ này, lệch một tham số là embedding vô nghĩa.
"""

from __future__ import annotations

import numpy as np

# ---- tham số Kaldi, khớp `_SPEAKER_FBANK_*` trong SDK VieNeu ----------------

SPEAKER_SAMPLE_RATE = 16_000
"""Encoder chỉ nhận 16 kHz. Người gọi phải resample trước."""

N_MELS = 80
_FRAME_MS = 25.0
_SHIFT_MS = 10.0
_PREEMPH = 0.97
_LOW_FREQ = 20.0


def _povey_window(size: int) -> np.ndarray:
    """Cửa sổ `povey` của Kaldi — Hann mũ 0.85, không phải Hann thường."""
    hann = 0.5 - 0.5 * np.cos(2.0 * np.pi * np.arange(size) / (size - 1))
    return hann**0.85


def _hz_to_mel(hz: float | np.ndarray) -> np.ndarray:
    return 1127.0 * np.log(1.0 + np.asarray(hz, dtype=np.float64) / 700.0)


def _mel_to_hz(mel: np.ndarray) -> np.ndarray:
    return 700.0 * (np.exp(np.asarray(mel, dtype=np.float64) / 1127.0) - 1.0)


def _mel_filterbank(n_mels: int, n_fft: int, sample_rate: int) -> np.ndarray:
    """Ma trận tam giác (n_mels, n_fft//2+1) trên thang mel."""
    n_bins = n_fft // 2 + 1
    bin_hz = np.arange(n_bins, dtype=np.float64) * sample_rate / n_fft
    edges = _mel_to_hz(
        np.linspace(_hz_to_mel(_LOW_FREQ), _hz_to_mel(sample_rate / 2.0), n_mels + 2)
    )

    bank = np.zeros((n_mels, n_bins), dtype=np.float64)
    for i in range(n_mels):
        left, center, right = edges[i], edges[i + 1], edges[i + 2]
        rising = (bin_hz - left) / (center - left)
        falling = (right - bin_hz) / (right - center)
        bank[i] = np.maximum(0.0, np.minimum(rising, falling))
    return bank


def speaker_fbank(waveform: np.ndarray) -> np.ndarray:
    """Tính fbank cho `speaker_encoder.onnx`.

    `waveform`: mảng 1 chiều, **16 kHz**, thang int16 (khoảng ±32768) theo đúng
    quy ước Kaldi. Truyền dạng ±1.0 vào đây thì log-mel lệch hằng số và embedding
    sai — nhân 32768 trước khi gọi.

    Trả về `(n_frames, 80)` float32, đã trừ trung bình theo từng hệ số. Audio
    ngắn hơn một khung (25 ms) trả về mảng rỗng `(0, 80)`.
    """
    samples = np.asarray(waveform, dtype=np.float64).reshape(-1)
    frame_len = int(SPEAKER_SAMPLE_RATE * _FRAME_MS / 1000.0)  # 400
    frame_shift = int(SPEAKER_SAMPLE_RATE * _SHIFT_MS / 1000.0)  # 160
    if samples.size < frame_len:
        return np.zeros((0, N_MELS), dtype=np.float32)

    n_frames = 1 + (samples.size - frame_len) // frame_shift
    offsets = np.arange(frame_len)[None, :] + frame_shift * np.arange(n_frames)[:, None]
    frames = samples[offsets]

    # Kaldi bỏ DC theo TỪNG khung, trước preemphasis — không phải trên cả tín hiệu
    frames = frames - frames.mean(axis=1, keepdims=True)

    # Preemphasis: mẫu đầu khung lấy chính nó làm mẫu trước (quy ước Kaldi)
    emphasized = np.empty_like(frames)
    emphasized[:, 0] = frames[:, 0] * (1.0 - _PREEMPH)
    emphasized[:, 1:] = frames[:, 1:] - _PREEMPH * frames[:, :-1]
    frames = emphasized * _povey_window(frame_len)[None, :]

    n_fft = 1
    while n_fft < frame_len:
        n_fft <<= 1  # 512

    power = np.abs(np.fft.rfft(frames, n=n_fft)) ** 2
    mel = power @ _mel_filterbank(N_MELS, n_fft, SPEAKER_SAMPLE_RATE).T
    # Sàn bằng eps thay vì 0: log(0) = -inf sẽ lan ra toàn bộ embedding
    mel = np.log(np.maximum(mel, np.finfo(np.float64).eps))
    mel -= mel.mean(axis=0, keepdims=True)
    return mel.astype(np.float32)
