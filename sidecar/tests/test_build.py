"""Khoá hợp đồng đóng gói PyInstaller.

Không build thật ở đây (mất vài phút) — chỉ khoá những **giả định** mà nếu ai
đó sửa vô tình thì bản `.exe` chết ngay lúc khởi động, trong khi mọi test khác
vẫn xanh. Cả ba thứ dưới đây đều đã hỏng thật một lần khi viết P2.3.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

SIDECAR_DIR = Path(__file__).resolve().parents[1]


def build_source() -> str:
    return (SIDECAR_DIR / "build.py").read_text(encoding="utf-8")


class TestĐiểmVào:
    def test_có_file_entry_ngoài_package(self) -> None:
        """PyInstaller chạy script đích như module cấp cao nhất, không có
        package cha. Trỏ thẳng `app/server.py` (dùng import tương đối) thì
        `.exe` chết với `ImportError: attempted relative import`."""
        assert (SIDECAR_DIR / "entry.py").is_file()

    def test_entry_dùng_import_TUYỆT_ĐỐI(self) -> None:
        tree = ast.parse((SIDECAR_DIR / "entry.py").read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom):
                # `level > 0` nghĩa là import tương đối (`from .x import y`)
                assert node.level == 0, "entry.py không được dùng import tương đối"

    def test_build_trỏ_vào_entry_KHÔNG_phải_server(self) -> None:
        source = build_source()
        assert '"entry.py"' in source
        assert '"app" / "server.py"' not in source


class TestTênFileThựcThi:
    def test_khớp_tên_bên_typescript(self) -> None:
        """Phải khớp `SIDECAR_EXE_NAME` ở `sidecar-paths.ts`. Lệch tên thì bản
        đóng gói không tìm thấy sidecar, mà unit test TS vẫn xanh vì nó chỉ
        khoá thứ tự tìm kiếm chứ không biết PyInstaller sinh ra gì."""
        assert 'EXE_NAME = "ln-sidecar"' in build_source()

        ts_path = SIDECAR_DIR.parent / "apps" / "main" / "src" / "services" / "sidecar-paths.ts"
        ts_source = ts_path.read_text(encoding="utf-8")
        assert "'ln-sidecar.exe'" in ts_source


class TestThưMụcĐích:
    def test_electron_builder_chép_đúng_chỗ(self) -> None:
        """`extraResources` phải đưa sidecar vào `resources/sidecar/` — đúng
        chỗ `resolveSidecarCommand()` tìm."""
        config = (SIDECAR_DIR.parent / "electron-builder.yml").read_text(encoding="utf-8")
        assert "sidecar/dist/ln-sidecar" in config
        assert "to: sidecar" in config

    def test_electron_builder_chép_cả_catalog(self) -> None:
        """Thiếu catalog thì màn voice manager trống trơn ở bản đóng gói."""
        config = (SIDECAR_DIR.parent / "electron-builder.yml").read_text(encoding="utf-8")
        assert "resources/voices" in config
        assert "to: voices" in config


class TestPhụThuộc:
    def test_httpx_là_dependency_runtime(self) -> None:
        """Tải voice là chức năng runtime — httpx nằm ở `requirements.txt` thì
        PyInstaller mới gói vào `.exe`. Để ở `requirements-dev.txt` thì bản
        đóng gói thiếu, và lỗi chỉ lộ ra lúc user bấm nút tải."""
        requirements = (SIDECAR_DIR / "requirements.txt").read_text(encoding="utf-8")
        assert "httpx" in requirements

    def test_hidden_imports_có_uvicorn_loops(self) -> None:
        """uvicorn nạp động — PyInstaller dò import tĩnh nên không thấy."""
        source = build_source()
        assert "uvicorn.loops.auto" in source
        assert "uvicorn.protocols.http.auto" in source

    def test_engine_là_dependency_runtime(self) -> None:
        """piper/soundfile/onnx phải ở `requirements.txt`, không phải dev.

        Để nhầm sang `requirements-dev.txt` thì `.exe` build vẫn thành công
        (PyInstaller chỉ gói cái nó import được) rồi chết đúng lúc user bấm
        generate — cùng vết xe đổ với httpx ở P2.3.
        """
        requirements = (SIDECAR_DIR / "requirements.txt").read_text(encoding="utf-8")
        for package in ("piper-tts", "soundfile", "onnx"):
            assert package in requirements

    def test_pyinstaller_đủ_mới_cho_numpy_2(self) -> None:
        """PyInstaller < 6.21 có hook numpy viết trước numpy 2.5.

        Hook cũ chỉ mang theo các file `.pyd` mà bỏ hết submodule Python thuần
        (`numpy._core._exceptions`…). `.exe` build THÀNH CÔNG, kích thước hợp
        lý, rồi chết ngay lúc khởi động với "Importing the numpy C-extensions
        failed". Đã gặp thật khi build P2.4.
        """
        dev = (SIDECAR_DIR / "requirements-dev.txt").read_text(encoding="utf-8")
        match = re.search(r"pyinstaller==(\d+)\.(\d+)", dev)
        assert match is not None, "requirements-dev.txt phải ghim phiên bản pyinstaller"

        major, minor = int(match.group(1)), int(match.group(2))
        assert (major, minor) >= (6, 21), f"pyinstaller {major}.{minor} quá cũ cho numpy 2.x"

    def test_KHÔNG_khai_numpy_làm_hidden_import(self) -> None:
        """Khai tường minh sẽ ĐÈ hook numpy của PyInstaller.

        Kết quả y hệt lỗi trên: chỉ `numpy` được gói, các C-extension con thì
        không. Để hook tự lo mới đúng.
        """
        source = build_source()
        assert '"numpy"' not in source

    def test_thu_viện_native_được_gom_binaries(self) -> None:
        """onnxruntime và soundfile nạp DLL native, PyInstaller không tự thấy."""
        source = build_source()
        assert "COLLECT_BINARIES" in source
        assert "onnxruntime" in source
        assert "soundfile" in source

    def test_dữ_liệu_espeak_được_gom(self) -> None:
        """`espeak-ng-data` (gồm `vi_dict`) nằm trong wheel piper, không phải mã
        Python nên PyInstaller không tự mang theo. Thiếu nó thì model nạp được
        nhưng không phiên âm nổi chữ nào."""
        source = build_source()
        assert "COLLECT_DATA" in source
        assert '"piper"' in source


class TestĐóngGóiVieNeu:
    """P6.2 — engine thứ hai. Mọi lỗi ở đây chỉ lộ ra ở bản `.exe`."""

    def test_vieneu_là_dependency_runtime(self) -> None:
        requirements = (SIDECAR_DIR / "requirements.txt").read_text(encoding="utf-8")
        for package in ("vieneu", "sea-g2p", "soxr", "tokenizers", "huggingface_hub"):
            assert package in requirements

    def test_không_kéo_gradio_hay_torch(self) -> None:
        """`pip install vieneu` trần kéo về 41 package gồm gradio 29 MB, pandas,
        pillow — và **nâng fastapi 0.115.6 lên 0.141.1**, tức đổi web framework
        của chính sidecar này. Phải cài `--no-deps` và khai tay.
        """
        requirements = (SIDECAR_DIR / "requirements.txt").read_text(encoding="utf-8")
        for package in ("gradio", "torch", "pandas", "pillow", "peft", "transformers"):
            assert f"\n{package}==" not in requirements, f"{package} không được vào installer"

    def test_fastapi_không_bị_nâng_phiên_bản(self) -> None:
        """Ghim đúng bản sidecar đang dùng — `vieneu` yêu cầu fastapi mới hơn,
        cài không `--no-deps` sẽ âm thầm nâng lên."""
        requirements = (SIDECAR_DIR / "requirements.txt").read_text(encoding="utf-8")
        assert "fastapi==0.115.6" in requirements

    def test_v3turbo_được_khai_hidden_import(self) -> None:
        """`vieneu/__init__.py` chỉ export một factory dùng `match` + import
        trong hàm, nên PyInstaller không dò ra bằng phân tích tĩnh."""
        source = build_source()
        assert "vieneu.v3turbo" in source
        assert "vieneu._v3_turbo_engine.onnx_runtime_lite" in source

    def test_assets_giọng_preset_được_gom(self) -> None:
        """`vieneu/assets/voices_v3_turbo.json` chứa speaker embedding của **14
        giọng preset**. Nó nằm trong wheel, KHÔNG nằm trong model 244 MB tải về
        — thiếu thì model nạp được nhưng không có giọng nào để chọn.
        """
        source = build_source()
        assert "COLLECT_DATA" in source
        assert '"vieneu"' in source
        assert '"sea_g2p"' in source

    def test_thư_viện_native_của_vieneu_được_gom_binaries(self) -> None:
        """`sea_g2p`/`tokenizers`/`soxr` đều là wheel native (abi3)."""
        source = build_source()
        binaries = source.split("COLLECT_BINARIES", 1)[1].split("]", 1)[0]
        for package in ("sea_g2p", "tokenizers", "soxr"):
            assert package in binaries
