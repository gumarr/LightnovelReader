"""FastAPI app của sidecar.

P2.1 mới có `/health` và `/normalize`. `/synthesize`, `/voices`, `/align`
thêm ở các phần sau — cố ý không dựng sẵn route trả mock (CLAUDE.md cấm).
"""

from __future__ import annotations

import os

from fastapi import FastAPI

from . import __version__
from .auth import make_auth_middleware
from .config import SidecarConfig
from .schemas import HealthResponse, NormalizeRequest, NormalizeResponse
from .text import normalize


def create_app(config: SidecarConfig) -> FastAPI:
    """Dựng app với token đã biết.

    Nhận config làm tham số (không đọc `os.environ` bên trong) để test dựng
    được app với token tự chọn mà không phải đụng vào môi trường thật.
    """
    app = FastAPI(
        title="LN Reader TTS sidecar",
        version=__version__,
        # Không mở docs: sidecar không phải API công khai, và trang docs là
        # đường duy nhất phục vụ request không kèm token.
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )

    app.middleware("http")(make_auth_middleware(config.token))

    @app.get("/health", response_model=HealthResponse)
    async def health() -> HealthResponse:
        return HealthResponse(
            status="ok",
            version=__version__,
            pid=os.getpid(),
            engine_ready=False,
        )

    @app.post("/normalize", response_model=NormalizeResponse)
    async def normalize_text(request: NormalizeRequest) -> NormalizeResponse:
        return NormalizeResponse(text=normalize(request.text, request.lang), lang=request.lang)

    return app
