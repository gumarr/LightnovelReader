"""Tải voice từ Hugging Face, kiểm SHA256, cài vào thư mục model.

**Vì sao tải ở sidecar chứ không ở main.** Main tải thì tiến độ mất sạch mỗi
lần renderer reload, và phải viết lại phần băm + verify vốn đã có sẵn ở Python.
Sidecar chạy background task, tiến độ đẩy về qua SSE (CLAUDE.md yêu cầu job
dài phải làm vậy).

**Ba bất biến của module này:**

1. Tải vào file `.part` rồi mới đổi tên. Ghi thẳng vào tên thật thì tải đứt
   giữa chừng để lại file dở dang mà lần sau nhìn vào tưởng đã cài xong.
2. SHA256 **bắt buộc khớp** mới cài. Không khớp thì xoá file, không giữ lại.
3. Băm theo dòng chảy trong lúc tải, không đọc lại file lần hai — file 63 MB
   đọc lại là thêm một lượt I/O không cần thiết.
"""

from __future__ import annotations

import hashlib
import shutil
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import httpx

from .catalog import VoiceEntry, voice_dir

# Đọc theo khối 1 MB: nhỏ quá thì tốn lượt gọi, lớn quá thì thanh tiến trình
# giật cục vì lâu mới cập nhật một lần.
CHUNK_BYTES = 1024 * 1024

# Tải 63 MB qua mạng chậm vẫn phải kịp. Timeout tính theo **lần đọc**, không
# phải tổng thời gian: đặt trần tổng thì mạng chậm sẽ hỏng ở đúng những máy
# cần kiên nhẫn nhất.
READ_TIMEOUT_S = 60.0
CONNECT_TIMEOUT_S = 30.0

PART_SUFFIX = ".part"


class DownloadError(RuntimeError):
    """Tải hỏng — thông báo đã ở dạng đọc được cho user."""


@dataclass(frozen=True)
class Progress:
    """Một mốc tiến độ. `total_bytes` lấy từ catalog nên luôn biết trước."""

    voice_id: str
    state: str
    received_bytes: int
    total_bytes: int
    message: str | None = None


ProgressSink = Callable[[Progress], None]


def file_url(base_url: str, path: str) -> str:
    """Ghép URL tải. Tách hàm để test khoá được cách xử lý dấu `/` thừa/thiếu."""
    return f"{base_url.rstrip('/')}/{path.lstrip('/')}"


def _download_one(
    client: httpx.Client,
    url: str,
    target: Path,
    expected_sha256: str,
    expected_size: int,
    on_chunk: Callable[[int], None],
) -> None:
    """Tải một file vào `target`, băm trong lúc tải, xoá nếu không khớp."""
    digest = hashlib.sha256()
    received = 0

    part = target.with_name(target.name + PART_SUFFIX)
    part.parent.mkdir(parents=True, exist_ok=True)

    try:
        with client.stream("GET", url, follow_redirects=True) as response:
            if response.status_code != 200:
                raise DownloadError(
                    f"Máy chủ trả mã {response.status_code} khi tải {url}"
                )

            with part.open("wb") as handle:
                for chunk in response.iter_bytes(CHUNK_BYTES):
                    handle.write(chunk)
                    digest.update(chunk)
                    received += len(chunk)
                    on_chunk(len(chunk))
    except httpx.HTTPError as exc:
        part.unlink(missing_ok=True)
        raise DownloadError(f"Lỗi mạng khi tải {url}: {exc}") from exc
    except OSError as exc:
        part.unlink(missing_ok=True)
        raise DownloadError(f"Không ghi được file {target}: {exc}") from exc

    if received != expected_size:
        part.unlink(missing_ok=True)
        raise DownloadError(
            f"Kích thước không khớp catalog: nhận {received} byte, chờ {expected_size} byte"
        )

    actual = digest.hexdigest()
    if actual != expected_sha256:
        # Xoá hẳn, không giữ lại để "thử dùng xem": file model hỏng nạp vào
        # engine sẽ hỏng ở chỗ khác hẳn, không lần ngược về đây được.
        part.unlink(missing_ok=True)
        raise DownloadError(
            f"SHA256 không khớp cho {target.name}. File tải về có thể đã hỏng "
            f"hoặc bị thay đổi trên đường truyền (chờ {expected_sha256[:12]}…, "
            f"nhận {actual[:12]}…)"
        )

    # Đổi tên là bước cuối: tới đây file mới có tên thật, nên không bao giờ tồn
    # tại một file đúng tên mà nội dung chưa verify.
    part.replace(target)


def download_voice(
    entry: VoiceEntry,
    models_dir: Path,
    base_url: str,
    sink: ProgressSink,
    client_factory: Callable[[], httpx.Client] | None = None,
) -> None:
    """Tải trọn một voice. Chạy đồng bộ — nơi gọi đưa vào background task.

    Hỏng giữa chừng thì **dọn sạch thư mục voice**, không để lại một nửa: nửa
    vời còn tệ hơn không có, vì `is_installed` phải đoán và user thì tưởng đã
    tải xong.
    """
    directory = voice_dir(models_dir, entry.id)
    total = entry.total_bytes
    received = 0

    sink(Progress(entry.id, "downloading", 0, total))

    def make_client() -> httpx.Client:
        return httpx.Client(
            timeout=httpx.Timeout(READ_TIMEOUT_S, connect=CONNECT_TIMEOUT_S),
            follow_redirects=True,
        )

    factory = client_factory or make_client

    def on_chunk(size: int) -> None:
        nonlocal received
        received += size
        sink(Progress(entry.id, "downloading", received, total))

    try:
        with factory() as client:
            for file in entry.files:
                _download_one(
                    client,
                    file_url(base_url, file.path),
                    directory / file.filename,
                    file.sha256,
                    file.size_bytes,
                    on_chunk,
                )

                # Báo `verifying` SAU khi file xong: băm chạy cùng lúc với tải
                # nên không có giai đoạn verify riêng, nhưng user cần thấy vì
                # sao thanh tiến trình đứng yên ở cuối mỗi file.
                sink(Progress(entry.id, "verifying", received, total))
    except DownloadError:
        remove_voice(models_dir, entry.id)
        raise
    except Exception as exc:  # noqa: BLE001 — dọn rồi ném lại, không nuốt
        remove_voice(models_dir, entry.id)
        raise DownloadError(f"Tải voice thất bại: {exc}") from exc

    sink(Progress(entry.id, "done", total, total))


def remove_voice(models_dir: Path, voice_id: str) -> bool:
    """Xoá thư mục voice. Trả `True` nếu có gì đó để xoá.

    Xoá voice **không** đụng tới audio đã sinh: audio nằm ở `audioDir` hoàn
    toàn khác, và file `.ogg` đã sinh vẫn phát được dù voice không còn.
    """
    directory = voice_dir(models_dir, voice_id)
    if not directory.exists():
        return False
    shutil.rmtree(directory)
    return True


