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
            assert {f.kind for f in voice.files} == {"model", "config"}


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
