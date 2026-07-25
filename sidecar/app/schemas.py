"""Request/response của sidecar. Mọi biên vào-ra đều qua pydantic.

Giữ tên field khớp với `packages/shared/src/types.ts` để hai bên không phải
dịch tên qua lại.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

# Trạng thái sidecar báo cho supervisor bên main.
# `starting` = tiến trình đã lên nhưng engine chưa nạp xong model.
HealthStatus = Literal["starting", "ok"]


class HealthResponse(BaseModel):
    status: HealthStatus
    version: str
    pid: int
    # Engine TTS đã sẵn sàng chưa. P2.1 luôn là False — chưa có engine nào.
    engine_ready: bool = False


class NormalizeRequest(BaseModel):
    text: str = Field(min_length=1, max_length=10_000)
    lang: str = Field(default="vi", min_length=2, max_length=8)


class NormalizeResponse(BaseModel):
    text: str
    lang: str


class ErrorResponse(BaseModel):
    code: str
    message: str
