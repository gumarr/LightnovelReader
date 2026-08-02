"""Engine TTS VieNeu — 14 giọng preset + giọng nhân bản, chạy ONNX, không PyTorch.

Đây là chỗ **duy nhất** trong sidecar import `vieneu`, y như `piper.py` với
`piper`. Mọi thứ khác (resample, mã hoá, timing) dùng chung.

## Vì sao có engine này

Giọng Piper tiếng Việt chạy tốt và nhanh nhưng nghe máy móc với truyện dài.
VieNeu v3 Turbo cho giọng tự nhiên hơn hẳn, có sẵn phong cách `doc_truyen`,
và **vẫn chạy ONNX Runtime** — thứ đã có sẵn cho Piper, nên không kéo PyTorch.

## Ba điểm khác Piper, đều cố ý

1. **14 giọng dùng chung MỘT bộ model 244 MB.** Piper mỗi giọng một file 63 MB;
   VieNeu tải một lần rồi chọn giọng bằng tên (`preset_voice`). Vì vậy catalog
   có `modelId` — xem `voices/catalog.py`.

2. **Không có word alignment, và không thể có.** Codec MOSS chạy 12,5
   token/giây, mỗi token là 80 ms audio **đã nén** — ranh giới token không
   tương ứng ranh giới từ. Khác Piper phát âm theo phoneme nên số mẫu mỗi
   phoneme là thông tin có thật. Nên `timing_source` ở đây **luôn** là
   `estimate`. P6.1 đã cải tiến `estimate` xuống lệch trung bình 60 ms chính vì
   biết trước sẽ tới bước này.

3. **Model tải bằng hệ thống tải của dự án, không phải `huggingface_hub`.**
   SDK mặc định tự tải về `~/.cache/huggingface`, ở ngoài thư mục app: user
   không thấy tiến độ, không huỷ được, Storage manager không đếm, gỡ app không
   xoá. Nên ta trỏ `onnx_dir` vào thư mục voice do `download.py` ghi ra.

## Hai cách chỉ định giọng

- `preset_voice` — tên một trong 14 giọng dựng sẵn trong model.
- `speaker_emb` — vector 192 chiều của giọng **nhân bản**, nhúng trong catalog.

Catalog đã chặn việc khai cả hai. Đường clone không cần thêm file nào ngoài
`speaker_encoder.onnx` (28 MB, nằm trong bộ model dùng chung) và **không** kéo
torch: hàm dựng đặc trưng của SDK gọi `torchaudio.compliance.kaldi`, nên ta tự
tính fbank bằng numpy ở `app/audio/fbank.py` — xem chú thích ở đó để biết vì sao
đánh đổi này là đúng (đo thật: torch CPU chiếm 527 MB).
"""

from __future__ import annotations

import logging
import os
import threading
from pathlib import Path
from typing import Any

import numpy as np

from ..audio import (
    DEFAULT_BITRATE,
    encode_opus,
    estimate_word_timings,
    resample,
    target_rate_for_opus,
)
from ..voices.catalog import VoiceEntry, is_installed, voice_dir
from .base import EngineError, SynthesisResult

_LOGGER = logging.getLogger(__name__)

# Phong cách đọc. VieNeu nhận `style` lúc tổng hợp chứ không phải lúc nạp model,
# nên đổi phong cách **không** phải nạp lại 244 MB.
STYLES = ("doc_truyen", "tu_nhien", "tin_tuc")
DEFAULT_STYLE = "doc_truyen"

# Tần số VieNeu xuất ra. Không đọc từ config model vì SDK cố định 48 kHz cho
# v3 Turbo; ghi hằng số ở đây để chỗ resample không phải đoán.
SAMPLE_RATE = 48000

# Thư mục con trong voice dir, khớp `saveAs` của catalog. Trùng tên với cây thư
# mục trên HF là **bắt buộc**: SDK tự tìm `config.json`/`tokenizer.json` theo
# đúng tên bên trong `onnx_dir`.
ONNX_SUBDIR = "onnx_int8"
MOSS_SUBDIR = "moss"


class VieneuEngine:
    """Giữ một model VieNeu đã nạp và tổng hợp segment từ nó.

    **An toàn luồng** giống `PiperEngine`: `onnxruntime.InferenceSession.run`
    không hứa an toàn khi gọi song song trên cùng một session, nên một `Lock`
    bao cả phần nạp lẫn phần chạy.

    **Cache theo bộ model, không theo giọng.** 14 giọng dùng chung một model;
    đổi giọng chỉ là đổi tham số lúc gọi `infer`. Nạp lại khi user đổi giọng sẽ
    tốn 3 giây cho đúng không việc gì.
    """

    def __init__(self, models_dir: Path, style: str = DEFAULT_STYLE) -> None:
        self._models_dir = models_dir
        self._lock = threading.Lock()
        self._tts: Any = None
        # `id` của voice MANG model (không phải giọng đang chọn) — đây là thứ
        # quyết định có phải nạp lại hay không.
        self._model_voice_id: str | None = None
        self._style = style if style in STYLES else DEFAULT_STYLE

    @property
    def ready(self) -> bool:
        return self._tts is not None

    @property
    def loaded_voice_id(self) -> str | None:
        return self._model_voice_id

    @property
    def style(self) -> str:
        return self._style

    def set_style(self, style: str) -> None:
        """Đổi phong cách đọc. Không cần nạp lại model."""
        if style not in STYLES:
            raise EngineError(
                f"Phong cách {style!r} không hợp lệ, phải là một trong {list(STYLES)}"
            )
        self._style = style

    def unload(self) -> None:
        with self._lock:
            self._close_locked()

    def _close_locked(self) -> None:
        tts = self._tts
        self._tts = None
        self._model_voice_id = None
        if tts is None:
            return
        # SDK giữ vài `InferenceSession`; đóng tường minh để nhả RAM ngay thay
        # vì chờ GC. Lỗi lúc đóng không được che lỗi thật đang xảy ra ở nơi gọi.
        close = getattr(tts, "close", None)
        if close is None:
            return
        try:
            close()
        except Exception:  # noqa: BLE001
            _LOGGER.warning("Đóng model VieNeu thất bại", exc_info=True)

    def _load_locked(self, model_entry: VoiceEntry) -> None:
        """Nạp model. Chỉ gọi khi đã giữ `_lock`."""
        if self._model_voice_id == model_entry.id and self._tts is not None:
            return

        if not is_installed(self._models_dir, model_entry):
            raise EngineError(
                f"Bộ model VieNeu chưa tải xong hoặc thiếu file. "
                "Vào màn Giọng đọc để tải lại."
            )

        directory = voice_dir(self._models_dir, model_entry.id)
        onnx_dir = directory / ONNX_SUBDIR
        moss_dir = directory / MOSS_SUBDIR

        # Cấm SDK gọi Hugging Face. Model đã nằm sẵn trên đĩa (tải qua
        # `download.py`), nhưng `huggingface_hub` vẫn thử kiểm bản mới ở mỗi lần
        # nạp — trên máy không mạng thì đó là vài chục giây chờ timeout trước khi
        # đọc đúng file ngay cạnh nó. Đây là app đọc **offline**, và mọi request
        # mạng không ai yêu cầu đều là lỗi (CLAUDE.md: không telemetry).
        #
        # Đặt trước khi import: `huggingface_hub` đọc các biến này lúc import
        # module, không phải lúc gọi hàm.
        os.environ.setdefault("HF_HUB_OFFLINE", "1")
        os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
        os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")

        try:
            from vieneu import Vieneu
        except ImportError as exc:  # pragma: no cover — thiếu dep là lỗi đóng gói
            raise EngineError(
                "Không nạp được thư viện vieneu. Bản đóng gói thiếu vieneu "
                "hoặc sea-g2p."
            ) from exc

        # Nhả model cũ TRƯỚC khi nạp model mới: giữ cả hai cùng lúc là đỉnh bộ
        # nhớ gấp đôi không cần thiết.
        self._close_locked()

        try:
            tts = Vieneu(
                mode="v3turbo",
                # Trỏ thẳng vào thư mục đã tải: SDK sẽ KHÔNG gọi mạng. Thiếu
                # tham số này thì nó tự tải về cache HF và app treo im lặng vài
                # phút ở lần generate đầu tiên.
                onnx_dir=str(onnx_dir),
                moss_tokenizer=str(moss_dir),
                precision="int8",
                backend="onnx",
            )
        except Exception as exc:
            raise EngineError(
                f"Không nạp được model VieNeu: {exc}. "
                "File có thể đã hỏng — thử xoá rồi tải lại giọng."
            ) from exc

        self._tts = tts
        self._model_voice_id = model_entry.id
        _LOGGER.info("Đã nạp model VieNeu từ %s", onnx_dir)

    def synthesize(
        self,
        text: str,
        entry: VoiceEntry,
        bitrate: int = DEFAULT_BITRATE,
        model_entry: VoiceEntry | None = None,
    ) -> SynthesisResult:
        """Tổng hợp một segment.

        `model_entry` là voice **mang file model** (`resolve_model_entry`).
        Không truyền thì coi `entry` tự mang — đúng với voice VieNeu đầu tiên.
        """
        if not text.strip():
            raise EngineError("Không có nội dung để đọc")

        provider = model_entry or entry
        # Giọng nhân bản đưa thẳng vector vào SDK dưới dạng dict; giọng preset
        # đưa tên. Catalog đã chặn khai cả hai, nên ở đây chỉ cần chọn nhánh.
        voice: str | dict[str, Any]
        if entry.is_cloned:
            voice = {"speaker_emb": np.asarray(entry.speaker_emb, dtype=np.float32)}
        elif entry.preset_voice:
            voice = entry.preset_voice
        else:
            raise EngineError(
                f"Voice {entry.id} thiếu cả presetVoice lẫn speakerEmb trong catalog"
            )

        with self._lock:
            self._load_locked(provider)
            tts = self._tts
            if tts is None:  # pragma: no cover — `_load_locked` đã ném
                raise EngineError("Model VieNeu chưa nạp được")

            try:
                audio = tts.infer(
                    text,
                    voice=voice,
                    style=self._style,
                    # Không đóng dấu chìm: đây là audio user tự sinh trên máy
                    # mình để nghe, không phải nội dung phát tán.
                    apply_watermark=False,
                    # `denoise` cần PyTorch — bật lên là ném ở máy user.
                    denoise=False,
                    # Giọng nhân bản chỉ có embedding, KHÔNG có `codes`. Để mặc
                    # định `True` thì SDK đi tìm `codes` trong dict và ném
                    # `KeyError`. Giọng preset thì vẫn dùng codes như cũ.
                    use_ref_codes=not entry.is_cloned,
                )
            except Exception as exc:
                raise EngineError(f"VieNeu tổng hợp thất bại: {exc}") from exc

        audio = np.asarray(audio, dtype=np.float32).reshape(-1)
        if audio.size == 0:
            raise EngineError("VieNeu trả về audio rỗng")

        duration_ms = round(audio.size * 1000 / SAMPLE_RATE)

        # LUÔN là `estimate` — xem chú thích đầu file. Không có nhánh nào khác,
        # và đó là sự thật về engine này chứ không phải phần chưa làm.
        timings = estimate_word_timings(text, duration_ms, entry.lang)

        dst_rate = target_rate_for_opus(SAMPLE_RATE)
        encoded = encode_opus(resample(audio, SAMPLE_RATE, dst_rate), dst_rate, bitrate)

        return SynthesisResult(
            audio=encoded,
            timings=timings,
            timing_source="estimate",
            voice_id=entry.id,
        )
