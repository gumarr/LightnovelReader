"""Engine TTS. Mỗi engine một file, chỉ file đó import thư viện của nó.

`piper.py` là chỗ duy nhất import `piper`; `vieneu.py` là chỗ duy nhất import
`vieneu`. Nhờ vậy phần còn lại của sidecar test được mà không cần model trên đĩa.

`EngineRegistry` là thứ nơi gọi nên dùng — nó chọn engine theo `VoiceEntry`, để
`main.py` không phải biết voice nào chạy bằng gì.
"""

from .base import EngineError, SynthesisResult, TTSEngine
from .piper import PiperEngine
from .registry import EngineRegistry
from .vieneu import DEFAULT_STYLE, STYLES, VieneuEngine

__all__ = [
    "DEFAULT_STYLE",
    "STYLES",
    "EngineError",
    "EngineRegistry",
    "PiperEngine",
    "SynthesisResult",
    "TTSEngine",
    "VieneuEngine",
]
