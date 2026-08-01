"""Engine TTS Piper — nạp model ONNX và tổng hợp một segment.

Đây là chỗ **duy nhất** trong sidecar import `piper`. Mọi thứ khác (resample,
mã hoá, timing) là hàm thuần trên mảng numpy, nên test được mà không cần voice
63 MB trên đĩa.

**Vì sao có cache model.** Nạp `vi_VN-vais1000-medium` mất ~1.2 s. Generate cả
chương là hàng trăm segment; nạp lại mỗi lần thì riêng phần nạp đã lâu hơn cả
phần tổng hợp. Cache giữ model theo `voice_id` và chỉ nhả khi đổi giọng.

**Vì sao nạp lười (lazy).** Sidecar khởi động cùng app, nhưng user có thể chỉ
đọc sách mà không bao giờ bấm generate. Nạp sẵn lúc khởi động là bắt mọi người
trả 1.2 s + ~200 MB RAM cho chức năng có thể không dùng tới. Đổi lại,
`engine_ready` phản ánh "đã nạp xong voice nào đó", không phải "sẵn sàng nạp".
"""

from __future__ import annotations

import logging
import threading
from pathlib import Path

import numpy as np

from ..audio import (
    DEFAULT_BITRATE,
    PhonemeChunk,
    encode_opus,
    estimate_word_timings,
    resample,
    target_rate_for_opus,
    word_timings_from_phonemes,
)
from ..voices.catalog import VoiceEntry, is_installed, voice_dir
from .base import EngineError, SynthesisResult

_LOGGER = logging.getLogger(__name__)


def _model_paths(models_dir: Path, entry: VoiceEntry) -> tuple[Path, Path]:
    """Đường dẫn `.onnx` và `.onnx.json` của một voice.

    Lấy qua `voice_dir()` của catalog, **không** tự ghép `models_dir / voices /
    id` lần nữa — hai chỗ ghép path là hai chỗ để lệch nhau.
    """
    directory = voice_dir(models_dir, entry.id)
    model = next((f for f in entry.files if f.kind == "model"), None)
    config = next((f for f in entry.files if f.kind == "config"), None)
    if model is None or config is None:
        raise EngineError(f"Catalog thiếu file model/config cho voice {entry.id}")
    return directory / model.filename, directory / config.filename


class PiperEngine:
    """Giữ một model đã nạp và tổng hợp segment từ nó.

    **An toàn luồng.** FastAPI chạy handler đồng bộ trong thread pool, và
    `onnxruntime.InferenceSession.run` không hứa an toàn khi gọi song song trên
    cùng một session. Một `Lock` bao quanh cả phần nạp lẫn phần chạy: tổng hợp
    vốn ngốn CPU nên chạy song song cũng không nhanh hơn, mà lại dễ hỏng.
    """

    def __init__(self, models_dir: Path) -> None:
        self._models_dir = models_dir
        self._lock = threading.Lock()
        self._voice: object | None = None
        self._voice_id: str | None = None
        self._sample_rate: int = 0

    @property
    def ready(self) -> bool:
        """Đã nạp xong một voice chưa — đây là giá trị `engine_ready` của `/health`."""
        return self._voice is not None

    @property
    def loaded_voice_id(self) -> str | None:
        return self._voice_id

    def unload(self) -> None:
        with self._lock:
            self._voice = None
            self._voice_id = None
            self._sample_rate = 0

    def _load_locked(self, entry: VoiceEntry) -> None:
        """Nạp model. Chỉ gọi khi đã giữ `_lock`."""
        if self._voice_id == entry.id and self._voice is not None:
            return

        if not is_installed(self._models_dir, entry):
            raise EngineError(
                f"Voice {entry.id} chưa được cài hoặc file không đủ. "
                "Vào màn Giọng đọc để tải lại."
            )

        model_path, config_path = _model_paths(self._models_dir, entry)

        try:
            from piper import PiperVoice
        except ImportError as exc:  # pragma: no cover — thiếu dep là lỗi đóng gói
            raise EngineError(
                "Không nạp được thư viện piper. Bản đóng gói thiếu piper-tts "
                "hoặc onnxruntime."
            ) from exc

        # Nhả model cũ TRƯỚC khi nạp model mới: mỗi model ~200 MB RAM, giữ cả
        # hai cùng lúc là đỉnh bộ nhớ gấp đôi không cần thiết.
        self._voice = None
        self._voice_id = None

        try:
            # `include_alignments=True` để lấy số mẫu mỗi phoneme. Cần package
            # `onnx`; thiếu nó thì piper CHỈ ghi log cảnh báo rồi trả về
            # `phoneme_alignments = None` — không ném. Ta không coi đó là lỗi vì
            # vẫn còn đường ước lượng theo ký tự, nhưng `timing_source` sẽ báo.
            voice = PiperVoice.load(
                str(model_path), config_path=str(config_path), include_alignments=True
            )
        except Exception as exc:
            # `is_installed` chỉ kiểm KÍCH THƯỚC, không băm lại (63 MB băm mỗi
            # lần mở màn hình là quá đắt). Nên file sửa tay vẫn lọt tới đây —
            # bắt và nói rõ, đừng để lỗi ONNX thô nổi lên UI.
            raise EngineError(
                f"Không nạp được model của voice {entry.id}: {exc}. "
                "File có thể đã hỏng — thử xoá rồi tải lại voice."
            ) from exc

        self._voice = voice
        self._voice_id = entry.id
        self._sample_rate = int(voice.config.sample_rate)
        _LOGGER.info("Đã nạp voice %s (%d Hz)", entry.id, self._sample_rate)

    def synthesize(
        self, text: str, entry: VoiceEntry, bitrate: int = DEFAULT_BITRATE
    ) -> SynthesisResult:
        """Tổng hợp một segment thành audio Opus + mốc thời gian từng từ."""
        if not text.strip():
            raise EngineError("Không có nội dung để đọc")

        with self._lock:
            self._load_locked(entry)
            voice = self._voice
            src_rate = self._sample_rate
            if voice is None:
                raise EngineError(f"Voice {entry.id} chưa nạp được")

            try:
                chunks = list(voice.synthesize(text, include_alignments=True))
            except Exception as exc:
                raise EngineError(f"Piper tổng hợp thất bại: {exc}") from exc

        if not chunks:
            raise EngineError("Piper không sinh ra audio nào cho đoạn văn này")

        # Piper trả MỖI CÂU MỘT CHUNK — nối lại thành một segment liền mạch.
        audio = np.concatenate([c.audio_float_array for c in chunks])
        if audio.size == 0:
            raise EngineError("Piper trả về audio rỗng")

        duration_ms = round(audio.size * 1000 / src_rate)

        # Chỉ dùng alignment khi MỌI chunk đều có. Thiếu một chunk mà vẫn ghép
        # sẽ làm các từ phía sau lệch hẳn một câu.
        phoneme_chunks: list[PhonemeChunk] = []
        if all(c.phoneme_alignments for c in chunks):
            phoneme_chunks = [
                PhonemeChunk(
                    phonemes=[a.phoneme for a in c.phoneme_alignments],
                    samples_per_phoneme=[int(a.num_samples) for a in c.phoneme_alignments],
                )
                for c in chunks
            ]

        timings = word_timings_from_phonemes(text, phoneme_chunks, src_rate)
        timing_source = "phoneme"
        if not timings:
            # Rơi về ước lượng: chữ số đọc thành nhiều từ, hoặc model không hỗ
            # trợ alignment. Vẫn dùng được, chỉ kém chính xác hơn.
            # `entry.lang` chứ không phải mặc định: cách đếm âm tiết khác hẳn
            # giữa VI (đơn âm tiết) và EN (đếm cụm nguyên âm). Bỏ tham số này
            # thì sách tiếng Anh bị tính theo luật tiếng Việt mà không báo gì.
            timings = estimate_word_timings(text, duration_ms, entry.lang)
            timing_source = "estimate"

        dst_rate = target_rate_for_opus(src_rate)
        encoded = encode_opus(resample(audio, src_rate, dst_rate), dst_rate, bitrate)

        return SynthesisResult(
            audio=encoded,
            timings=timings,
            timing_source=timing_source,
            voice_id=entry.id,
        )
