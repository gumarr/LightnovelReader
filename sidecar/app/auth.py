"""Xác thực mọi request bằng token dùng chung với Electron main."""

from __future__ import annotations

import secrets
from collections.abc import Awaitable, Callable

from fastapi import Request, Response
from fastapi.responses import JSONResponse

from .config import TOKEN_HEADER

# Đường dẫn không cần token. Chỉ mỗi /health — main phải gọi được nó để biết
# sidecar sống ngay cả khi token hai bên lệch nhau (lúc đó cần chẩn đoán được,
# không phải nhận 401 mù mờ).
PUBLIC_PATHS = frozenset({"/health"})


def token_matches(expected: str, received: str | None) -> bool:
    """So token theo thời gian hằng số.

    So bằng `==` sẽ thoát sớm ở byte đầu khác nhau; đo thời gian phản hồi đủ
    nhiều lần là dò ra được token từng byte một. `compare_digest` không thoát sớm.
    """
    if received is None:
        return False
    return secrets.compare_digest(expected, received)


def make_auth_middleware(
    expected_token: str,
) -> Callable[[Request, Callable[[Request], Awaitable[Response]]], Awaitable[Response]]:
    """Sinh middleware chặn request thiếu token hoặc sai token."""

    async def auth_middleware(
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        if request.url.path in PUBLIC_PATHS:
            return await call_next(request)

        if not token_matches(expected_token, request.headers.get(TOKEN_HEADER)):
            # Không nói rõ thiếu token hay sai token — thông tin đó chỉ có ích
            # cho bên đang dò.
            return JSONResponse(
                status_code=401,
                content={"code": "UNAUTHORIZED", "message": "Token phiên không hợp lệ"},
            )

        return await call_next(request)

    return auth_middleware
