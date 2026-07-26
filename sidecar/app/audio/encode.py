"""Mã hoá audio thành Opus trong container `.ogg`.

Dùng `soundfile` (libsndfile) — wheel đã gói sẵn native lib ~1 MB, nên user
không phải cài ffmpeg hay DLL nào. Đổi lại là hai ràng buộc phải xử lý ở đây:

1. **Chỉ nhận 8/12/16/24/48 kHz.** Piper xuất 22050 Hz, nên luôn phải qua
   `resample` trước — xem `app/audio/resample.py`.
2. **Không đặt bitrate trực tiếp** được. libsndfile chỉ mở ra
   `compression_level` trong khoảng [0, 1]. Bảng quy đổi ở dưới lấy từ **đo
   thật**, không phải từ công thức đoán.
"""

from __future__ import annotations

import io
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import soundfile as sf

from .resample import OPUS_SAMPLE_RATES

# Bitrate cho phép — khớp `AudioBitrate` ở `packages/shared/src/types.ts`.
SUPPORTED_BITRATES = (16, 24, 32)

DEFAULT_BITRATE = 24

# Quy đổi bitrate mong muốn → `compression_level` của libsndfile.
#
# **Lấy từ đo thật**, không phải nội suy tuyến tính. Công thức tuyến tính
# `1 - kbps/256` nghe hợp lý nhưng lệch tới +7 kbps ở vùng bitrate thấp — mà
# vùng thấp lại đúng là vùng dự án này chạy (16–32 kbps). Đo trên tín hiệu giọng
# nói 30 giây ở 24 kHz cho ra:
#
#     level 0.900 → 32.0 kbps
#     level 0.933 → 23.6 kbps
#     level 0.962 → 16.4 kbps
#
# Muốn thêm bitrate mới thì phải ĐO lại rồi thêm vào đây, đừng nội suy: đường
# cong không tuyến tính, nhất là khi tiến gần 1.0.
_COMPRESSION_LEVEL = {
    16: 0.962,
    24: 0.933,
    32: 0.900,
}


class EncodeError(RuntimeError):
    """Không mã hoá được — thông báo đã ở dạng đọc được cho user."""


@dataclass(frozen=True)
class EncodedAudio:
    """Kết quả mã hoá. `duration_ms` tính từ **số mẫu**, không đo lại từ file."""

    data: bytes
    sample_rate: int
    duration_ms: int

    @property
    def size_bytes(self) -> int:
        return len(self.data)


def quality_for_bitrate(bitrate: int) -> float:
    """`compression_level` cho bitrate mong muốn.

    Bitrate lạ thì ném chứ không im lặng rơi về mặc định: user chọn 48 kbps mà
    nhận file 24 kbps là loại lỗi không ai phát hiện ra cho tới khi so dung
    lượng.
    """
    level = _COMPRESSION_LEVEL.get(bitrate)
    if level is None:
        raise EncodeError(
            f"Bitrate {bitrate} kbps không hỗ trợ. Chọn một trong {list(SUPPORTED_BITRATES)}."
        )
    return level


def encode_opus(samples: np.ndarray, sample_rate: int, bitrate: int = DEFAULT_BITRATE) -> EncodedAudio:
    """Mã hoá mảng float32 mono thành bytes `.ogg` chứa Opus.

    Trả **bytes** chứ không ghi thẳng ra file: nơi gọi cần biết kích thước để
    quyết định có ghi hay không, và ghi ra file rồi đọc lại chỉ để biết dung
    lượng là thêm một lượt I/O thừa. Hàm ghi đĩa nằm riêng ở `write_opus`.
    """
    if samples.ndim != 1:
        raise EncodeError(f"Chỉ mã hoá audio mono một chiều, nhận shape {samples.shape}")
    if samples.size == 0:
        raise EncodeError("Không có mẫu audio nào để mã hoá")
    if sample_rate not in OPUS_SAMPLE_RATES:
        # Bắt ở đây với thông báo chỉ rõ cách sửa. Để libsndfile tự ném thì lỗi
        # chỉ nói "Opus only supports sample rates of…" mà không nói phải gọi
        # `resample` trước.
        raise EncodeError(
            f"Opus không nhận {sample_rate} Hz (chỉ {list(OPUS_SAMPLE_RATES)}). "
            "Gọi app.audio.resample trước khi mã hoá."
        )

    level = quality_for_bitrate(bitrate)

    # Cắt ngọn về [-1, 1] trước khi đưa cho libsndfile. Piper đã clip sẵn, nhưng
    # resample có thể vọt lố nhẹ ở sườn dốc (hiện tượng Gibbs) — vượt biên thì
    # libsndfile cuộn vòng thành tiếng "tách" rất rõ.
    audio = np.clip(samples.astype(np.float32), -1.0, 1.0)

    buffer = io.BytesIO()
    try:
        with sf.SoundFile(
            buffer,
            mode="w",
            samplerate=sample_rate,
            channels=1,
            format="OGG",
            subtype="OPUS",
            compression_level=level,
        ) as handle:
            handle.write(audio)
    except (sf.LibsndfileError, RuntimeError) as exc:
        raise EncodeError(f"Mã hoá Opus thất bại: {exc}") from exc

    # Thời lượng tính từ số mẫu ĐẦU VÀO, không đọc lại file đã mã hoá. Opus đệm
    # thêm vài mẫu im lặng ở đầu (pre-skip) nên đọc lại sẽ ra dài hơn thật vài
    # chục mili-giây — đủ để timing từng từ trôi lệch dần về cuối segment.
    duration_ms = round(audio.size * 1000 / sample_rate)

    return EncodedAudio(data=buffer.getvalue(), sample_rate=sample_rate, duration_ms=duration_ms)


def write_opus(path: Path, encoded: EncodedAudio) -> None:
    """Ghi ra đĩa qua file tạm `.part` rồi đổi tên.

    Cùng lý do với tải voice (`app/voices/download.py`): ghi thẳng vào tên thật
    thì tiến trình chết giữa chừng để lại file `.ogg` dở dang, mà lần sau nhìn
    vào tưởng segment đã generate xong rồi phát ra tiếng cụt.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    part = path.with_name(path.name + ".part")
    try:
        part.write_bytes(encoded.data)
        part.replace(path)
    except OSError as exc:
        part.unlink(missing_ok=True)
        raise EncodeError(f"Không ghi được file audio {path}: {exc}") from exc
