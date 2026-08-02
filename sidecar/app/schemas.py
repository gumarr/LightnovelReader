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
    # Engine TTS đã nạp xong voice nào chưa.
    #
    # Từ P2.4 đây là trạng thái THẬT, không còn `False` cứng. Nhưng nghĩa của nó
    # là "đã nạp xong một voice", KHÔNG phải "generate được": engine nạp lười ở
    # lần synthesize đầu tiên, nên `False` lúc mới khởi động là bình thường.
    # Supervisor không được coi `False` là hỏng.
    engine_ready: bool = False
    # Voice đang giữ trong bộ nhớ, `None` khi chưa nạp gì.
    loaded_voice_id: str | None = None


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
    # `asset` thêm ở P6.2: engine ngoài Piper không chỉ có đúng model + config
    # (VieNeu có 13 file). Giữ `model`/`config` để catalog Piper không đổi.
    kind: Literal["model", "config", "asset"]
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
    # `piper` | `vieneu`. UI cần để hiện nhãn engine và giải thích vì sao giọng
    # này nặng 244 MB còn giọng kia 63 MB.
    engine: str
    totalBytes: int  # noqa: N815
    installed: bool
    # Giọng nhân bản từ mẫu thu, không phải giọng dựng sẵn của model. UI nói
    # thẳng mức độ giống thay vì để user tưởng là bản sao y hệt.
    cloned: bool = False
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
    engine: str
    # Giọng VieNeu dùng model chung trả 0 — 14 giọng cùng một bộ 244 MB, cộng
    # cho từng giọng sẽ báo gấp 14 lần ở màn Dung lượng.
    sizeBytes: int  # noqa: N815


class InstalledVoicesResponse(BaseModel):
    voices: list[InstalledVoiceInfo]


class DeleteVoiceResponse(BaseModel):
    voiceId: str  # noqa: N815
    removed: bool


# --- Tổng hợp giọng đọc (P2.4) --------------------------------------------


class SynthesizeRequest(BaseModel):
    """Tổng hợp MỘT segment. Không nhận cả chương — xem ghi chú ở route."""

    text: str = Field(min_length=1, max_length=2_000)
    voiceId: str = Field(min_length=1, max_length=64)  # noqa: N815
    # Đường dẫn file `.ogg` đích, do main tính qua `services/paths.ts`. Sidecar
    # KHÔNG tự ghép path: `audioDir` user đổi được và chỉ main biết nó ở đâu.
    outPath: str = Field(min_length=1)  # noqa: N815
    bitrate: Literal[16, 24, 32] = 24
    # Ngôn ngữ để chuẩn hoá text trước khi đọc (số, viết tắt, ngày tháng).
    lang: str = Field(default="vi", min_length=2, max_length=8)
    # Bảng phiên âm do user tự sửa cho cuốn sách này (P3.5, tầng 3 — plan.md
    # mục 8.1). Khoá viết thường. Rỗng là chuyện thường: hai tầng kia đã lo
    # phần lớn, đây chỉ là van an toàn.
    #
    # Giới hạn 500 mục: bảng này đi kèm MỌI request synthesize, để user dán
    # vào hàng chục nghìn dòng thì mỗi segment gánh thêm cả trăm KB.
    pronunciations: dict[str, str] = Field(default_factory=dict, max_length=500)
    # Phong cách đọc, chỉ có tác dụng với engine VieNeu (P6.2). Piper bỏ qua.
    #
    # Đi kèm từng request thay vì đặt một lần lúc khởi động: user đổi phong cách
    # trong Cài đặt mà sidecar giữ giá trị cũ thì phải khởi động lại app mới
    # thấy đổi — đúng loại "cài đặt chết" mà PROGRESS 4.71 cảnh báo.
    style: Literal["doc_truyen", "tu_nhien", "tin_tuc"] = "doc_truyen"


class PreviewRequest(BaseModel):
    """Nghe thử một giọng đã cài. Không ghi đĩa — xem ghi chú ở route `/preview`."""

    voiceId: str = Field(min_length=1, max_length=64)  # noqa: N815
    # Câu mẫu do main chọn theo ngôn ngữ của voice. Giới hạn ngắn hơn hẳn
    # `SynthesizeRequest` (2000): nghe thử là một câu, không phải một đoạn — và
    # câu càng dài thì user càng phải chờ lâu mới nghe được tiếng đầu tiên.
    text: str = Field(min_length=1, max_length=300)
    lang: str = Field(default="vi", min_length=2, max_length=8)
    bitrate: Literal[16, 24, 32] = 24
    # Nghe thử phải dùng ĐÚNG phong cách sẽ generate, nếu không user chọn giọng
    # dựa trên thứ khác với thứ họ sẽ nghe.
    style: Literal["doc_truyen", "tu_nhien", "tin_tuc"] = "doc_truyen"


class PreviewResponse(BaseModel):
    """Bytes `.ogg` trả thẳng trong JSON dưới dạng base64.

    Không trả `audioPath` như `/synthesize` vì không có file nào được tạo. Base64
    phình 33% nhưng một câu mẫu ~3 s ở 24 kbps chỉ ~9 KB → ~12 KB sau mã hoá,
    không đáng để dựng thêm một kiểu response nhị phân riêng.
    """

    voiceId: str  # noqa: N815
    durationMs: int  # noqa: N815
    sampleRate: int  # noqa: N815
    # `.ogg` đã mã hoá base64. Renderer bọc thành Blob URL cho thẻ `<audio>`.
    audioBase64: str  # noqa: N815


class WordTimingModel(BaseModel):
    """Khớp `WordTiming` ở `packages/shared/src/types.ts` — tên field giữ nguyên."""

    w: str
    startMs: int  # noqa: N815
    endMs: int  # noqa: N815
    charStart: int  # noqa: N815
    charEnd: int  # noqa: N815


class SynthesizeResponse(BaseModel):
    audioPath: str  # noqa: N815
    durationMs: int  # noqa: N815
    audioBytes: int  # noqa: N815
    sampleRate: int  # noqa: N815
    voiceId: str  # noqa: N815
    # `phoneme` = alignment thật của Piper, `estimate` = chia theo độ dài ký tự.
    # Đưa lên UI để chẩn đoán được vì sao highlight lệch, thay vì đoán mò.
    timingSource: Literal["phoneme", "estimate"]  # noqa: N815
    timings: list[WordTimingModel]
