"""Hợp đồng chung cho mọi engine TTS.

Tách ra ở P6.2 khi có engine thứ hai. Trước đó `SynthesisResult` và
`EngineError` nằm trong `piper.py` — đúng lúc chỉ có một engine, nhưng để
`vieneu.py` import từ `piper.py` thì engine mới phụ thuộc engine cũ mà chẳng vì
lý do gì.

**Chữ ký `synthesize` không đổi so với P2.4.** `SynthesisResult` vốn đã không
mang gì riêng của Piper (audio đã mã hoá + timing + nguồn timing + voice id),
nên thêm engine thứ hai không phải sửa nơi gọi. Đó là lý do phần này rẻ.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from ..audio import DEFAULT_BITRATE, EncodedAudio, WordTiming
from ..voices.catalog import VoiceEntry


class EngineError(RuntimeError):
    """Không tổng hợp được — thông báo đã ở dạng đọc được cho user."""


@dataclass(frozen=True)
class SynthesisResult:
    """Kết quả tổng hợp một segment."""

    audio: EncodedAudio
    timings: list[WordTiming]
    # `phoneme` = alignment thật (Piper), `estimate` = ước lượng theo âm tiết.
    # Đưa lên tới UI để biết vì sao highlight lệch, thay vì đoán mò.
    #
    # VieNeu **luôn** trả `estimate`: codec của nó chạy 12,5 token/giây và ranh
    # giới token là đơn vị nén, không phải ranh giới từ. Đây là khác biệt kiến
    # trúc, không phải tính năng còn thiếu — xem PROGRESS mục 4.79.
    timing_source: str
    voice_id: str


class TTSEngine(Protocol):
    """Thứ mà `EngineRegistry` cần ở một engine.

    Dùng `Protocol` thay vì lớp cha: hai engine không chia sẻ một dòng code nào
    (Piper nạp `.onnx` qua thư viện piper, VieNeu nạp qua SDK riêng), nên kế
    thừa chỉ tạo ra một lớp cha rỗng để trông cho giống hướng đối tượng.
    """

    @property
    def ready(self) -> bool:
        """Đã nạp xong một voice chưa — giá trị `engine_ready` của `/health`."""
        ...

    @property
    def loaded_voice_id(self) -> str | None: ...

    def unload(self) -> None:
        """Nhả model đang giữ. Phải gọi được cả khi chưa nạp gì."""
        ...

    def synthesize(
        self, text: str, entry: VoiceEntry, bitrate: int = DEFAULT_BITRATE
    ) -> SynthesisResult:
        """Tổng hợp một segment thành audio Opus + mốc thời gian từng từ.

        Ném `EngineError` khi không tổng hợp được, **không** trả về kết quả
        rỗng: nơi gọi phân biệt được lỗi với "đọc ra im lặng" thì mới báo đúng
        cho user cách sửa.
        """
        ...
