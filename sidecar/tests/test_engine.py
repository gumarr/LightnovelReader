"""Test `PiperEngine` — không cần voice 63 MB trên đĩa.

Model thật được thay bằng `_FakeVoice`: engine chỉ dùng đúng hai thứ của nó
(`config.sample_rate` và `synthesize()`), nên bản giả đủ để khoá **logic ghép
nối** — cache, chọn nguồn timing, nối chunk, xử lý lỗi. Chất lượng audio thật
đã kiểm ở `test_resample.py` / `test_encode.py` và bằng chạy thật với model thật
(xem PROGRESS mục 2, P2.4).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pytest

from app.audio import DEFAULT_BITRATE
from app.engines.piper import EngineError, PiperEngine
from app.voices.catalog import VoiceEntry, VoiceFile

RATE = 22050


@dataclass
class _FakeAlignment:
    phoneme: str
    num_samples: int


@dataclass
class _FakeChunk:
    audio_float_array: np.ndarray
    phoneme_alignments: list[_FakeAlignment] | None


class _FakeConfig:
    sample_rate = RATE


class _FakeVoice:
    """Bản giả của `piper.PiperVoice`, đủ cho những gì engine gọi tới."""

    def __init__(self, chunks: list[_FakeChunk]) -> None:
        self.config = _FakeConfig()
        self._chunks = chunks
        self.calls = 0

    def synthesize(self, text: str, include_alignments: bool = False):  # noqa: ANN201
        self.calls += 1
        return iter(self._chunks)


def _audio(seconds: float = 1.0) -> np.ndarray:
    t = np.arange(int(RATE * seconds), dtype=np.float64) / RATE
    return (0.3 * np.sin(2 * np.pi * 200 * t)).astype(np.float32)


def _entry(voice_id: str = "vi_VN-test-medium") -> VoiceEntry:
    return VoiceEntry(
        id=voice_id,
        lang="vi",
        name="Test",
        quality="medium",
        sample_rate=RATE,
        license="MIT",
        files=(
            VoiceFile(kind="model", path=f"{voice_id}.onnx", size_bytes=10, sha256="0" * 64),
            VoiceFile(
                kind="config", path=f"{voice_id}.onnx.json", size_bytes=4, sha256="1" * 64
            ),
        ),
    )


def _install(models_dir: Path, entry: VoiceEntry) -> None:
    """Tạo file đúng KÍCH THƯỚC catalog — `is_installed` chỉ kiểm kích thước."""
    directory = models_dir / "voices" / entry.id
    directory.mkdir(parents=True, exist_ok=True)
    for file in entry.files:
        (directory / file.filename).write_bytes(b"x" * file.size_bytes)


def _engine_with(
    tmp_path: Path, chunks: list[_FakeChunk], entry: VoiceEntry | None = None
) -> tuple[PiperEngine, VoiceEntry, _FakeVoice]:
    entry = entry or _entry()
    _install(tmp_path, entry)
    engine = PiperEngine(tmp_path)
    voice = _FakeVoice(chunks)

    # Nạp thẳng bản giả vào, bỏ qua `PiperVoice.load` (cần file .onnx thật).
    engine._voice = voice  # noqa: SLF001
    engine._voice_id = entry.id  # noqa: SLF001
    engine._sample_rate = RATE  # noqa: SLF001
    return engine, entry, voice


class TestEngineReady:
    def test_chua_nap_thi_chua_san_sang(self, tmp_path: Path) -> None:
        """`engine_ready = False` lúc mới khởi động là BÌNH THƯỜNG (nạp lười)."""
        engine = PiperEngine(tmp_path)
        assert engine.ready is False
        assert engine.loaded_voice_id is None

    def test_nap_roi_thi_bao_dung_voice(self, tmp_path: Path) -> None:
        engine, entry, _ = _engine_with(tmp_path, [_FakeChunk(_audio(), None)])
        assert engine.ready is True
        assert engine.loaded_voice_id == entry.id

    def test_unload_nha_model(self, tmp_path: Path) -> None:
        engine, _, _ = _engine_with(tmp_path, [_FakeChunk(_audio(), None)])
        engine.unload()
        assert engine.ready is False


class TestSynthesize:
    def test_tra_ve_audio_va_timing(self, tmp_path: Path) -> None:
        engine, entry, _ = _engine_with(tmp_path, [_FakeChunk(_audio(), None)])

        result = engine.synthesize("một hai ba", entry, DEFAULT_BITRATE)

        assert result.audio.size_bytes > 0
        assert result.audio.sample_rate == 24000  # đã resample cho Opus
        assert result.audio.duration_ms == pytest.approx(1000, abs=20)
        assert [t.w for t in result.timings] == ["một", "hai", "ba"]

    def test_khong_co_alignment_thi_uoc_luong(self, tmp_path: Path) -> None:
        engine, entry, _ = _engine_with(tmp_path, [_FakeChunk(_audio(), None)])

        result = engine.synthesize("một hai ba", entry, DEFAULT_BITRATE)

        assert result.timing_source == "estimate"

    def test_co_alignment_thi_dung_phoneme(self, tmp_path: Path) -> None:
        # 2 từ, mỗi từ 1 phoneme, ngăn bằng khoảng trắng.
        alignments = [
            _FakeAlignment("a", RATE // 2),
            _FakeAlignment(" ", 0),
            _FakeAlignment("b", RATE // 2),
        ]
        engine, entry, _ = _engine_with(tmp_path, [_FakeChunk(_audio(), alignments)])

        result = engine.synthesize("một hai", entry, DEFAULT_BITRATE)

        assert result.timing_source == "phoneme"
        assert result.timings[0].end_ms == pytest.approx(500, abs=5)

    def test_noi_nhieu_chunk_thanh_mot_segment(self, tmp_path: Path) -> None:
        """Piper trả MỖI CÂU MỘT CHUNK — segment 1–3 câu phải nối lại liền mạch."""
        chunks = [_FakeChunk(_audio(0.5), None), _FakeChunk(_audio(0.5), None)]
        engine, entry, _ = _engine_with(tmp_path, chunks)

        result = engine.synthesize("một hai", entry, DEFAULT_BITRATE)

        assert result.audio.duration_ms == pytest.approx(1000, abs=20)

    def test_thieu_alignment_o_MOT_chunk_thi_uoc_luong_ca_segment(
        self, tmp_path: Path
    ) -> None:
        """Ghép nửa vời sẽ làm mọi từ phía sau lệch hẳn một câu."""
        chunks = [
            _FakeChunk(_audio(0.5), [_FakeAlignment("a", RATE // 2)]),
            _FakeChunk(_audio(0.5), None),
        ]
        engine, entry, _ = _engine_with(tmp_path, chunks)

        assert engine.synthesize("một hai", entry, DEFAULT_BITRATE).timing_source == "estimate"

    def test_bitrate_cao_cho_file_lon_hon(self, tmp_path: Path) -> None:
        engine, entry, _ = _engine_with(tmp_path, [_FakeChunk(_audio(2.0), None)])

        nho = engine.synthesize("một hai", entry, 16).audio.size_bytes
        lon = engine.synthesize("một hai", entry, 32).audio.size_bytes
        assert nho < lon

    def test_dung_lai_model_da_nap(self, tmp_path: Path) -> None:
        """Nạp lại mỗi segment thì riêng phần nạp đã lâu hơn phần tổng hợp."""
        engine, entry, voice = _engine_with(tmp_path, [_FakeChunk(_audio(), None)])

        engine.synthesize("một", entry, DEFAULT_BITRATE)
        engine.synthesize("hai", entry, DEFAULT_BITRATE)

        assert voice.calls == 2
        assert engine.loaded_voice_id == entry.id


class TestSynthesizeLoi:
    def test_text_rong(self, tmp_path: Path) -> None:
        engine, entry, _ = _engine_with(tmp_path, [_FakeChunk(_audio(), None)])
        with pytest.raises(EngineError, match="Không có nội dung"):
            engine.synthesize("   ", entry, DEFAULT_BITRATE)

    def test_voice_chua_cai(self, tmp_path: Path) -> None:
        """Nói rõ cách sửa: vào màn Giọng đọc tải lại."""
        engine = PiperEngine(tmp_path)
        with pytest.raises(EngineError, match="chưa được cài"):
            engine.synthesize("một hai", _entry(), DEFAULT_BITRATE)

    def test_file_thieu_mot_nua_van_bi_bat(self, tmp_path: Path) -> None:
        """Lần tải trước đứt giữa chừng để lại `.onnx` dở dang.

        `is_installed` kiểm kích thước nên bắt được ca này mà không phải băm lại
        63 MB mỗi lần mở màn hình.
        """
        entry = _entry()
        directory = tmp_path / "voices" / entry.id
        directory.mkdir(parents=True)
        # Chỉ ghi model, thiếu config.
        (directory / f"{entry.id}.onnx").write_bytes(b"x" * 10)

        engine = PiperEngine(tmp_path)
        with pytest.raises(EngineError, match="chưa được cài"):
            engine.synthesize("một hai", entry, DEFAULT_BITRATE)

    def test_piper_khong_sinh_audio(self, tmp_path: Path) -> None:
        engine, entry, _ = _engine_with(tmp_path, [])
        with pytest.raises(EngineError, match="không sinh ra audio"):
            engine.synthesize("một hai", entry, DEFAULT_BITRATE)

    def test_piper_nem_thi_boc_lai_thanh_EngineError(self, tmp_path: Path) -> None:
        engine, entry, voice = _engine_with(tmp_path, [_FakeChunk(_audio(), None)])

        def no(text: str, include_alignments: bool = False):  # noqa: ANN202
            raise RuntimeError("onnx hỏng")

        voice.synthesize = no  # type: ignore[method-assign]

        with pytest.raises(EngineError, match="Piper tổng hợp thất bại"):
            engine.synthesize("một hai", entry, DEFAULT_BITRATE)


class TestOnnxCoSan:
    def test_package_onnx_import_duoc(self) -> None:
        """Thiếu `onnx` thì piper CHỈ ghi log rồi trả `phoneme_alignments = None`.

        Không ném gì cả — nghĩa là bản `.exe` thiếu onnx vẫn chạy bình thường
        nhưng timing âm thầm rơi hết về ước lượng theo ký tự. Test này khoá lại
        để lỗi đó không lọt qua bước đóng gói.
        """
        import onnx  # noqa: F401, PLC0415
