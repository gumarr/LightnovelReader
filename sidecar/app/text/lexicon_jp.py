"""Từ điển phiên âm tên riêng Nhật (tầng 1) + ghép ba tầng thành một luật.

Ba tầng theo plan.md mục 8.1, xét theo thứ tự ưu tiên giảm dần:

1. **Override của user** — theo từng sách, thắng mọi thứ. Van an toàn, không
   phải nghĩa vụ: user chỉ mở khi nghe thấy chỗ nào chướng tai.
2. **Từ điển ship sẵn** — `data/lexicon_jp.json`, ~250 mục.
3. **Luật romaji** — `romaji_vi.py`, lo tên nhân vật mà từ điển không có.

Thứ tự này quan trọng: từ điển chốt cứng những chỗ luật ra kết quả kém
(`Tokyo` → `Tô-ki-ô` nghe quen hơn `Tô-kiô` mà luật sinh ra), còn luật phủ phần
đuôi vô hạn mà từ điển không kham nổi.
"""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path

from .mapping import NormalizedText, Replacement, apply_replacements, identity
from .romaji_vi import romaji_to_vi

_DATA_PATH = Path(__file__).parent / "data" / "lexicon_jp.json"

# Token có thể là tên riêng: chuỗi chữ cái Latin không dấu. Bắt cả `Onii-chan`
# (có gạch nối) vì đó là một đơn vị đọc, tách ra sẽ mất nhịp.
_TOKEN_PATTERN = re.compile(r"[A-Za-z]+(?:-[A-Za-z]+)*")


class LexiconError(RuntimeError):
    """Từ điển không đọc được hoặc sai định dạng."""


def _parse_entries(raw: object) -> dict[str, str]:
    """Dựng bảng tra từ JSON đã đọc. Tách khỏi I/O để test không cần file thật."""
    if not isinstance(raw, dict):
        raise LexiconError("Từ điển phải là một object JSON")

    entries = raw.get("entries")
    if not isinstance(entries, dict):
        raise LexiconError("Từ điển: thiếu object 'entries'")

    table: dict[str, str] = {}
    for key, value in entries.items():
        if not isinstance(key, str) or not isinstance(value, str):
            raise LexiconError(f"Từ điển: mục {key!r} phải là chuỗi → chuỗi")
        if not key or not value:
            raise LexiconError(f"Từ điển: mục {key!r} rỗng")
        # Chuẩn hoá khoá ngay lúc nạp: tra cứu về sau khỏi phải lower() mỗi lần.
        table[key.lower()] = value

    return table


@lru_cache(maxsize=1)
def load_lexicon() -> dict[str, str]:
    """Nạp từ điển ship sẵn. Cache vì file tĩnh và được tra hàng nghìn lần.

    Thiếu file thì trả bảng rỗng chứ không ném: mất từ điển nghĩa là rơi về
    tầng 2 (luật romaji) — vẫn đọc được, chỉ kém chuẩn hơn ở vài tên. Ném ở đây
    thì cả chương không generate được, tệ hơn hẳn.
    """
    if not _DATA_PATH.is_file():
        return {}

    try:
        raw = json.loads(_DATA_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise LexiconError(f"Không đọc được từ điển ở {_DATA_PATH}: {exc}") from exc

    return _parse_entries(raw)


def _match_case(source: str, replacement: str) -> str:
    """Cho bản đọc theo dạng chữ hoa/thường của từ gốc.

    Chỉ để log và debug nhìn cho thuận mắt — Piper không phân biệt hoa thường.
    Nhưng khi so text gốc với text đọc lúc tìm lỗi, khác nhau mỗi chữ hoa lại
    làm mất thời gian.
    """
    if source.isupper() and len(source) > 1:
        return replacement.upper()
    if source[:1].isupper():
        return replacement[:1].upper() + replacement[1:]
    return replacement


def lookup(
    token: str, overrides: dict[str, str] | None = None
) -> str | None:
    """Tra một token qua cả ba tầng. Trả `None` nếu không tầng nào nhận.

    `overrides` là bảng của user cho cuốn sách đang đọc — khoá viết thường.
    """
    lowered = token.lower()

    if overrides:
        # Tra cả khoá gốc lẫn khoá đã hạ chữ: main hạ chữ trước khi ghi DB,
        # nhưng sidecar là tiến trình HTTP riêng — ai gọi thẳng vào cũng gửi
        # được khoá viết hoa, và im lặng không khớp thì user tưởng app bỏ qua
        # mục họ vừa thêm.
        found = overrides.get(lowered) or overrides.get(token)
        if found:
            return _match_case(token, found)

    found = load_lexicon().get(lowered)
    if found:
        return _match_case(token, found)

    # Tầng 3 CHỈ áp cho token viết hoa.
    #
    # Không có ràng buộc này thì luật romaji nuốt luôn tiếng Việt không dấu:
    # `mua` → "mư-a", `nhin` → "nhin", `hieu` → … Đo thử trên 97 từ Việt thường
    # gặp thì 20 từ bị nuốt — phá chính ngôn ngữ đang đọc, tệ hơn hẳn việc bỏ
    # sót một tên Nhật.
    #
    # Tên riêng Nhật trong LN dịch **luôn** viết hoa, nên lọc theo chữ hoa gần
    # như không mất gì. Tên thường (`senpai`, `bentou`) đã nằm trong từ điển
    # tầng 2 rồi, không phụ thuộc tầng này.
    if not token[:1].isupper():
        return None

    # Luật romaji tự lo chữ hoa nên không gọi `_match_case`.
    return romaji_to_vi(token)


def transcribe_japanese(
    text: str, overrides: dict[str, str] | None = None
) -> NormalizedText:
    """Thay mọi tên riêng Nhật trong `text` bằng phiên âm Việt.

    Trả `NormalizedText` kèm bảng ánh xạ offset chứ không phải chuỗi: highlight
    của UI bám theo text **gốc**, nên phải có đường quy ngược. Xem `mapping.py`.

    Token có gạch nối (`Onii-chan`) được tra **nguyên cụm trước**; không khớp
    thì tra từng phần. Nhờ vậy `Onii-chan` có mục riêng vẫn thắng, mà
    `Tokyo-Osaka` vẫn phiên âm được cả hai vế.
    """
    if not text:
        return identity(text)

    replacements: list[Replacement] = []

    for match in _TOKEN_PATTERN.finditer(text):
        token = match.group(0)

        whole = lookup(token, overrides)
        if whole is not None:
            replacements.append(Replacement(match.start(), match.end(), whole))
            continue

        if "-" not in token:
            continue

        # Cụm gạch nối: tra từng phần, chỉ thay khi có ít nhất một phần khớp.
        parts = token.split("-")
        spoken_parts: list[str] = []
        any_hit = False
        for part in parts:
            found = lookup(part, overrides)
            if found is None:
                spoken_parts.append(part)
            else:
                spoken_parts.append(found)
                any_hit = True

        if any_hit:
            replacements.append(
                Replacement(match.start(), match.end(), "-".join(spoken_parts))
            )

    if not replacements:
        return identity(text)

    return apply_replacements(text, replacements)
