"""Khoá hợp đồng đóng gói PyInstaller.

Không build thật ở đây (mất vài phút) — chỉ khoá những **giả định** mà nếu ai
đó sửa vô tình thì bản `.exe` chết ngay lúc khởi động, trong khi mọi test khác
vẫn xanh. Cả ba thứ dưới đây đều đã hỏng thật một lần khi viết P2.3.
"""

from __future__ import annotations

import ast
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
