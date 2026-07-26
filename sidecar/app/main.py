"""FastAPI app của sidecar.

Route hiện có: `/health`, `/normalize` (P2.1) và nhóm `/voices` (P2.3).
`/synthesize`, `/align` thêm ở P2.4 — cố ý không dựng sẵn route trả mock
(CLAUDE.md cấm).
"""

from __future__ import annotations

import asyncio
import json
import os
from collections.abc import AsyncIterator
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse

from . import __version__
from .auth import make_auth_middleware
from .config import SidecarConfig
from .schemas import (
    CatalogResponse,
    CatalogVoice,
    DeleteVoiceResponse,
    HealthResponse,
    InstalledVoiceInfo,
    InstalledVoicesResponse,
    NormalizeRequest,
    NormalizeResponse,
    VoiceFileInfo,
)
from .text import normalize
from .voices import (
    Catalog,
    CatalogError,
    DownloadError,
    Progress,
    download_voice,
    installed_size,
    is_installed,
    load_catalog,
    remove_voice,
)


def _sse(payload: dict[str, object]) -> str:
    """Một khung SSE. `ensure_ascii=False` để tên voice tiếng Việt không bị escape."""
    return f"data: {json.dumps(payload, ensure_ascii=False, separators=(',', ':'))}\n\n"


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

    models_dir = Path(config.models_dir)
    catalog_path = Path(config.catalog_path) if config.catalog_path else None

    def read_catalog() -> Catalog:
        """Đọc catalog mỗi lần gọi thay vì cache lúc khởi động.

        File này chỉ vài KB nên đọc lại không đáng kể, đổi lại là sửa catalog
        lúc dev không phải khởi động lại cả app. Catalog hỏng thì báo 500 kèm
        lý do thật — đây là lỗi lập trình hoặc file bị sửa tay, không phải
        chuyện user làm sai.
        """
        if catalog_path is None:
            return Catalog(version=0, base_url="", voices=())
        try:
            return load_catalog(catalog_path)
        except CatalogError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

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

    @app.get("/voices/catalog", response_model=CatalogResponse)
    async def voices_catalog() -> CatalogResponse:
        """Voice có thể tải, kèm cờ đã cài chưa.

        Khai TRƯỚC `/voices/{voice_id}`: FastAPI khớp route theo thứ tự khai
        báo, để sau thì `catalog` bị nuốt thành một `voice_id`.
        """
        catalog = read_catalog()
        return CatalogResponse(
            version=catalog.version,
            voices=[
                CatalogVoice(
                    id=entry.id,
                    lang=entry.lang,
                    name=entry.name,
                    quality=entry.quality,
                    sampleRate=entry.sample_rate,
                    license=entry.license,
                    totalBytes=entry.total_bytes,
                    installed=is_installed(models_dir, entry),
                    files=[
                        VoiceFileInfo(kind=f.kind, sizeBytes=f.size_bytes, sha256=f.sha256)
                        for f in entry.files
                    ],
                )
                for entry in catalog.voices
            ],
        )

    @app.get("/voices", response_model=InstalledVoicesResponse)
    async def voices_installed() -> InstalledVoicesResponse:
        """Voice đã cài — thứ dùng được ngay, khác với catalog là thứ tải được."""
        catalog = read_catalog()
        return InstalledVoicesResponse(
            voices=[
                InstalledVoiceInfo(
                    id=entry.id,
                    lang=entry.lang,
                    name=entry.name,
                    quality=entry.quality,
                    sampleRate=entry.sample_rate,
                    sizeBytes=installed_size(models_dir, entry),
                )
                for entry in catalog.voices
                if is_installed(models_dir, entry)
            ],
        )

    @app.post("/voices/{voice_id}/download")
    async def voices_download(voice_id: str) -> StreamingResponse:
        """Tải voice, đẩy tiến độ qua SSE.

        Tải chạy trong thread riêng (`asyncio.to_thread`): `httpx.Client` là
        API đồng bộ, gọi thẳng trong coroutine sẽ chặn cả event loop và
        `/health` treo theo — supervisor bên main sẽ tưởng sidecar chết rồi
        giết oan một tiến trình đang tải dở 63 MB.
        """
        catalog = read_catalog()
        entry = catalog.find(voice_id)
        if entry is None:
            raise HTTPException(status_code=404, detail=f"Không có voice {voice_id!r} trong catalog")

        # Hàng đợi nối thread tải với vòng lặp async đang phát SSE. `sink` chạy
        # trong thread tải nên phải dùng `call_soon_threadsafe`, không được
        # đụng thẳng vào queue.
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue[Progress | None] = asyncio.Queue()

        def sink(progress: Progress) -> None:
            loop.call_soon_threadsafe(queue.put_nowait, progress)

        async def run_download() -> None:
            try:
                await asyncio.to_thread(
                    download_voice, entry, models_dir, catalog.base_url, sink
                )
            except DownloadError as exc:
                queue.put_nowait(
                    Progress(voice_id, "error", 0, entry.total_bytes, str(exc))
                )
            finally:
                # `None` là dấu hết luồng. Đặt ở `finally` để lỗi bất ngờ cũng
                # đóng được stream — thiếu nó thì UI treo mãi ở thanh tiến trình.
                queue.put_nowait(None)

        async def stream() -> AsyncIterator[str]:
            task = asyncio.create_task(run_download())
            try:
                while True:
                    progress = await queue.get()
                    if progress is None:
                        break
                    payload: dict[str, object] = {
                        "voiceId": progress.voice_id,
                        "state": progress.state,
                        "receivedBytes": progress.received_bytes,
                        "totalBytes": progress.total_bytes,
                    }
                    if progress.message is not None:
                        payload["message"] = progress.message
                    yield _sse(payload)
            finally:
                # Client ngắt giữa chừng (đóng app, reload renderer) thì vòng
                # lặp trên bị huỷ — vẫn phải chờ task tải kết thúc, nếu không
                # nó ghi tiếp vào file sau khi request đã đóng.
                await task

        return StreamingResponse(
            stream(),
            media_type="text/event-stream",
            # Chặn mọi tầng đệm: SSE mà bị gom lại thì tiến độ tới nơi một cục
            # lúc tải xong, đúng lúc không còn ai cần nữa.
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    @app.delete("/voices/{voice_id}", response_model=DeleteVoiceResponse)
    async def voices_delete(voice_id: str) -> DeleteVoiceResponse:
        """Xoá voice khỏi đĩa. Không đụng audio đã sinh — audio nằm ở `audioDir`."""
        try:
            removed = await asyncio.to_thread(remove_voice, models_dir, voice_id)
        except CatalogError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except OSError as exc:
            raise HTTPException(
                status_code=500, detail=f"Không xoá được voice {voice_id}: {exc}"
            ) from exc
        return DeleteVoiceResponse(voiceId=voice_id, removed=removed)

    return app
