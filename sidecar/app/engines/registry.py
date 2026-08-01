"""Chọn engine theo voice và giữ model đã nạp.

Trước P6.2 chỉ có `PiperEngine` nên `main.py` giữ thẳng một instance. Với hai
engine thì nơi gọi không nên biết voice nào chạy bằng gì — đó là việc của
catalog, và registry là chỗ dịch từ `VoiceEntry` sang engine tương ứng.

**Giữ cả hai engine sống cùng lúc, không nhả engine cũ khi đổi.** Mỗi engine tự
quản model của nó và chỉ tốn RAM khi đã nạp; user đổi qua lại giữa giọng Piper
và giọng VieNeu là chuyện thường (nghe thử để chọn), nhả model mỗi lần đổi thì
mỗi lần đổi lại mất vài giây nạp lại.
"""

from __future__ import annotations

from pathlib import Path

from ..audio import DEFAULT_BITRATE
from ..voices.catalog import (
    ENGINE_PIPER,
    ENGINE_VIENEU,
    Catalog,
    VoiceEntry,
    resolve_model_entry,
)
from .base import EngineError, SynthesisResult
from .piper import PiperEngine
from .vieneu import DEFAULT_STYLE, VieneuEngine


class EngineRegistry:
    """Định tuyến `synthesize` tới đúng engine của voice."""

    def __init__(self, models_dir: Path, style: str = DEFAULT_STYLE) -> None:
        self._piper = PiperEngine(models_dir)
        self._vieneu = VieneuEngine(models_dir, style=style)

    @property
    def ready(self) -> bool:
        """`engine_ready` của `/health` — đã nạp xong **một** model nào đó chưa."""
        return self._piper.ready or self._vieneu.ready

    @property
    def loaded_voice_id(self) -> str | None:
        """Voice đang nạp. Hai engine cùng nạp thì báo cái Piper (nạp trước)."""
        return self._piper.loaded_voice_id or self._vieneu.loaded_voice_id

    @property
    def style(self) -> str:
        return self._vieneu.style

    def set_style(self, style: str) -> None:
        """Đổi phong cách đọc của VieNeu. Piper không có khái niệm này."""
        self._vieneu.set_style(style)

    def unload(self) -> None:
        self._piper.unload()
        self._vieneu.unload()

    def synthesize(
        self,
        text: str,
        entry: VoiceEntry,
        catalog: Catalog,
        bitrate: int = DEFAULT_BITRATE,
    ) -> SynthesisResult:
        """Tổng hợp bằng engine của `entry`.

        Cần `catalog` vì voice VieNeu dùng model chung: `entry` là giọng, còn
        file model nằm ở voice khác (`modelId`).
        """
        if entry.engine == ENGINE_PIPER:
            return self._piper.synthesize(text, entry, bitrate)
        if entry.engine == ENGINE_VIENEU:
            return self._vieneu.synthesize(
                text, entry, bitrate, model_entry=resolve_model_entry(catalog, entry)
            )
        # Catalog đã chặn engine lạ lúc parse; tới đây là lỗi lập trình, nên
        # ném rõ ràng chứ không im lặng rơi về Piper và đọc bằng giọng sai.
        raise EngineError(f"Không có engine {entry.engine!r} cho voice {entry.id}")
