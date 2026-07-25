"""Test bắt tay stdout và việc bind socket.

Định dạng dòng bắt tay là **hợp đồng** giữa sidecar và supervisor bên main
(P2.2). Đổi nó mà quên sửa phía main thì app treo ở "Đang khởi động sidecar…"
vĩnh viễn — nên khoá lại ở đây.
"""

from __future__ import annotations

import json
import socket

from app.server import READY_PREFIX, bind_socket, ready_line


class TestDòngBắtTay:
    def test_có_tiền_tố(self) -> None:
        assert ready_line("127.0.0.1", 51234, 999).startswith(READY_PREFIX)

    def test_phần_sau_tiền_tố_là_json_hợp_lệ(self) -> None:
        line = ready_line("127.0.0.1", 51234, 999)
        payload = json.loads(line[len(READY_PREFIX) :])
        assert payload == {"host": "127.0.0.1", "port": 51234, "pid": 999}

    def test_không_chứa_token(self) -> None:
        """Main đã tự sinh token nên biết rồi; in ra chỉ tổ lọt vào log file."""
        assert "token" not in ready_line("127.0.0.1", 1, 2).lower()

    def test_chỉ_một_dòng(self) -> None:
        """Main đọc theo dòng — xuống dòng giữa chừng là parse hỏng."""
        assert "\n" not in ready_line("127.0.0.1", 51234, 999)


class TestBindSocket:
    def test_cổng_không_được_os_cấp_cổng_thật(self) -> None:
        sock = bind_socket("127.0.0.1", 0)
        try:
            assert sock.getsockname()[1] > 0
        finally:
            sock.close()

    def test_chỉ_nghe_loopback(self) -> None:
        sock = bind_socket("127.0.0.1", 0)
        try:
            assert sock.getsockname()[0] == "127.0.0.1"
        finally:
            sock.close()

    def test_hai_lần_bind_ra_cổng_khác_nhau(self) -> None:
        """Hai bản app chạy song song không được đụng cổng nhau."""
        first = bind_socket("127.0.0.1", 0)
        second = bind_socket("127.0.0.1", 0)
        try:
            assert first.getsockname()[1] != second.getsockname()[1]
        finally:
            first.close()
            second.close()

    def test_cổng_đã_bị_chiếm_thì_ném_lỗi(self) -> None:
        """Cố ý KHÔNG đặt SO_REUSEADDR: trên Windows nó cho phép hai tiến
        trình cùng bind một cổng, request sẽ đi lung tung giữa hai bên."""
        first = bind_socket("127.0.0.1", 0)
        port = first.getsockname()[1]
        try:
            raised = False
            try:
                bind_socket("127.0.0.1", port).close()
            except OSError:
                raised = True
            assert raised
        finally:
            first.close()

    def test_socket_đang_lắng_nghe(self) -> None:
        """Bind xong phải listen luôn: main gọi API ngay khi thấy dòng bắt tay,
        chưa listen thì cú gọi đầu tiên bị từ chối."""
        sock = bind_socket("127.0.0.1", 0)
        try:
            port = sock.getsockname()[1]
            with socket.create_connection(("127.0.0.1", port), timeout=2):
                pass
        finally:
            sock.close()
