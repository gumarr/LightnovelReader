"""Chuẩn hoá text theo ngôn ngữ trước khi đưa vào TTS."""

from __future__ import annotations

from collections.abc import Callable

from .mapping import NormalizedText, diff_to_normalized, identity
from .normalize_en import normalize_en
from .normalize_vi import normalize_vi, normalize_vi_mapped

Normalizer = Callable[[str], str]
MappedNormalizer = Callable[[str, dict[str, str] | None], NormalizedText]

# Khớp với `BookLang` ở packages/shared/src/types.ts. Thêm ngôn ngữ = thêm
# một dòng ở đây + một module, không sửa chỗ gọi.
NORMALIZERS: dict[str, Normalizer] = {
    "vi": normalize_vi,
    "en": normalize_en,
}


def _normalize_en_mapped(
    text: str,
    overrides: dict[str, str] | None = None,  # noqa: ARG001 — giữ cho khớp chữ ký
) -> NormalizedText:
    """Bản có mapping cho EN.

    EN chưa có luật riêng nào cần ánh xạ chính xác (không phiên âm tên Nhật —
    voice EN đọc romaji vốn đã ổn), nên suy ngược bằng diff là đủ.

    `overrides` nhận nhưng không dùng: nó là bảng phiên âm Nhật→Việt, vô nghĩa
    với voice EN. Vẫn phải có trong chữ ký để `MAPPED_NORMALIZERS` đồng nhất.
    """
    return diff_to_normalized(text, normalize_en(text))


MAPPED_NORMALIZERS: dict[str, MappedNormalizer] = {
    "vi": normalize_vi_mapped,
    "en": _normalize_en_mapped,
}

DEFAULT_LANG = "vi"


def normalize(text: str, lang: str) -> str:
    """Chuẩn hoá theo ngôn ngữ.

    Ngôn ngữ lạ thì rơi về VI thay vì ném lỗi: sách vẫn đọc được (chỉ là số
    đọc theo kiểu Việt), còn ném lỗi thì cả chương không generate được.
    """
    normalizer = NORMALIZERS.get(lang.lower(), NORMALIZERS[DEFAULT_LANG])
    return normalizer(text)


def normalize_mapped(
    text: str, lang: str, overrides: dict[str, str] | None = None
) -> NormalizedText:
    """Như `normalize` nhưng trả kèm đường quy offset về text gốc.

    Nơi gọi cần cái này thay vì `normalize` khi kết quả sẽ sinh ra mốc thời
    gian: timing bám theo text đã chuẩn hoá, mà UI tô chữ trên text gốc — không
    có mapping thì `charStart`/`charEnd` trỏ sai chỗ. Xem plan.md mục 8.1.
    """
    if not text:
        return identity(text)
    normalizer = MAPPED_NORMALIZERS.get(lang.lower(), MAPPED_NORMALIZERS[DEFAULT_LANG])
    return normalizer(text, overrides)


__all__ = [
    "NORMALIZERS",
    "MAPPED_NORMALIZERS",
    "DEFAULT_LANG",
    "Normalizer",
    "MappedNormalizer",
    "NormalizedText",
    "normalize",
    "normalize_mapped",
    "normalize_en",
    "normalize_vi",
    "normalize_vi_mapped",
]
