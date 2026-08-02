"""Test `VieneuEngine` và `EngineRegistry` — không cần model 244 MB trên đĩa.

Cùng lối với `test_engine.py`: SDK thật được thay bằng bản giả, vì engine chỉ
dùng đúng hai thứ của nó (`infer()` và `close()`). Bản giả đủ để khoá **logic
ghép nối** — cache theo bộ model, chọn giọng preset, phong cách, xử lý lỗi.

Chất lượng audio thật đã kiểm bằng chạy thật với model thật lúc làm P6.2 (xem
PROGRESS mục 4.81), và bằng `test_resample.py` / `test_encode.py`.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from app.engines.base import EngineError
from app.engines.registry import EngineRegistry
from app.engines.vieneu import DEFAULT_STYLE, SAMPLE_RATE, VieneuEngine
from app.voices.catalog import Catalog, VoiceEntry, VoiceFile


class _FakeVieneu:
    """Bản giả của SDK `Vieneu`, đủ cho những gì engine gọi tới."""

    def __init__(self, **kwargs: Any) -> None:
        self.kwargs = kwargs
        self.calls: list[dict[str, Any]] = []
        self.closed = False

    def infer(self, text: str, **kwargs: Any) -> np.ndarray:
        self.calls.append({"text": text, **kwargs})
        seconds = 1.0
        t = np.arange(int(SAMPLE_RATE * seconds), dtype=np.float64) / SAMPLE_RATE
        return (0.3 * np.sin(2 * np.pi * 200 * t)).astype(np.float32)

    def close(self) -> None:
        self.closed = True


def _model_entry(voice_id: str = "vi_VN-vieneu-v3turbo") -> VoiceEntry:
    """Voice mang bộ model dùng chung."""
    return VoiceEntry(
        id=voice_id,
        lang="vi",
        name="VieNeu",
        quality="high",
        sample_rate=SAMPLE_RATE,
        license="Apache-2.0",
        engine="vieneu",
        preset_voice="Ngọc Linh",
        files=(
            VoiceFile(
                kind="asset",
                path="repo/onnx_int8/backbone.data",
                size_bytes=10,
                sha256="0" * 64,
                save_as="onnx_int8/backbone.data",
            ),
            VoiceFile(
                kind="asset",
                path="repo/moss/encode.onnx",
                size_bytes=4,
                sha256="1" * 64,
                save_as="moss/encode.onnx",
            ),
        ),
    )


def _shared_entry(voice_id: str = "vi_VN-vieneu-truc-ly") -> VoiceEntry:
    """Giọng dùng chung bộ model của voice khác."""
    return VoiceEntry(
        id=voice_id,
        lang="vi",
        name="VieNeu — Trúc Ly",
        quality="high",
        sample_rate=SAMPLE_RATE,
        license="Apache-2.0",
        engine="vieneu",
        preset_voice="Trúc Ly",
        model_id="vi_VN-vieneu-v3turbo",
        files=(),
    )


def _cloned_entry(voice_id: str = "vi_VN-vieneu-ngoc-huyen") -> VoiceEntry:
    """Giọng **nhân bản**: mang embedding 192 chiều thay cho tên giọng preset."""
    return VoiceEntry(
        id=voice_id,
        lang="vi",
        name="VieNeu — Ngọc Huyền",
        quality="high",
        sample_rate=SAMPLE_RATE,
        license="CC BY-NC 4.0",
        engine="vieneu",
        model_id="vi_VN-vieneu-v3turbo",
        files=(),
        speaker_emb=tuple(float(i) / 100.0 for i in range(192)),
    )


def _piper_entry(voice_id: str = "vi_VN-test-medium") -> VoiceEntry:
    return VoiceEntry(
        id=voice_id,
        lang="vi",
        name="Piper",
        quality="medium",
        sample_rate=22050,
        license="MIT",
        engine="piper",
        files=(
            VoiceFile(kind="model", path="m.onnx", size_bytes=10, sha256="0" * 64),
            VoiceFile(kind="config", path="m.onnx.json", size_bytes=4, sha256="1" * 64),
        ),
    )


def _install(models_dir: Path, entry: VoiceEntry) -> None:
    """Tạo file đúng KÍCH THƯỚC catalog — `is_installed` chỉ kiểm kích thước."""
    directory = models_dir / "voices" / entry.id
    for file in entry.files:
        target = directory / file.filename
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(b"x" * file.size_bytes)


def _engine_with(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, entry: VoiceEntry | None = None
) -> tuple[VieneuEngine, VoiceEntry, list[_FakeVieneu]]:
    entry = entry or _model_entry()
    _install(tmp_path, entry)
    made: list[_FakeVieneu] = []

    def factory(**kwargs: Any) -> _FakeVieneu:
        fake = _FakeVieneu(**kwargs)
        made.append(fake)
        return fake

    # `vieneu` chưa chắc cài trong môi trường test → dựng module giả rồi cắm vào
    # `sys.modules`, y hệt cách `test_engine.py` làm với `piper`.
    import sys
    import types

    module = types.ModuleType("vieneu")
    module.Vieneu = factory  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "vieneu", module)

    return VieneuEngine(tmp_path), entry, made


class TestVieneuEngine:
    def test_tổng_hợp_trả_audio_và_timing(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        engine, entry, _ = _engine_with(tmp_path, monkeypatch)
        result = engine.synthesize("Một hai ba", entry)

        assert result.audio.size_bytes > 0
        assert [t.w for t in result.timings] == ["Một", "hai", "ba"]
        assert result.voice_id == entry.id

    def test_timing_source_luôn_là_estimate(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """VieNeu **không thể** cho alignment thật: codec 12,5 token/giây, ranh
        giới token là đơn vị nén chứ không phải ranh giới từ. Đây là sự thật về
        engine, không phải phần chưa làm — xem PROGRESS 4.79."""
        engine, entry, _ = _engine_with(tmp_path, monkeypatch)
        assert engine.synthesize("Một hai", entry).timing_source == "estimate"

    def test_chọn_đúng_giọng_preset(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        engine, entry, made = _engine_with(tmp_path, monkeypatch)
        engine.synthesize("Xin chào", entry)
        assert made[0].calls[0]["voice"] == "Ngọc Linh"

    def test_giọng_dùng_model_chung_nạp_model_của_voice_khác(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Giọng chung không có file riêng — phải nạp qua `model_entry`."""
        engine, provider, made = _engine_with(tmp_path, monkeypatch)
        shared = _shared_entry()

        result = engine.synthesize("Xin chào", shared, model_entry=provider)

        assert made[0].calls[0]["voice"] == "Trúc Ly"
        # `voice_id` báo về là GIỌNG user chọn, không phải bộ model.
        assert result.voice_id == shared.id
        assert engine.loaded_voice_id == provider.id

    def test_đổi_giọng_không_nạp_lại_model(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """14 giọng dùng chung một bộ 244 MB — nạp lại mỗi lần đổi là 3 giây
        cho đúng không việc gì."""
        engine, provider, made = _engine_with(tmp_path, monkeypatch)

        engine.synthesize("Một", provider)
        engine.synthesize("Hai", _shared_entry(), model_entry=provider)

        assert len(made) == 1, "chỉ được nạp model một lần"
        assert [c["voice"] for c in made[0].calls] == ["Ngọc Linh", "Trúc Ly"]

    def test_phong_cách_mặc_định_là_đọc_truyện(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        engine, entry, made = _engine_with(tmp_path, monkeypatch)
        engine.synthesize("Xin chào", entry)
        assert made[0].calls[0]["style"] == DEFAULT_STYLE == "doc_truyen"

    def test_đổi_phong_cách_không_nạp_lại_model(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        engine, entry, made = _engine_with(tmp_path, monkeypatch)
        engine.synthesize("Một", entry)
        engine.set_style("tin_tuc")
        engine.synthesize("Hai", entry)

        assert len(made) == 1
        assert [c["style"] for c in made[0].calls] == ["doc_truyen", "tin_tuc"]

    def test_phong_cách_lạ_bị_từ_chối(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        engine, _, _ = _engine_with(tmp_path, monkeypatch)
        with pytest.raises(EngineError, match="Phong cách"):
            engine.set_style("khong-co-that")

    def test_không_đóng_dấu_chìm_và_không_denoise(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """`denoise=True` cần PyTorch — bật lên là ném ở máy user (bản đóng gói
        không có torch). Watermark thì vô nghĩa với audio user tự nghe."""
        engine, entry, made = _engine_with(tmp_path, monkeypatch)
        engine.synthesize("Xin chào", entry)

        assert made[0].calls[0]["apply_watermark"] is False
        assert made[0].calls[0]["denoise"] is False

    def test_nạp_model_từ_thư_mục_đã_tải_không_gọi_mạng(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Thiếu `onnx_dir` thì SDK tự tải về cache HF: user không thấy tiến độ,
        không huỷ được, Storage manager không đếm, gỡ app không xoá."""
        engine, entry, made = _engine_with(tmp_path, monkeypatch)
        engine.synthesize("Xin chào", entry)

        voice_root = tmp_path / "voices" / entry.id
        assert made[0].kwargs["onnx_dir"] == str(voice_root / "onnx_int8")
        assert made[0].kwargs["moss_tokenizer"] == str(voice_root / "moss")
        assert made[0].kwargs["backend"] == "onnx"

    def test_cấm_sdk_gọi_hugging_face(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Model đã nằm trên đĩa, nhưng `huggingface_hub` vẫn thử kiểm bản mới
        mỗi lần nạp — trên máy không mạng là vài chục giây chờ timeout trước khi
        đọc đúng file ngay cạnh nó. Đây là app đọc offline."""
        monkeypatch.delenv("HF_HUB_OFFLINE", raising=False)
        engine, entry, _ = _engine_with(tmp_path, monkeypatch)

        engine.synthesize("Xin chào", entry)

        assert os.environ["HF_HUB_OFFLINE"] == "1"
        assert os.environ["HF_HUB_DISABLE_TELEMETRY"] == "1"

    def test_chưa_cài_thì_báo_rõ(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        engine, entry, _ = _engine_with(tmp_path, monkeypatch)
        (tmp_path / "voices" / entry.id / "onnx_int8" / "backbone.data").unlink()

        with pytest.raises(EngineError, match="chưa tải xong"):
            engine.synthesize("Xin chào", entry)

    def test_text_rỗng_bị_từ_chối(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        engine, entry, _ = _engine_with(tmp_path, monkeypatch)
        with pytest.raises(EngineError, match="Không có nội dung"):
            engine.synthesize("   ", entry)

    def test_thiếu_cả_presetVoice_lẫn_speakerEmb_bị_từ_chối(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Không có cách nào chỉ định giọng thì SDK đọc bằng giọng mặc định —
        sai giọng mà không báo gì còn tệ hơn ném lỗi."""
        engine, entry, _ = _engine_with(tmp_path, monkeypatch)
        broken = VoiceEntry(**{**entry.__dict__, "preset_voice": ""})

        with pytest.raises(EngineError, match="presetVoice"):
            engine.synthesize("Xin chào", broken)

    def test_giọng_nhân_bản_truyền_embedding_thay_vì_tên(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Giọng clone đưa vector vào SDK dưới dạng dict, không phải chuỗi tên."""
        engine, provider, made = _engine_with(tmp_path, monkeypatch)
        cloned = _cloned_entry()

        result = engine.synthesize("Xin chào", cloned, model_entry=provider)

        voice = made[0].calls[0]["voice"]
        assert isinstance(voice, dict)
        assert voice["speaker_emb"].shape == (192,)
        assert voice["speaker_emb"].dtype == np.float32
        # `codes` KHÔNG được có mặt: giọng clone chỉ có embedding.
        assert "codes" not in voice
        assert result.voice_id == cloned.id

    def test_giọng_nhân_bản_tắt_use_ref_codes(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Để mặc định `use_ref_codes=True` thì SDK đi tìm `codes` trong dict và
        ném `KeyError`. Đây là bẫy đã gặp thật lúc dựng."""
        engine, provider, made = _engine_with(tmp_path, monkeypatch)

        engine.synthesize("Xin chào", _cloned_entry(), model_entry=provider)

        assert made[0].calls[0]["use_ref_codes"] is False

    def test_giọng_preset_vẫn_dùng_ref_codes(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Đối chứng: đừng tắt nhầm cho cả 14 giọng preset — chúng có `codes`
        thật trong model và tắt đi là giọng đổi khác."""
        engine, entry, made = _engine_with(tmp_path, monkeypatch)

        engine.synthesize("Xin chào", entry)

        assert made[0].calls[0]["use_ref_codes"] is True

    def test_giọng_nhân_bản_vẫn_là_estimate(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Clone không đổi gì về alignment — codec MOSS vẫn 12,5 token/giây."""
        engine, provider, _ = _engine_with(tmp_path, monkeypatch)
        result = engine.synthesize("Một hai ba", _cloned_entry(), model_entry=provider)
        assert result.timing_source == "estimate"

    def test_unload_đóng_model(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        engine, entry, made = _engine_with(tmp_path, monkeypatch)
        engine.synthesize("Xin chào", entry)
        assert engine.ready

        engine.unload()

        assert not engine.ready
        assert engine.loaded_voice_id is None
        assert made[0].closed

    def test_unload_khi_chưa_nạp_gì_không_ném(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        engine, _, _ = _engine_with(tmp_path, monkeypatch)
        engine.unload()

    def test_sdk_ném_thì_bọc_thành_engine_error(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        engine, entry, made = _engine_with(tmp_path, monkeypatch)
        engine.synthesize("Một", entry)

        def boom(text: str, **kwargs: Any) -> np.ndarray:
            raise RuntimeError("onnx hỏng")

        made[0].infer = boom  # type: ignore[method-assign]
        with pytest.raises(EngineError, match="VieNeu tổng hợp thất bại"):
            engine.synthesize("Hai", entry)


class TestEngineRegistry:
    def _catalog(self, *voices: VoiceEntry) -> Catalog:
        return Catalog(version=1, base_url="https://example.com/", voices=voices)

    def test_định_tuyến_voice_vieneu_tới_engine_vieneu(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _, provider, made = _engine_with(tmp_path, monkeypatch)
        registry = EngineRegistry(tmp_path)

        result = registry.synthesize("Xin chào", provider, self._catalog(provider))

        assert result.timing_source == "estimate"
        assert made and made[0].calls

    def test_giọng_dùng_model_chung_tự_quy_về_bộ_model(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Registry phải tự `resolve_model_entry` — nơi gọi không cần biết."""
        _, provider, made = _engine_with(tmp_path, monkeypatch)
        shared = _shared_entry()
        registry = EngineRegistry(tmp_path)

        result = registry.synthesize(
            "Xin chào", shared, self._catalog(provider, shared)
        )

        assert result.voice_id == shared.id
        assert made[0].calls[0]["voice"] == "Trúc Ly"

    def test_engine_lạ_ném_rõ_ràng(self, tmp_path: Path) -> None:
        """Rơi ngầm về Piper sẽ đọc bằng giọng sai mà không ai biết."""
        entry = VoiceEntry(**{**_piper_entry().__dict__, "engine": "khong-co-that"})
        registry = EngineRegistry(tmp_path)

        with pytest.raises(EngineError, match="Không có engine"):
            registry.synthesize("Xin chào", entry, self._catalog(entry))

    def test_đổi_phong_cách_đi_tới_engine_vieneu(self, tmp_path: Path) -> None:
        registry = EngineRegistry(tmp_path)
        registry.set_style("tin_tuc")
        assert registry.style == "tin_tuc"

    def test_chưa_nạp_gì_thì_chưa_ready(self, tmp_path: Path) -> None:
        registry = EngineRegistry(tmp_path)
        assert not registry.ready
        assert registry.loaded_voice_id is None

    def test_unload_không_ném_khi_chưa_nạp(self, tmp_path: Path) -> None:
        EngineRegistry(tmp_path).unload()
