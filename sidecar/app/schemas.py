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


# --- Voice manager (P2.3) -------------------------------------------------
#
# Tên field giữ camelCase khớp `packages/shared/src/types.ts`: đây là dữ liệu
# đi thẳng lên UI, dịch tên ở giữa chỉ thêm một chỗ sai mà không được gì.


class VoiceFileInfo(BaseModel):
    kind: Literal["model", "config"]
    sizeBytes: int  # noqa: N815 — khớp TypeScript, xem ghi chú trên
    sha256: str


class CatalogVoice(BaseModel):
    """Một voice có thể tải. `installed` cho biết đã có sẵn trên máy chưa."""

    id: str
    lang: str
    name: str
    quality: str
    sampleRate: int  # noqa: N815
    license: str
    totalBytes: int  # noqa: N815
    installed: bool
    files: list[VoiceFileInfo]


class CatalogResponse(BaseModel):
    version: int
    voices: list[CatalogVoice]


class InstalledVoiceInfo(BaseModel):
    id: str
    lang: str
    name: str
    quality: str
    sampleRate: int  # noqa: N815
    sizeBytes: int  # noqa: N815


class InstalledVoicesResponse(BaseModel):
    voices: list[InstalledVoiceInfo]


class DeleteVoiceResponse(BaseModel):
    voiceId: str  # noqa: N815
    removed: bool
