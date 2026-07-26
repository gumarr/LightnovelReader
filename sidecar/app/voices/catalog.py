"""Đọc catalog voice và soi thư mục model để biết voice nào đã cài.

Hàm ở đây **thuần** hết mức có thể: nhận đường dẫn làm tham số, không tự đoán
vị trí. Nhờ vậy test dựng được cây thư mục tạm mà không cần bản đóng gói thật.

Catalog là file **tĩnh** đóng gói theo app (`resources/voices/catalog.json`),
không gọi Hugging Face để lấy danh sách. Lý do: gọi mạng thì màn voice manager
không mở nổi khi offline, mà offline lại đúng lúc user cần xem mình đã tải gì.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

# Piper cần đủ hai file mới dùng được: model và config phoneme đi kèm.
FILE_KINDS = ("model", "config")

_SHA256_LENGTH = 64
_HEX_DIGITS = frozenset("0123456789abcdef")


class CatalogError(RuntimeError):
    """Catalog không đọc được hoặc sai định dạng."""


@dataclass(frozen=True)
class VoiceFile:
    kind: str
    path: str
    size_bytes: int
    sha256: str

    @property
    def filename(self) -> str:
        """Tên file lưu xuống đĩa — chỉ lấy phần cuối, bỏ cây thư mục của HF."""
        return self.path.rsplit("/", 1)[-1]


@dataclass(frozen=True)
class VoiceEntry:
    id: str
    lang: str
    name: str
    quality: str
    sample_rate: int
    license: str
    files: tuple[VoiceFile, ...]

    @property
    def total_bytes(self) -> int:
        return sum(f.size_bytes for f in self.files)


@dataclass(frozen=True)
class Catalog:
    version: int
    base_url: str
    voices: tuple[VoiceEntry, ...]

    def find(self, voice_id: str) -> VoiceEntry | None:
        return next((v for v in self.voices if v.id == voice_id), None)


def is_safe_voice_id(voice_id: str) -> bool:
    """`voice_id` trở thành tên thư mục trên đĩa, nên phải chặn ký tự thoát ra.

    Kiểm ở đây **dù** main đã kiểm bằng zod: sidecar là tiến trình HTTP riêng,
    bất cứ ai trên máy đoán được cổng + token đều gọi thẳng được. Tin biên trên
    kiểm hộ là bỏ trống đúng cửa mà kẻ tấn công đi vào.
    """
    if not voice_id or len(voice_id) > 64:
        return False
    return all(c.isalnum() or c in "-_" for c in voice_id)


def _require_str(raw: dict[str, object], key: str, where: str) -> str:
    value = raw.get(key)
    if not isinstance(value, str) or not value:
        raise CatalogError(f"{where}: thiếu hoặc sai kiểu trường {key!r}")
    return value


def _require_int(raw: dict[str, object], key: str, where: str) -> int:
    value = raw.get(key)
    # `bool` là con của `int` trong Python — không loại ra thì `true` lọt thành 1.
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise CatalogError(f"{where}: {key!r} phải là số nguyên dương")
    return value


def _parse_file(raw: object, where: str) -> VoiceFile:
    if not isinstance(raw, dict):
        raise CatalogError(f"{where}: mỗi file phải là object")

    kind = _require_str(raw, "kind", where)
    if kind not in FILE_KINDS:
        raise CatalogError(f"{where}: kind {kind!r} không hợp lệ")

    path = _require_str(raw, "path", where)
    # `path` vừa ghép vào URL vừa quyết định tên file ghi xuống đĩa. Để lọt
    # `..` hay đường dẫn tuyệt đối là ghi được ra ngoài thư mục voice.
    if ".." in path or path.startswith("/") or path.startswith("\\") or ":" in path:
        raise CatalogError(f"{where}: path {path!r} không phải đường dẫn tương đối an toàn")

    sha256 = _require_str(raw, "sha256", where).lower()
    if len(sha256) != _SHA256_LENGTH or not set(sha256) <= _HEX_DIGITS:
        raise CatalogError(f"{where}: sha256 phải là {_SHA256_LENGTH} ký tự hex")

    return VoiceFile(
        kind=kind,
        path=path,
        size_bytes=_require_int(raw, "sizeBytes", where),
        sha256=sha256,
    )


def _parse_voice(raw: object, index: int) -> VoiceEntry:
    where = f"voices[{index}]"
    if not isinstance(raw, dict):
        raise CatalogError(f"{where}: mỗi voice phải là object")

    voice_id = _require_str(raw, "id", where)
    if not is_safe_voice_id(voice_id):
        raise CatalogError(f"{where}: id {voice_id!r} chứa ký tự không dùng làm tên thư mục được")

    raw_files = raw.get("files")
    if not isinstance(raw_files, list) or not raw_files:
        raise CatalogError(f"{where}: thiếu danh sách files")

    files = tuple(_parse_file(f, f"{where}.files[{i}]") for i, f in enumerate(raw_files))

    kinds = {f.kind for f in files}
    missing = set(FILE_KINDS) - kinds
    if missing:
        # Bắt ở đây thay vì lúc tải: catalog thiếu config thì voice tải xong
        # vẫn không dùng được, mà lúc đó user đã chờ hết 63 MB.
        raise CatalogError(f"{where}: thiếu file loại {sorted(missing)}")

    return VoiceEntry(
        id=voice_id,
        lang=_require_str(raw, "lang", where),
        name=_require_str(raw, "name", where),
        quality=_require_str(raw, "quality", where),
        sample_rate=_require_int(raw, "sampleRate", where),
        license=str(raw.get("license", "")),
        files=files,
    )


def parse_catalog(raw: object) -> Catalog:
    """Dựng catalog từ JSON đã đọc. Tách khỏi I/O để test không cần file thật."""
    if not isinstance(raw, dict):
        raise CatalogError("Catalog phải là một object JSON")

    base_url = _require_str(raw, "baseUrl", "catalog")
    if not base_url.startswith("https://"):
        # Bắt buộc HTTPS: model tải về sẽ được nạp và chạy, tải qua HTTP thì bất
        # kỳ ai trên đường truyền cũng thay được nội dung.
        raise CatalogError(f"catalog: baseUrl phải dùng https, nhận {base_url!r}")

    raw_voices = raw.get("voices")
    if not isinstance(raw_voices, list):
        raise CatalogError("catalog: thiếu danh sách voices")

    voices = tuple(_parse_voice(v, i) for i, v in enumerate(raw_voices))

    seen: set[str] = set()
    for voice in voices:
        if voice.id in seen:
            raise CatalogError(f"catalog: voice id trùng nhau: {voice.id!r}")
        seen.add(voice.id)

    return Catalog(
        version=_require_int(raw, "version", "catalog"),
        base_url=base_url,
        voices=voices,
    )


def load_catalog(path: Path) -> Catalog:
    """Đọc catalog từ đĩa.

    Không có file thì trả catalog rỗng chứ không ném: thiếu catalog là "chưa tải
    được voice nào", còn app vẫn phải mở được. Ném ở đây thì màn voice manager
    trắng xoá mà user không biết vì sao.
    """
    if not path.is_file():
        return Catalog(version=0, base_url="", voices=())

    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise CatalogError(f"Không đọc được catalog ở {path}: {exc}") from exc

    return parse_catalog(raw)


def voice_dir(models_dir: Path, voice_id: str) -> Path:
    """Thư mục của một voice. Khớp `voiceDir()` ở `apps/main/src/services/paths.ts`."""
    if not is_safe_voice_id(voice_id):
        raise CatalogError(f"voiceId không hợp lệ: {voice_id!r}")
    return models_dir / "voices" / voice_id


def is_installed(models_dir: Path, entry: VoiceEntry) -> bool:
    """Voice tính là đã cài khi **đủ mọi file** và kích thước khớp catalog.

    Chỉ kiểm thư mục tồn tại là sai: lần tải trước đứt giữa chừng để lại thư
    mục có file `.onnx` dở dang, engine nạp vào sẽ hỏng ở tận P2.4 — xa chỗ gây
    lỗi tới mức không lần ra. Kiểm kích thước bắt được đúng ca đó mà không phải
    băm lại 63 MB mỗi lần mở màn hình.
    """
    directory = voice_dir(models_dir, entry.id)
    for file in entry.files:
        target = directory / file.filename
        if not target.is_file() or target.stat().st_size != file.size_bytes:
            return False
    return True


def installed_size(models_dir: Path, entry: VoiceEntry) -> int:
    directory = voice_dir(models_dir, entry.id)
    total = 0
    for file in entry.files:
        target = directory / file.filename
        if target.is_file():
            total += target.stat().st_size
    return total
