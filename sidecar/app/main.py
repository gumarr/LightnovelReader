"""FastAPI app của sidecar.

Route hiện có: `/health`, `/normalize` (P2.1), nhóm `/voices` (P2.3),
`/synthesize` (P2.4) và `/preview` (P5.1 — nghe thử giọng đã cài).

Không có `/align`: Phase 4 (CTC forced alignment) đã bị **bỏ** sau khi nghe thật
một chương thấy timing phoneme của Piper đã bám đúng nhịp. Xem PROGRESS.md
mục 4 để biết lý do và điều kiện mở lại.
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
from collections.abc import AsyncIterator
from dataclasses import replace
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse

from . import __version__
from .audio import AudioPathError, EncodeError, resolve_audio_path, write_opus
from .auth import make_auth_middleware
from .config import SidecarConfig
from .engines import EngineError, EngineRegistry, SynthesisResult
from .schemas import (
    CatalogResponse,
    CatalogVoice,
    DeleteVoiceResponse,
    HealthResponse,
    InstalledVoiceInfo,
    InstalledVoicesResponse,
    NormalizeRequest,
    NormalizeResponse,
    PreviewRequest,
    PreviewResponse,
    SynthesizeRequest,
    SynthesizeResponse,
    VoiceFileInfo,
    WordTimingModel,
)
from .audio.timings import remap_to_source
from .text import normalize_mapped
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
    resolve_model_entry,
    voice_base_url,
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

    # Một registry dùng chung cho cả tiến trình: nó giữ model đã nạp (~200 MB
    # RAM cho Piper, ~300 MB cho VieNeu) nên dựng mới mỗi request là nạp lại và
    # phình bộ nhớ. Từng engine tự khoá luồng — xem `PiperEngine`/`VieneuEngine`.
    engine = EngineRegistry(models_dir)

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
            # Trạng thái THẬT từ P2.4. `False` lúc mới khởi động là bình thường:
            # engine nạp lười ở lần synthesize đầu tiên, không nạp sẵn 63 MB cho
            # người chỉ muốn đọc sách.
            engine_ready=engine.ready,
            loaded_voice_id=engine.loaded_voice_id,
        )

    @app.post("/normalize", response_model=NormalizeResponse)
    async def normalize_text(request: NormalizeRequest) -> NormalizeResponse:
        # Endpoint này chỉ xem trước text sẽ đọc, không sinh timing — lấy
        # `.spoken` là đủ, mapping để dành cho `/synthesize`.
        normalized = normalize_mapped(request.text, request.lang)
        return NormalizeResponse(text=normalized.spoken, lang=request.lang)

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
                    engine=entry.engine,
                    # Dung lượng và trạng thái cài lấy theo voice MANG model:
                    # 14 giọng VieNeu dùng chung một bộ 244 MB, nên hỏi thẳng
                    # `entry` sẽ ra 0 byte và "đã cài" cho giọng chưa tải gì.
                    totalBytes=resolve_model_entry(catalog, entry).total_bytes,
                    installed=is_installed(models_dir, resolve_model_entry(catalog, entry)),
                    files=[
                        VoiceFileInfo(kind=f.kind, sizeBytes=f.size_bytes, sha256=f.sha256)
                        for f in resolve_model_entry(catalog, entry).files
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
                    engine=entry.engine,
                    # Giọng dùng model chung trả 0 — xem `installed_size`. Cộng
                    # 244 MB cho cả 14 giọng sẽ báo sai gấp 14 lần ở màn Dung lượng.
                    sizeBytes=installed_size(models_dir, entry),
                )
                for entry in catalog.voices
                if is_installed(models_dir, resolve_model_entry(catalog, entry))
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
        requested = catalog.find(voice_id)
        if requested is None:
            raise HTTPException(status_code=404, detail=f"Không có voice {voice_id!r} trong catalog")

        # Tải **bộ model**, không tải "giọng": 14 giọng VieNeu dùng chung một bộ
        # 244 MB. Bấm tải giọng thứ hai khi đã có model thì không tải lại gì.
        entry = resolve_model_entry(catalog, requested)
        base_url = voice_base_url(catalog, entry)

        # Hàng đợi nối thread tải với vòng lặp async đang phát SSE. `sink` chạy
        # trong thread tải nên phải dùng `call_soon_threadsafe`, không được
        # đụng thẳng vào queue.
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue[Progress | None] = asyncio.Queue()

        def sink(progress: Progress) -> None:
            # Báo tiến độ dưới `voice_id` **user đã bấm**, không phải id của bộ
            # model. Với VieNeu hai cái khác nhau, mà UI lọc event theo đúng id
            # nó gửi đi — báo id khác thì thanh tiến trình đứng im tới lúc xong.
            loop.call_soon_threadsafe(
                queue.put_nowait, replace(progress, voice_id=voice_id)
            )

        async def run_download() -> None:
            try:
                await asyncio.to_thread(
                    download_voice, entry, models_dir, base_url, sink
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

    @app.post("/synthesize", response_model=SynthesizeResponse)
    async def synthesize(request: SynthesizeRequest) -> SynthesizeResponse:
        """Tổng hợp **một segment** thành `.ogg` + mốc thời gian từng từ.

        **Một segment mỗi lần, không phải cả chương.** Segment là đơn vị generate
        theo domain model (CLAUDE.md): ~10 s audio, một file `.ogg`. Nhận cả
        chương thì một lỗi mất cả chương, huỷ giữa chừng không được, và priority
        queue ở P2.5 không chen được segment sắp phát lên đầu.

        **Vì sao chạy trong thread riêng.** Tổng hợp là CPU-bound và mất ~2 s cho
        một segment. Chạy thẳng trong coroutine sẽ chặn cả event loop, `/health`
        treo theo, và supervisor bên main sẽ tưởng sidecar chết rồi giết oan —
        đúng vết xe đổ đã tránh ở `/voices/{id}/download` (P2.3).
        """
        catalog = read_catalog()
        entry = catalog.find(request.voiceId)
        if entry is None:
            raise HTTPException(
                status_code=404, detail=f"Không có voice {request.voiceId!r} trong catalog"
            )

        try:
            target = resolve_audio_path(config.audio_dir, request.outPath)
        except AudioPathError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        # Chuẩn hoá text TRƯỚC khi đọc: "11-5" thành "mười một năm", "TP." thành
        # "thành phố", "Tokyo" thành "Tô-ki-ô"…
        #
        # Timing do engine sinh ra bám theo bản ĐÃ chuẩn hoá, còn UI tô chữ trên
        # bản GỐC — thứ user đang nhìn. Nên `normalized` mang theo bảng ánh xạ
        # để `remap_to_source` quy `charStart`/`charEnd` ngược lại sau khi tổng
        # hợp xong. Thiếu bước đó thì highlight lệch ngay ở câu đầu có tên riêng
        # hoặc chữ số (xem plan.md mục 8.1).
        normalized = normalize_mapped(request.text, request.lang, request.pronunciations)
        spoken = normalized.spoken

        def run() -> SynthesisResult:
            # Đặt phong cách theo request: rẻ (chỉ gán một chuỗi) và không nạp
            # lại model, nên không cần nhớ giá trị cũ để so.
            engine.set_style(request.style)
            result = engine.synthesize(spoken, entry, catalog, request.bitrate)
            # Ghi đĩa trong CÙNG thread với tổng hợp: tách ra thì phải mang cả
            # mảng bytes qua lại giữa các thread mà chẳng được gì.
            write_opus(target, result.audio)
            return result

        try:
            result = await asyncio.to_thread(run)
        except EngineError as exc:
            # 422: request hợp lệ về hình thức nhưng không xử lý được (voice chưa
            # cài, model hỏng). Khác hẳn 500 — main phân biệt để báo user đúng
            # cách sửa thay vì "lỗi không rõ".
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except EncodeError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except OSError as exc:
            raise HTTPException(
                status_code=500, detail=f"Không ghi được file audio: {exc}"
            ) from exc

        # Quy offset về text GỐC trước khi trả — xem chú thích ở `normalize_mapped`.
        timings = remap_to_source(result.timings, normalized)

        return SynthesizeResponse(
            audioPath=str(target),
            durationMs=result.audio.duration_ms,
            audioBytes=result.audio.size_bytes,
            sampleRate=result.audio.sample_rate,
            voiceId=result.voice_id,
            timingSource=result.timing_source,
            timings=[
                WordTimingModel(
                    w=t.w,
                    startMs=t.start_ms,
                    endMs=t.end_ms,
                    charStart=t.char_start,
                    charEnd=t.char_end,
                )
                for t in timings
            ],
        )

    @app.post("/preview", response_model=PreviewResponse)
    async def preview(request: PreviewRequest) -> PreviewResponse:
        """Đọc thử một câu mẫu bằng voice đã cài, trả bytes `.ogg` **không ghi đĩa**.

        **Vì sao không dùng lại `/synthesize`.** Route kia bắt buộc có `outPath`
        nằm trong `audioDir` và luôn ghi ra file. Nghe thử mà đi đường đó thì mỗi
        lần bấm lại đẻ một file rác trong thư viện audio của user, và Storage
        Manager sẽ đếm nó thành dung lượng sách. `engine.synthesize` vốn đã trả
        bytes trong RAM (`EncodedAudio`), ghi đĩa là bước riêng — nên bỏ bước đó
        là đủ, không phải viết lại gì.

        **Không trả timing.** Nghe thử là để nghe giọng, không phải để tô chữ.
        Bỏ luôn cả bước `remap_to_source`.

        Chạy trong thread riêng vì cùng lý do với `/synthesize`: CPU-bound, chặn
        event loop thì `/health` treo và supervisor giết oan sidecar.
        """
        catalog = read_catalog()
        entry = catalog.find(request.voiceId)
        if entry is None:
            raise HTTPException(
                status_code=404, detail=f"Không có voice {request.voiceId!r} trong catalog"
            )

        # Chuẩn hoá y như lúc đọc thật: câu mẫu có tên riêng Nhật thì user phải
        # nghe được đúng thứ app sẽ đọc, không phải bản chưa qua xử lý.
        normalized = normalize_mapped(request.text, request.lang, {})

        def run() -> SynthesisResult:
            engine.set_style(request.style)
            return engine.synthesize(normalized.spoken, entry, catalog, request.bitrate)

        try:
            result = await asyncio.to_thread(run)
        except EngineError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except EncodeError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

        return PreviewResponse(
            voiceId=result.voice_id,
            durationMs=result.audio.duration_ms,
            sampleRate=result.audio.sample_rate,
            audioBase64=base64.b64encode(result.audio.data).decode("ascii"),
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
