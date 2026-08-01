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

# Các loại file một voice có thể mang. `model`/`config` là của Piper; `asset` là
# file bất kỳ mà engine khác cần (VieNeu có 13 file: backbone, heads, tokenizer…).
FILE_KINDS = ("model", "config", "asset")

# Engine đã hỗ trợ. Thêm engine = thêm một dòng ở đây + một module trong
# `app/engines/`, không sửa chỗ khác.
ENGINE_PIPER = "piper"
ENGINE_VIENEU = "vieneu"
ENGINES = (ENGINE_PIPER, ENGINE_VIENEU)

# File **bắt buộc** của từng engine. Piper vô dụng nếu thiếu một trong hai;
# VieNeu dùng `asset` nên không ràng buộc theo `kind` mà theo đủ danh sách file.
#
# Kiểm ở tầng catalog thay vì lúc tải: catalog thiếu file thì voice tải xong vẫn
# không chạy được, mà lúc đó user đã chờ hết vài trăm MB.
REQUIRED_KINDS: dict[str, tuple[str, ...]] = {
    ENGINE_PIPER: ("model", "config"),
    ENGINE_VIENEU: (),
}

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
    # Tên file lưu xuống đĩa. Rỗng = lấy phần cuối của `path` (kiểu Piper).
    #
    # Vì sao cần: VieNeu nạp model bằng cách trỏ vào **một thư mục** và tự tìm
    # `config.json`, `tokenizer.json`… theo đúng tên. Hai repo HF của nó lại có
    # file trùng tên ở các thư mục khác nhau, nên trải phẳng hết vào một thư mục
    # sẽ đè lên nhau. `saveAs` cho catalog nói rõ từng file nằm ở đâu.
    save_as: str = ""

    @property
    def filename(self) -> str:
        """Đường dẫn tương đối trong thư mục voice (có thể chứa `/`)."""
        if self.save_as:
            return self.save_as
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
    # Engine chạy voice này. Mặc định `piper` để catalog cũ (không có trường
    # này) vẫn đọc được — quan trọng vì user nâng cấp app giữ nguyên voice đã cài.
    engine: str = ENGINE_PIPER
    # Gốc URL riêng của voice. Rỗng = dùng `Catalog.base_url` chung.
    #
    # Vì sao cần: voice Piper cùng nằm ở `rhasspy/piper-voices`, nhưng VieNeu lấy
    # từ **hai** repo HF khác nhau (model và tokenizer MOSS). Một `baseUrl` chung
    # cho cả catalog không còn đủ.
    base_url: str = ""
    # Giọng preset trong model dùng chung. VieNeu tải **một** bộ model rồi chọn
    # giọng bằng tên (14 giọng), khác Piper mỗi giọng một file 63 MB.
    #
    # Rỗng = voice độc lập (Piper). Có giá trị = engine nạp `model_id` rồi truyền
    # tên này vào lúc tổng hợp.
    preset_voice: str = ""
    # `id` của voice mang bộ model dùng chung. Rỗng = voice tự mang model.
    model_id: str = ""

    @property
    def total_bytes(self) -> int:
        return sum(f.size_bytes for f in self.files)

    @property
    def is_shared_model(self) -> bool:
        """Voice này dùng model của voice khác (`model_id`) chứ không tự mang."""
        return bool(self.model_id)


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

    save_as = raw.get("saveAs", "")
    if not isinstance(save_as, str):
        raise CatalogError(f"{where}: saveAs phải là chuỗi")
    # `saveAs` ghép thẳng vào đường dẫn ghi đĩa nên phải chặn thoát thư mục y
    # như `path` — đây là dữ liệu từ file, không phải hằng số trong code.
    if save_as and (
        ".." in save_as
        or save_as.startswith("/")
        or save_as.startswith("\\")
        or ":" in save_as
    ):
        raise CatalogError(f"{where}: saveAs {save_as!r} không phải đường dẫn tương đối an toàn")

    return VoiceFile(
        kind=kind,
        path=path,
        size_bytes=_require_int(raw, "sizeBytes", where),
        sha256=sha256,
        save_as=save_as,
    )


def _parse_voice(raw: object, index: int) -> VoiceEntry:
    where = f"voices[{index}]"
    if not isinstance(raw, dict):
        raise CatalogError(f"{where}: mỗi voice phải là object")

    voice_id = _require_str(raw, "id", where)
    if not is_safe_voice_id(voice_id):
        raise CatalogError(f"{where}: id {voice_id!r} chứa ký tự không dùng làm tên thư mục được")

    engine = raw.get("engine", ENGINE_PIPER)
    if not isinstance(engine, str) or engine not in ENGINES:
        raise CatalogError(f"{where}: engine {engine!r} không hợp lệ, phải là một trong {list(ENGINES)}")

    model_id = raw.get("modelId", "")
    if not isinstance(model_id, str):
        raise CatalogError(f"{where}: modelId phải là chuỗi")
    if model_id and not is_safe_voice_id(model_id):
        raise CatalogError(f"{where}: modelId {model_id!r} không hợp lệ")

    preset_voice = raw.get("presetVoice", "")
    if not isinstance(preset_voice, str):
        raise CatalogError(f"{where}: presetVoice phải là chuỗi")

    raw_files = raw.get("files")
    # Voice dùng model chung (`modelId`) **không** mang file riêng — nó chỉ là
    # một cái tên giọng trong bộ model đã tải. Bắt buộc có `files` ở đây sẽ đẩy
    # tới chỗ phải khai trùng 13 file cho cả 14 giọng.
    if model_id:
        if raw_files:
            raise CatalogError(f"{where}: voice dùng modelId thì không được khai files riêng")
        files: tuple[VoiceFile, ...] = ()
    else:
        if not isinstance(raw_files, list) or not raw_files:
            raise CatalogError(f"{where}: thiếu danh sách files")
        files = tuple(_parse_file(f, f"{where}.files[{i}]") for i, f in enumerate(raw_files))

        kinds = {f.kind for f in files}
        missing = set(REQUIRED_KINDS[engine]) - kinds
        if missing:
            # Bắt ở đây thay vì lúc tải: catalog thiếu config thì voice tải xong
            # vẫn không dùng được, mà lúc đó user đã chờ hết 63 MB.
            raise CatalogError(f"{where}: thiếu file loại {sorted(missing)}")

    base_url = raw.get("baseUrl", "")
    if not isinstance(base_url, str):
        raise CatalogError(f"{where}: baseUrl phải là chuỗi")
    if base_url and not base_url.startswith("https://"):
        raise CatalogError(f"{where}: baseUrl phải dùng https, nhận {base_url!r}")

    return VoiceEntry(
        id=voice_id,
        lang=_require_str(raw, "lang", where),
        name=_require_str(raw, "name", where),
        quality=_require_str(raw, "quality", where),
        sample_rate=_require_int(raw, "sampleRate", where),
        license=str(raw.get("license", "")),
        files=files,
        engine=engine,
        base_url=base_url,
        preset_voice=preset_voice,
        model_id=model_id,
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

    # `modelId` phải trỏ tới voice có thật và voice đó phải tự mang file. Kiểm
    # ở đây vì đọc catalog là lúc **duy nhất** thấy được toàn bộ danh sách; để
    # tới lúc nạp model thì lỗi hiện ra dưới dạng "không thấy thư mục", xa hẳn
    # chỗ khai sai.
    by_id = {v.id: v for v in voices}
    for voice in voices:
        if not voice.model_id:
            continue
        provider = by_id.get(voice.model_id)
        if provider is None:
            raise CatalogError(
                f"voice {voice.id!r}: modelId {voice.model_id!r} không có trong catalog"
            )
        if provider.is_shared_model:
            raise CatalogError(
                f"voice {voice.id!r}: modelId trỏ tới {provider.id!r} mà voice đó cũng dùng model chung"
            )
        if provider.engine != voice.engine:
            raise CatalogError(
                f"voice {voice.id!r}: modelId trỏ tới voice khác engine ({provider.engine})"
            )

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

    Voice dùng model chung không có file riêng, nên nơi gọi phải quy về voice
    mang model trước (`resolve_model_entry`) — gọi thẳng vào đây với `files`
    rỗng sẽ luôn trả `True`, tức "đã cài" cho thứ chưa tải gì.
    """
    if entry.is_shared_model:
        raise CatalogError(
            f"voice {entry.id!r} dùng model chung — phải quy qua resolve_model_entry() trước"
        )
    directory = voice_dir(models_dir, entry.id)
    for file in entry.files:
        target = directory / file.filename
        if not target.is_file() or target.stat().st_size != file.size_bytes:
            return False
    return True


def resolve_model_entry(catalog: Catalog, entry: VoiceEntry) -> VoiceEntry:
    """Quy một voice về voice **mang file model** của nó.

    Voice thường trả về chính nó. Voice dùng model chung (14 giọng VieNeu) trả
    về voice mang bộ model 244 MB. `parse_catalog` đã bảo đảm `modelId` trỏ
    đúng, nên tới đây không cần đoán.
    """
    if not entry.is_shared_model:
        return entry
    provider = catalog.find(entry.model_id)
    if provider is None:  # pragma: no cover — parse_catalog đã chặn
        raise CatalogError(f"voice {entry.id!r}: không tìm thấy modelId {entry.model_id!r}")
    return provider


def installed_size(models_dir: Path, entry: VoiceEntry) -> int:
    if entry.is_shared_model:
        # Giọng dùng model chung không chiếm thêm đĩa — quy hết dung lượng về
        # bộ model sẽ đếm 14 lần cùng một 244 MB trong màn Dung lượng.
        return 0
    directory = voice_dir(models_dir, entry.id)
    total = 0
    for file in entry.files:
        target = directory / file.filename
        if target.is_file():
            total += target.stat().st_size
    return total


def voice_base_url(catalog: Catalog, entry: VoiceEntry) -> str:
    """Gốc URL tải của một voice — riêng nếu có, không thì lấy chung của catalog."""
    return entry.base_url or catalog.base_url
