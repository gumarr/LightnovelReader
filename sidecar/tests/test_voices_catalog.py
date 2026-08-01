"""Test đọc catalog voice và soi thư mục model.

Hàm ở `voices/catalog.py` thuần nên test dựng cây thư mục tạm là đủ, không cần
mạng hay bản đóng gói.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.voices.catalog import (
    CatalogError,
    installed_size,
    is_installed,
    is_safe_voice_id,
    load_catalog,
    parse_catalog,
    resolve_model_entry,
    voice_base_url,
    voice_dir,
)


def raw_voice(voice_id: str = "vi_VN-test-medium") -> dict[str, object]:
    return {
        "id": voice_id,
        "lang": "vi",
        "name": "Test",
        "quality": "medium",
        "sampleRate": 22050,
        "license": "MIT",
        "files": [
            {
                "kind": "model",
                "path": "vi/vi_VN/test/medium/model.onnx",
                "sizeBytes": 100,
                "sha256": "a" * 64,
            },
            {
                "kind": "config",
                "path": "vi/vi_VN/test/medium/model.onnx.json",
                "sizeBytes": 20,
                "sha256": "b" * 64,
            },
        ],
    }


def raw_catalog(*voices: dict[str, object]) -> dict[str, object]:
    return {
        "version": 1,
        "baseUrl": "https://huggingface.co/rhasspy/piper-voices/resolve/main/",
        "voices": list(voices) or [raw_voice()],
    }


def raw_model_voice(voice_id: str = "vi_VN-vieneu-v3turbo") -> dict[str, object]:
    """Voice engine khác, mang file model dùng chung."""
    return {
        "id": voice_id,
        "engine": "vieneu",
        "lang": "vi",
        "name": "VieNeu",
        "quality": "high",
        "sampleRate": 48000,
        "license": "Apache-2.0",
        "baseUrl": "https://huggingface.co/",
        "presetVoice": "Ngọc Linh",
        "files": [
            {
                "kind": "asset",
                "path": "repo/resolve/main/onnx_int8/backbone.data",
                "saveAs": "onnx_int8/backbone.data",
                "sizeBytes": 500,
                "sha256": "c" * 64,
            },
            {
                "kind": "asset",
                "path": "repo/resolve/main/moss/encode.onnx",
                "saveAs": "moss/encode.onnx",
                "sizeBytes": 300,
                "sha256": "d" * 64,
            },
        ],
    }


def raw_shared_voice(
    voice_id: str = "vi_VN-vieneu-truc-ly", model_id: str = "vi_VN-vieneu-v3turbo"
) -> dict[str, object]:
    """Giọng chỉ trỏ về bộ model của voice khác, không mang file."""
    return {
        "id": voice_id,
        "engine": "vieneu",
        "lang": "vi",
        "name": "VieNeu — Trúc Ly",
        "quality": "high",
        "sampleRate": 48000,
        "license": "Apache-2.0",
        "modelId": model_id,
        "presetVoice": "Trúc Ly",
    }


class TestParseCatalog:
    def test_đọc_được_catalog_hợp_lệ(self) -> None:
        catalog = parse_catalog(raw_catalog())
        assert catalog.version == 1
        assert len(catalog.voices) == 1
        assert catalog.voices[0].id == "vi_VN-test-medium"

    def test_tổng_dung_lượng_cộng_mọi_file(self) -> None:
        assert parse_catalog(raw_catalog()).voices[0].total_bytes == 120

    def test_tên_file_bỏ_cây_thư_mục_của_hf(self) -> None:
        """Đường dẫn HF nhiều tầng, nhưng trên đĩa chỉ lưu tên file."""
        assert parse_catalog(raw_catalog()).voices[0].files[0].filename == "model.onnx"

    def test_find_theo_id(self) -> None:
        catalog = parse_catalog(raw_catalog())
        assert catalog.find("vi_VN-test-medium") is not None
        assert catalog.find("không-có") is None

    def test_thiếu_file_config_bị_từ_chối(self) -> None:
        """Piper cần cả model lẫn config. Thiếu thì tải xong vẫn không dùng được
        — bắt ngay ở catalog thay vì để user chờ hết 63 MB rồi mới biết."""
        voice = raw_voice()
        voice["files"] = [voice["files"][0]]  # type: ignore[index]
        with pytest.raises(CatalogError, match="config"):
            parse_catalog(raw_catalog(voice))

    def test_id_trùng_nhau_bị_từ_chối(self) -> None:
        with pytest.raises(CatalogError, match="trùng"):
            parse_catalog(raw_catalog(raw_voice(), raw_voice()))

    def test_base_url_http_bị_từ_chối(self) -> None:
        """Model tải về sẽ được nạp và chạy — tải qua HTTP thì ai cũng thay được."""
        data = raw_catalog()
        data["baseUrl"] = "http://huggingface.co/"
        with pytest.raises(CatalogError, match="https"):
            parse_catalog(data)

    def test_sha256_sai_độ_dài_bị_từ_chối(self) -> None:
        voice = raw_voice()
        voice["files"][0]["sha256"] = "abc"  # type: ignore[index]
        with pytest.raises(CatalogError, match="sha256"):
            parse_catalog(raw_catalog(voice))

    def test_sha256_không_phải_hex_bị_từ_chối(self) -> None:
        voice = raw_voice()
        voice["files"][0]["sha256"] = "z" * 64  # type: ignore[index]
        with pytest.raises(CatalogError, match="sha256"):
            parse_catalog(raw_catalog(voice))

    @pytest.mark.parametrize(
        "path",
        [
            "../../../etc/passwd",
            "vi/../../escape.onnx",
            "/absolute/path.onnx",
            "C:/windows/system32/evil.onnx",
        ],
    )
    def test_path_thoát_thư_mục_bị_từ_chối(self, path: str) -> None:
        """`path` vừa ghép vào URL vừa quyết định tên file ghi xuống đĩa."""
        voice = raw_voice()
        voice["files"][0]["path"] = path  # type: ignore[index]
        with pytest.raises(CatalogError, match="tương đối"):
            parse_catalog(raw_catalog(voice))

    def test_id_có_dấu_gạch_chéo_bị_từ_chối(self) -> None:
        with pytest.raises(CatalogError, match="id"):
            parse_catalog(raw_catalog(raw_voice("../evil")))

    def test_sizebytes_là_bool_bị_từ_chối(self) -> None:
        """`bool` là con của `int` trong Python — `true` sẽ lọt thành 1."""
        voice = raw_voice()
        voice["files"][0]["sizeBytes"] = True  # type: ignore[index]
        with pytest.raises(CatalogError, match="sizeBytes"):
            parse_catalog(raw_catalog(voice))

    def test_không_phải_object_bị_từ_chối(self) -> None:
        with pytest.raises(CatalogError):
            parse_catalog([1, 2, 3])


class TestIdAnToàn:
    @pytest.mark.parametrize("value", ["vi_VN-vais1000-medium", "abc", "A-1_b"])
    def test_id_hợp_lệ(self, value: str) -> None:
        assert is_safe_voice_id(value)

    @pytest.mark.parametrize("value", ["", "..", "a/b", "a\\b", "a b", "a" * 65, "voice:1"])
    def test_id_không_hợp_lệ(self, value: str) -> None:
        assert not is_safe_voice_id(value)

    def test_voice_dir_từ_chối_id_xấu(self, tmp_path: Path) -> None:
        with pytest.raises(CatalogError):
            voice_dir(tmp_path, "../escape")

    def test_voice_dir_khớp_quy_ước_paths_ts(self, tmp_path: Path) -> None:
        """Phải khớp `voiceDir()` bên `services/paths.ts`, nếu không main và
        sidecar nhìn vào hai chỗ khác nhau."""
        assert voice_dir(tmp_path, "abc") == tmp_path / "voices" / "abc"


class TestLoadCatalog:
    def test_thiếu_file_trả_catalog_rỗng(self, tmp_path: Path) -> None:
        """App vẫn phải mở được khi chưa có catalog — đọc sách không cần voice."""
        catalog = load_catalog(tmp_path / "không-tồn-tại.json")
        assert catalog.voices == ()
        assert catalog.version == 0

    def test_json_hỏng_thì_ném(self, tmp_path: Path) -> None:
        path = tmp_path / "catalog.json"
        path.write_text("{ không phải json", encoding="utf-8")
        with pytest.raises(CatalogError):
            load_catalog(path)

    def test_đọc_được_file_thật(self, tmp_path: Path) -> None:
        path = tmp_path / "catalog.json"
        path.write_text(json.dumps(raw_catalog()), encoding="utf-8")
        assert len(load_catalog(path).voices) == 1

    def test_catalog_thật_trong_repo_hợp_lệ(self) -> None:
        """Khoá luôn file thật sẽ được đóng gói — sai định dạng thì lỗi chỉ lộ
        ra ở bản build, đúng loại bẫy mục 4.19 của PROGRESS đã cảnh báo."""
        repo_root = Path(__file__).resolve().parents[2]
        catalog = load_catalog(repo_root / "resources" / "voices" / "catalog.json")
        assert len(catalog.voices) >= 2
        assert {v.lang for v in catalog.voices} == {"vi", "en"}

        for voice in catalog.voices:
            if voice.is_shared_model:
                # Giọng dùng model chung không mang file — nó chỉ là một cái tên
                # giọng trong bộ model của voice khác.
                assert voice.files == ()
                assert voice.preset_voice
                continue
            if voice.engine == "piper":
                assert {f.kind for f in voice.files} == {"model", "config"}
            else:
                assert voice.files, f"{voice.id} phải có file model"

    def test_mọi_modelId_trong_catalog_thật_đều_trỏ_đúng(self) -> None:
        """14 giọng VieNeu quy về một bộ model — sai một `modelId` là giọng đó
        không bao giờ nạp được, mà lỗi chỉ hiện ra lúc user bấm đọc."""
        repo_root = Path(__file__).resolve().parents[2]
        catalog = load_catalog(repo_root / "resources" / "voices" / "catalog.json")

        shared = [v for v in catalog.voices if v.is_shared_model]
        assert shared, "catalog thật phải có giọng dùng model chung"
        for voice in shared:
            provider = resolve_model_entry(catalog, voice)
            assert provider.id == voice.model_id
            assert provider.engine == voice.engine
            assert provider.files


class TestĐãCài:
    def install(self, models_dir: Path, voice_id: str, model_size: int, config_size: int) -> None:
        directory = voice_dir(models_dir, voice_id)
        directory.mkdir(parents=True, exist_ok=True)
        (directory / "model.onnx").write_bytes(b"x" * model_size)
        (directory / "model.onnx.json").write_bytes(b"y" * config_size)

    def test_chưa_có_thư_mục_thì_chưa_cài(self, tmp_path: Path) -> None:
        entry = parse_catalog(raw_catalog()).voices[0]
        assert not is_installed(tmp_path, entry)

    def test_đủ_file_đúng_kích_thước_thì_đã_cài(self, tmp_path: Path) -> None:
        entry = parse_catalog(raw_catalog()).voices[0]
        self.install(tmp_path, entry.id, 100, 20)
        assert is_installed(tmp_path, entry)

    def test_thiếu_file_config_thì_chưa_cài(self, tmp_path: Path) -> None:
        entry = parse_catalog(raw_catalog()).voices[0]
        directory = voice_dir(tmp_path, entry.id)
        directory.mkdir(parents=True)
        (directory / "model.onnx").write_bytes(b"x" * 100)
        assert not is_installed(tmp_path, entry)

    def test_file_dở_dang_KHÔNG_tính_là_đã_cài(self, tmp_path: Path) -> None:
        """Lần tải trước đứt giữa chừng để lại `.onnx` thiếu byte. Chỉ kiểm
        'thư mục có tồn tại không' thì engine sẽ nạp file hỏng ở tận P2.4 —
        xa chỗ gây lỗi tới mức không lần ra."""
        entry = parse_catalog(raw_catalog()).voices[0]
        self.install(tmp_path, entry.id, 37, 20)
        assert not is_installed(tmp_path, entry)

    def test_dung_lượng_cộng_theo_file_có_thật(self, tmp_path: Path) -> None:
        entry = parse_catalog(raw_catalog()).voices[0]
        self.install(tmp_path, entry.id, 100, 20)
        assert installed_size(tmp_path, entry) == 120

    def test_dung_lượng_khi_chưa_cài_là_0(self, tmp_path: Path) -> None:
        entry = parse_catalog(raw_catalog()).voices[0]
        assert installed_size(tmp_path, entry) == 0


class TestĐaEngine:
    """Catalog nhiều engine (P6.2). Trọng tâm: giọng dùng chung một bộ model."""

    def test_không_khai_engine_thì_mặc_định_piper(self) -> None:
        """Catalog cũ của user không có trường `engine` — vẫn phải đọc được."""
        catalog = parse_catalog(raw_catalog())
        assert catalog.voices[0].engine == "piper"

    def test_engine_lạ_bị_từ_chối(self) -> None:
        voice = raw_voice()
        voice["engine"] = "khong-co-that"
        with pytest.raises(CatalogError, match="engine"):
            parse_catalog(raw_catalog(voice))

    def test_voice_vieneu_không_cần_đủ_model_và_config(self) -> None:
        """`REQUIRED_KINDS` của Piper không được áp cho engine khác."""
        catalog = parse_catalog(raw_catalog(raw_model_voice()))
        assert {f.kind for f in catalog.voices[0].files} == {"asset"}

    def test_saveAs_giữ_cây_thư_mục(self) -> None:
        """VieNeu tự tìm file theo tên trong thư mục — trải phẳng là đè nhau."""
        entry = parse_catalog(raw_catalog(raw_model_voice())).voices[0]
        assert entry.files[0].filename == "onnx_int8/backbone.data"
        assert entry.files[1].filename == "moss/encode.onnx"

    def test_không_có_saveAs_thì_lấy_tên_cuối_như_cũ(self) -> None:
        entry = parse_catalog(raw_catalog()).voices[0]
        assert entry.files[0].filename == "model.onnx"

    def test_saveAs_thoát_thư_mục_bị_chặn(self) -> None:
        voice = raw_model_voice()
        files = voice["files"]
        assert isinstance(files, list)
        first = files[0]
        assert isinstance(first, dict)
        first["saveAs"] = "../../thoat.bin"
        with pytest.raises(CatalogError, match="saveAs"):
            parse_catalog(raw_catalog(voice))

    def test_giọng_dùng_model_chung_quy_về_voice_mang_model(self) -> None:
        catalog = parse_catalog(raw_catalog(raw_model_voice(), raw_shared_voice()))
        shared = catalog.find("vi_VN-vieneu-truc-ly")
        assert shared is not None
        assert shared.files == ()
        assert resolve_model_entry(catalog, shared).id == "vi_VN-vieneu-v3turbo"

    def test_voice_thường_quy_về_chính_nó(self) -> None:
        catalog = parse_catalog(raw_catalog())
        entry = catalog.voices[0]
        assert resolve_model_entry(catalog, entry) is entry

    def test_modelId_trỏ_vào_hư_không_bị_chặn(self) -> None:
        with pytest.raises(CatalogError, match="modelId"):
            parse_catalog(raw_catalog(raw_shared_voice(model_id="khong-ton-tai")))

    def test_modelId_trỏ_vào_voice_cũng_dùng_model_chung_bị_chặn(self) -> None:
        """Dây chuyền `A → B → C` sẽ làm `resolve` trả về voice không có file."""
        first = raw_shared_voice("vi_VN-vieneu-a", model_id="vi_VN-vieneu-b")
        second = raw_shared_voice("vi_VN-vieneu-b", model_id="vi_VN-vieneu-v3turbo")
        with pytest.raises(CatalogError, match="model chung"):
            parse_catalog(raw_catalog(raw_model_voice(), second, first))

    def test_modelId_trỏ_sang_engine_khác_bị_chặn(self) -> None:
        shared = raw_shared_voice(model_id="vi_VN-test-medium")
        with pytest.raises(CatalogError, match="engine"):
            parse_catalog(raw_catalog(raw_voice(), shared))

    def test_khai_cả_modelId_lẫn_files_bị_chặn(self) -> None:
        voice = raw_model_voice("vi_VN-vieneu-lac")
        voice["modelId"] = "vi_VN-vieneu-v3turbo"
        with pytest.raises(CatalogError, match="files"):
            parse_catalog(raw_catalog(raw_model_voice(), voice))

    def test_baseUrl_riêng_đè_baseUrl_chung(self) -> None:
        catalog = parse_catalog(raw_catalog(raw_voice(), raw_model_voice()))
        piper = catalog.voices[0]
        vieneu = catalog.voices[1]
        assert voice_base_url(catalog, piper) == catalog.base_url
        assert voice_base_url(catalog, vieneu) == "https://huggingface.co/"

    def test_baseUrl_riêng_phải_là_https(self) -> None:
        voice = raw_model_voice()
        voice["baseUrl"] = "http://huggingface.co/"
        with pytest.raises(CatalogError, match="https"):
            parse_catalog(raw_catalog(voice))

    def test_is_installed_ném_khi_gọi_với_giọng_dùng_model_chung(
        self, tmp_path: Path
    ) -> None:
        """Giọng chung không có file — trả `True` ở đây là báo 'đã cài' cho thứ
        chưa tải gì, rồi engine mới ném ở tận lúc user bấm đọc."""
        catalog = parse_catalog(raw_catalog(raw_model_voice(), raw_shared_voice()))
        shared = catalog.find("vi_VN-vieneu-truc-ly")
        assert shared is not None
        with pytest.raises(CatalogError, match="resolve_model_entry"):
            is_installed(tmp_path, shared)

    def test_dung_lượng_giọng_chung_là_0(self, tmp_path: Path) -> None:
        """14 giọng cùng một bộ 244 MB — cộng cho từng giọng là báo gấp 14 lần."""
        catalog = parse_catalog(raw_catalog(raw_model_voice(), raw_shared_voice()))
        shared = catalog.find("vi_VN-vieneu-truc-ly")
        assert shared is not None
        assert installed_size(tmp_path, shared) == 0

    def test_cài_bộ_model_thì_mọi_giọng_dùng_được(self, tmp_path: Path) -> None:
        catalog = parse_catalog(raw_catalog(raw_model_voice(), raw_shared_voice()))
        provider = catalog.find("vi_VN-vieneu-v3turbo")
        shared = catalog.find("vi_VN-vieneu-truc-ly")
        assert provider is not None and shared is not None

        directory = voice_dir(tmp_path, provider.id)
        for file in provider.files:
            target = directory / file.filename
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(b"z" * file.size_bytes)

        # Tải MỘT bộ model là cả hai giọng cùng dùng được.
        assert is_installed(tmp_path, provider)
        assert is_installed(tmp_path, resolve_model_entry(catalog, shared))
