"""Khởi động uvicorn và bắt tay với Electron main.

**Bắt tay qua stdout.** Sidecar bind cổng 0 (OS cấp cổng trống), nên main
không biết trước cổng nào. Sau khi socket đã lắng nghe, sidecar in đúng một
dòng JSON có tiền tố `LN_SIDECAR_READY ` ra stdout; supervisor bên main đọc
dòng đó rồi mới bắt đầu gọi API.

Vì sao stdout chứ không phải file hay cổng cố định:
- File tạm thì phải dọn, và hai bản app chạy song song sẽ ghi đè lên nhau.
- Cổng cố định thì đụng nhau, và tiến trình khác đoán được.
- stdout là ống có sẵn giữa cha-con, đóng lại khi tiến trình chết — không
  bao giờ để lại rác.

Dòng bắt tay **không chứa token**: main đã tự sinh token và truyền vào qua
env, nên nó biết rồi. In ra chỉ tổ lọt vào log file.
"""

from __future__ import annotations

import json
import os
import socket
import sys

import uvicorn

from .config import ConfigError, SidecarConfig, load_config
from .main import create_app

READY_PREFIX = "LN_SIDECAR_READY "


def bind_socket(host: str, port: int) -> socket.socket:
    """Bind sẵn socket để biết cổng thật TRƯỚC khi uvicorn chạy.

    Nếu để uvicorn tự bind thì cổng chỉ biết được qua log của nó — phải đọc
    ngược log, đúng thứ hay vỡ khi nâng phiên bản. Bind tay rồi đưa socket
    cho uvicorn thì cổng nằm ngay trong tay mình.
    """
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    # Cố ý KHÔNG đặt SO_REUSEADDR: trên Windows nó cho phép hai tiến trình
    # cùng bind một cổng, khiến hai bản sidecar chạy song song mà không ai
    # báo lỗi — request sẽ đi lung tung giữa hai bên.
    sock.bind((host, port))
    sock.listen(128)
    return sock


def ready_line(host: str, port: int, pid: int) -> str:
    """Dòng bắt tay. Tách hàm để test khoá được định dạng."""
    payload = {"host": host, "port": port, "pid": pid}
    return READY_PREFIX + json.dumps(payload, separators=(",", ":"))


def announce_ready(host: str, port: int, pid: int) -> None:
    # `flush` bắt buộc: stdout khi nối vào pipe thì được đệm theo khối, không
    # theo dòng. Không flush thì main chờ mãi không thấy dòng nào, rồi timeout
    # và giết một sidecar đang chạy hoàn toàn bình thường.
    sys.stdout.write(ready_line(host, port, pid) + "\n")
    sys.stdout.flush()


def run(config: SidecarConfig) -> None:
    sock = bind_socket(config.host, config.port)
    actual_host, actual_port = sock.getsockname()[:2]

    app = create_app(config)
    server = uvicorn.Server(
        uvicorn.Config(
            app,
            # Log của uvicorn phải ra stderr, để stdout chỉ còn đúng dòng bắt
            # tay — main không phải lọc nhiễu.
            log_config=None,
            access_log=False,
        )
    )

    announce_ready(actual_host, actual_port, os.getpid())
    server.run(sockets=[sock])


def main() -> int:
    try:
        config = load_config()
    except ConfigError as exc:
        print(f"Cấu hình sidecar không hợp lệ: {exc}", file=sys.stderr)
        return 2

    run(config)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
