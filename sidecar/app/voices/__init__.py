"""Quản lý voice: catalog tĩnh, tải từ Hugging Face, kiểm SHA256.

Tách `catalog` (đọc + soi đĩa, thuần) khỏi `download` (mạng + I/O) vì hai thứ
hỏng theo cách hoàn toàn khác nhau: catalog sai định dạng là lỗi lập trình,
còn tải hỏng là chuyện thường ngày của mạng. Gộp lại thì không test được cái
nào mà không dựng cái kia.
"""

from .catalog import (
    Catalog,
    CatalogError,
    VoiceEntry,
    VoiceFile,
    installed_size,
    is_installed,
    is_safe_voice_id,
    load_catalog,
    parse_catalog,
    voice_dir,
)
from .download import (
    DownloadError,
    Progress,
    download_voice,
    file_url,
    remove_voice,
)

__all__ = [
    "Catalog",
    "CatalogError",
    "DownloadError",
    "Progress",
    "VoiceEntry",
    "VoiceFile",
    "download_voice",
    "file_url",
    "installed_size",
    "is_installed",
    "is_safe_voice_id",
    "load_catalog",
    "parse_catalog",
    "remove_voice",
    "voice_dir",
]
