"""Cấu hình sidecar, đọc từ biến môi trường do Electron main đặt lúc spawn.

Token KHÔNG truyền qua tham số dòng lệnh: trên Windows mọi tiến trình đều đọc
được command line của tiến trình khác (`wmic process get CommandLine`), nên
token sẽ lộ cho bất kỳ app nào đang chạy cùng máy. Biến môi trường của tiến
trình con thì chỉ tiến trình đó và cha nó đọc được.
"""

from __future__ import annotations

import os
import secrets
from dataclasses import dataclass

ENV_TOKEN = "LN_SIDECAR_TOKEN"
ENV_HOST = "LN_SIDECAR_HOST"
ENV_PORT = "LN_SIDECAR_PORT"
ENV_MODELS_DIR = "LN_SIDECAR_MODELS_DIR"
ENV_CATALOG_PATH = "LN_SIDECAR_CATALOG"
ENV_AUDIO_DIR = "LN_SIDECAR_AUDIO_DIR"

# Chỉ nghe loopback. Không bao giờ đổi thành 0.0.0.0 — sidecar không có
# xác thực nào ngoài token dùng chung, mở ra LAN là mở cho cả mạng.
DEFAULT_HOST = "127.0.0.1"

# 0 = để OS cấp cổng trống ngẫu nhiên. Cổng cố định sẽ đụng nhau khi user mở
# hai bản app, và cũng dễ đoán để tiến trình khác chọc vào.
DEFAULT_PORT = 0

TOKEN_HEADER = "X-Session-Token"


class ConfigError(RuntimeError):
    """Cấu hình không dùng được — sidecar phải chết ngay chứ không chạy tiếp."""


@dataclass(frozen=True)
class SidecarConfig:
    token: str
    host: str
    port: int
    models_dir: str
    # Đường dẫn `resources/voices/catalog.json`. Main biết chỗ này (lúc dev là
    # gốc repo, lúc đóng gói là `process.resourcesPath`), sidecar thì không —
    # nên nhận qua env chứ đừng tự dò ngược từ `__file__`: ở bản PyInstaller
    # `__file__` nằm trong thư mục giải nén tạm, không phải chỗ có catalog.
    #
    # Rỗng = chưa có catalog. Không ném lỗi như `models_dir` vì app vẫn chạy
    # được (đọc sách không cần voice), chỉ là màn voice manager không có gì.
    catalog_path: str
    # Thư mục audio (`audioDir` trong settings, user đổi được). `/synthesize`
    # chỉ được ghi file BÊN TRONG thư mục này.
    #
    # Vì sao cần: `outPath` đến từ thân request HTTP. Sidecar nghe trên loopback
    # nhưng bất kỳ tiến trình nào trên máy đoán được cổng + token đều gọi được,
    # nên không có ràng buộc này thì một request có thể ghi đè file bất kỳ mà
    # user đang chạy quyền của họ. Rỗng = chưa cấu hình → `/synthesize` từ chối
    # ghi, thay vì ghi bừa ra thư mục làm việc.
    audio_dir: str


def _read_port(raw: str | None) -> int:
    if raw is None or raw == "":
        return DEFAULT_PORT
    try:
        port = int(raw)
    except ValueError as exc:
        raise ConfigError(f"{ENV_PORT} không phải số: {raw!r}") from exc
    if not 0 <= port <= 65535:
        raise ConfigError(f"{ENV_PORT} ngoài khoảng 0–65535: {port}")
    return port


def load_config(env: dict[str, str] | None = None) -> SidecarConfig:
    """Dựng cấu hình từ môi trường.

    Thiếu token thì tự sinh một token ngẫu nhiên thay vì chạy không xác thực:
    chạy tay lúc dev vẫn tiện (token in ra stdout), mà không có đường nào để
    sidecar phục vụ request không kèm token.
    """
    source = os.environ if env is None else env

    token = source.get(ENV_TOKEN, "").strip()
    if not token:
        token = secrets.token_urlsafe(32)

    models_dir = source.get(ENV_MODELS_DIR, "").strip()
    if not models_dir:
        raise ConfigError(
            f"Thiếu {ENV_MODELS_DIR}. Main process phải truyền thư mục model "
            "(lấy từ services/paths.ts) — sidecar không tự đoán vị trí userData."
        )

    return SidecarConfig(
        token=token,
        host=source.get(ENV_HOST, "").strip() or DEFAULT_HOST,
        port=_read_port(source.get(ENV_PORT)),
        models_dir=models_dir,
        catalog_path=source.get(ENV_CATALOG_PATH, "").strip(),
        audio_dir=source.get(ENV_AUDIO_DIR, "").strip(),
    )
