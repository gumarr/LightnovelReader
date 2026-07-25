"""Chuẩn hoá text theo ngôn ngữ trước khi đưa vào TTS."""

from __future__ import annotations

from collections.abc import Callable

from .normalize_en import normalize_en
from .normalize_vi import normalize_vi

Normalizer = Callable[[str], str]

# Khớp với `BookLang` ở packages/shared/src/types.ts. Thêm ngôn ngữ = thêm
# một dòng ở đây + một module, không sửa chỗ gọi.
NORMALIZERS: dict[str, Normalizer] = {
    "vi": normalize_vi,
    "en": normalize_en,
}

DEFAULT_LANG = "vi"


def normalize(text: str, lang: str) -> str:
    """Chuẩn hoá theo ngôn ngữ.

    Ngôn ngữ lạ thì rơi về VI thay vì ném lỗi: sách vẫn đọc được (chỉ là số
    đọc theo kiểu Việt), còn ném lỗi thì cả chương không generate được.
    """
    normalizer = NORMALIZERS.get(lang.lower(), NORMALIZERS[DEFAULT_LANG])
    return normalizer(text)


__all__ = ["NORMALIZERS", "DEFAULT_LANG", "Normalizer", "normalize", "normalize_en", "normalize_vi"]
