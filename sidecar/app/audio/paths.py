"""Kiểm đường dẫn ghi audio. Hàm thuần, không đụng đĩa ngoài `resolve()`.

**Vì sao phải kiểm dù main đã tính path bằng `services/paths.ts`.** Sidecar là
tiến trình HTTP riêng: bất kỳ tiến trình nào trên máy đoán được cổng + token đều
gọi thẳng `/synthesize` được. Tin biên trên kiểm hộ là bỏ trống đúng cửa mà kẻ
tấn công đi vào — cùng lý lẽ với `is_safe_voice_id` ở `voices/catalog.py`.

Hậu quả nếu không kiểm: một request đặt `outPath` thành
`C:/Users/.../AppData/Roaming/LN Reader/ln-reader.db` sẽ ghi đè cả thư viện
sách bằng dữ liệu Opus.
"""

from __future__ import annotations

from pathlib import Path


class AudioPathError(ValueError):
    """`outPath` không nằm trong thư mục audio cho phép."""


# Chỉ ghi file `.ogg`. Không phải để chống tấn công (kẻ tấn công đặt đuôi gì
# cũng được) mà để bắt sớm lỗi lập trình: main gửi nhầm đường dẫn `.json` của
# timing sang đây thì hỏng ở chỗ khác hẳn, rất khó lần ra.
AUDIO_SUFFIX = ".ogg"


def resolve_audio_path(audio_dir: str, out_path: str) -> Path:
    """Trả `Path` tuyệt đối đã kiểm, hoặc ném `AudioPathError`.

    Dùng `resolve()` để `..`, symlink và đường dẫn tương đối đều quy về dạng
    chuẩn TRƯỚC khi so sánh — so trên chuỗi thô thì `audioDir/../../x` lọt qua.
    """
    if not audio_dir:
        raise AudioPathError(
            "Sidecar chưa được cấu hình thư mục audio (LN_SIDECAR_AUDIO_DIR). "
            "Main process phải truyền nó lúc spawn."
        )

    root = Path(audio_dir).resolve()
    target = Path(out_path)

    # Đường dẫn tương đối tính theo `audio_dir`, không theo thư mục làm việc của
    # tiến trình — thư mục đó là thứ không ai kiểm soát ở bản đóng gói.
    if not target.is_absolute():
        target = root / target
    target = target.resolve()

    if target.suffix.lower() != AUDIO_SUFFIX:
        raise AudioPathError(f"File audio phải có đuôi {AUDIO_SUFFIX}, nhận {target.name!r}")

    # `is_relative_to` so trên path đã chuẩn hoá, không phải so chuỗi tiền tố:
    # so chuỗi thì `/audio-khac` khớp tiền tố `/audio` và lọt qua.
    if target != root and not target.is_relative_to(root):
        raise AudioPathError(
            f"Đường dẫn nằm ngoài thư mục audio cho phép: {target}"
        )

    return target
