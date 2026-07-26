"""Điểm vào cho bản đóng gói PyInstaller.

**Vì sao cần file này thay vì trỏ thẳng vào `app/server.py`.**

PyInstaller chạy script đích như **module cấp cao nhất** (`__name__ ==
"__main__"`, không có package cha). Mà `app/server.py` dùng import tương đối
(`from .config import ...`), thứ chỉ hợp lệ khi module nằm trong một package.
Trỏ thẳng vào nó thì `.exe` build xong vẫn chết ngay lúc khởi động:

    ImportError: attempted relative import with no known parent package

Lỗi này **không** lộ ra ở lúc dev vì main chạy sidecar bằng `-m app.server` —
khi đó Python nạp `app` thành package trước, nên import tương đối hoạt động.
Cũng không lộ ra ở pytest vì `pythonpath = .` cho phép `import app.server`.

File này ở ngoài package `app/`, import theo đường tuyệt đối, nên PyInstaller
nạp `app` như một package thật rồi mới gọi vào trong.
"""

from __future__ import annotations

from app.server import main

if __name__ == "__main__":
    raise SystemExit(main())
