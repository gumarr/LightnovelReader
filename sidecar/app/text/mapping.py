"""Ánh xạ offset giữa text **gốc** và text **đã chuẩn hoá**.

Vì sao cần: TTS đọc bản đã chuẩn hoá (`"2024"` → `"hai nghìn không trăm hai mươi
tư"`, `"Shinkansen"` → `"Shin-can-xen"`), nên mốc thời gian sinh ra bám theo bản
đó. Nhưng UI tô chữ trên bản **gốc** — thứ user đang nhìn. Không có bảng ánh xạ
thì `charStart`/`charEnd` trỏ sai chỗ ngay khi có một chữ số.

Với số thì lệch hiếm và nhẹ. Với LN thì tên riêng Nhật xuất hiện ở **mọi trang**
(xem plan.md mục 8.1), nên sai lệch thành liên tục — đó là lý do P3.5 phải trả
nợ này trước khi P3.4 dựng subtitle pane.

Mô hình: text là chuỗi **đoạn** (`Span`) nối tiếp nhau, mỗi đoạn biết mình chiếm
khoảng nào ở bản gốc và khoảng nào ở bản đọc. Đoạn không đổi thì hai khoảng dài
bằng nhau; đoạn bị thay thì không.
"""

from __future__ import annotations

import bisect
import difflib
from dataclasses import dataclass


@dataclass(frozen=True)
class Span:
    """Một đoạn text, kèm vị trí ở **cả hai** bản.

    Nửa mở ở cả hai phía: `[start, end)`. `replaced=False` nghĩa là đoạn đi
    thẳng từ gốc sang bản đọc không đổi một ký tự nào — khi đó độ dài hai bên
    bằng nhau và ánh xạ trong đoạn là cộng thêm hằng số.
    """

    source_start: int
    source_end: int
    spoken_start: int
    spoken_end: int
    replaced: bool

    @property
    def source_length(self) -> int:
        return self.source_end - self.source_start

    @property
    def spoken_length(self) -> int:
        return self.spoken_end - self.spoken_start


@dataclass(frozen=True)
class NormalizedText:
    """Kết quả chuẩn hoá: text để đọc + đường về text gốc.

    `source` giữ nguyên bản gốc chứ không chỉ giữ độ dài: nơi gọi cần cắt chuỗi
    con theo offset đã quy ngược, mà truyền kèm text gốc qua nhiều tầng thì sớm
    muộn cũng có chỗ truyền nhầm bản.
    """

    source: str
    spoken: str
    spans: tuple[Span, ...]

    def to_source_range(self, spoken_start: int, spoken_end: int) -> tuple[int, int]:
        """Quy một khoảng ở bản đọc về khoảng tương ứng ở bản gốc."""
        return to_source_range(self.spans, spoken_start, spoken_end)


def identity(text: str) -> NormalizedText:
    """Bản chuẩn hoá "không đổi gì" — dùng khi không có luật nào khớp.

    Vẫn trả một `Span` thay vì `spans=()` để mọi nơi gọi đi chung một đường,
    khỏi phải viết nhánh riêng cho ca rỗng.
    """
    if not text:
        return NormalizedText(source=text, spoken=text, spans=())
    span = Span(
        source_start=0,
        source_end=len(text),
        spoken_start=0,
        spoken_end=len(text),
        replaced=False,
    )
    return NormalizedText(source=text, spoken=text, spans=(span,))


@dataclass(frozen=True)
class Replacement:
    """Một chỗ thay thế: `[start, end)` ở bản gốc đọc thành `spoken`."""

    start: int
    end: int
    spoken: str


def apply_replacements(text: str, replacements: list[Replacement]) -> NormalizedText:
    """Áp danh sách thay thế lên `text`, dựng luôn bảng ánh xạ.

    Thay thế được sắp xếp theo vị trí và **không được chồng lấn** — chồng lấn
    nghĩa là hai luật cùng đòi sửa một chỗ, mà đoán bừa luật nào thắng sẽ sinh
    ra kết quả phụ thuộc thứ tự duyệt. Ca đó bỏ luật đến sau.
    """
    if not text:
        return identity(text)

    ordered = sorted(replacements, key=lambda r: (r.start, r.end))

    parts: list[str] = []
    spans: list[Span] = []
    source_cursor = 0
    spoken_cursor = 0

    for item in ordered:
        # Bỏ luật chồng lên đoạn đã thay: giữ luật đến trước.
        if item.start < source_cursor or item.end > len(text) or item.start >= item.end:
            continue

        # Đoạn không đổi nằm giữa hai chỗ thay.
        if item.start > source_cursor:
            length = item.start - source_cursor
            spans.append(
                Span(
                    source_start=source_cursor,
                    source_end=item.start,
                    spoken_start=spoken_cursor,
                    spoken_end=spoken_cursor + length,
                    replaced=False,
                )
            )
            parts.append(text[source_cursor : item.start])
            spoken_cursor += length

        spans.append(
            Span(
                source_start=item.start,
                source_end=item.end,
                spoken_start=spoken_cursor,
                spoken_end=spoken_cursor + len(item.spoken),
                replaced=True,
            )
        )
        parts.append(item.spoken)
        spoken_cursor += len(item.spoken)
        source_cursor = item.end

    if source_cursor < len(text):
        length = len(text) - source_cursor
        spans.append(
            Span(
                source_start=source_cursor,
                source_end=len(text),
                spoken_start=spoken_cursor,
                spoken_end=spoken_cursor + length,
                replaced=False,
            )
        )
        parts.append(text[source_cursor:])

    return NormalizedText(source=text, spoken="".join(parts), spans=tuple(spans))


def diff_to_normalized(source: str, spoken: str) -> NormalizedText:
    """Suy bảng ánh xạ bằng cách **so** chuỗi vào với chuỗi ra.

    Vì sao cần: các luật chuẩn hoá đều là `str -> str` viết bằng regex, không
    tự khai báo được mình đã đổi khoảng nào. Viết lại cả tám hàm để chúng trả
    span là việc lớn và dễ sai; so chuỗi thì đúng tự động, kể cả với luật thêm
    về sau.

    Dùng `difflib.SequenceMatcher` — cùng thuật toán `diff` của Python, đủ
    nhanh ở cỡ segment (≤ 300 ký tự theo CLAUDE.md).

    Đoạn `equal` thành span không đổi (ánh xạ chính xác từng ký tự), còn
    `replace`/`delete`/`insert` thành span đã thay (mốc bung ra tới biên).
    """
    if source == spoken:
        return identity(source)
    if not source or not spoken:
        # Một bên rỗng thì không có gì để khớp — cả chuỗi là một đoạn đã thay.
        span = Span(
            source_start=0,
            source_end=len(source),
            spoken_start=0,
            spoken_end=len(spoken),
            replaced=True,
        )
        return NormalizedText(source=source, spoken=spoken, spans=(span,))

    matcher = difflib.SequenceMatcher(None, source, spoken, autojunk=False)

    spans: list[Span] = []
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if i1 == i2 and j1 == j2:
            continue
        spans.append(
            Span(
                source_start=i1,
                source_end=i2,
                spoken_start=j1,
                spoken_end=j2,
                replaced=tag != "equal",
            )
        )

    if not spans:
        return identity(source)

    return NormalizedText(source=source, spoken=spoken, spans=tuple(spans))


def compose(first: NormalizedText, second: NormalizedText) -> NormalizedText:
    """Nối hai lượt chuẩn hoá: `second` chạy trên `first.spoken`.

    Pipeline có nhiều luật chạy nối tiếp, mỗi luật sinh bảng ánh xạ riêng. Nối
    lại để có đúng **một** bảng đi từ text gốc ban đầu tới text đọc cuối cùng —
    nếu không, nơi gọi phải giữ cả xâu bảng và tự quy ngược từng chặng.
    """
    if not first.spans:
        # `first` không đổi gì (hoặc rỗng) → kết quả chính là `second`, nhưng
        # phải mang `source` của `first` để đường về không đứt một mắt xích.
        return NormalizedText(source=first.source, spoken=second.spoken, spans=second.spans)
    if not second.spans:
        return NormalizedText(source=first.source, spoken=second.spoken, spans=first.spans)

    # Cắt theo ranh giới của CẢ HAI lượt, không lấy riêng bộ nào.
    #
    # Chỉ giữ ranh giới của `second` là sai: khi lượt 2 không thay gì, nó chỉ có
    # một span phủ cả chuỗi, và span đó chạm chỗ lượt 1 đã thay nên bị đánh
    # `replaced` → mọi mốc bung ra toàn chuỗi, mất sạch độ chính xác lượt 1 có.
    # Ngược lại, chỉ giữ ranh giới `first` thì mất chỗ lượt 2 vừa thay.
    #
    # Ranh giới ở đây tính trên **trục `spoken` của lượt 1** = trục `source` của
    # lượt 2 — trục chung duy nhất của hai lượt.
    boundaries = {0, len(first.spoken)}
    for span in first.spans:
        boundaries.add(span.spoken_start)
        boundaries.add(span.spoken_end)
    for span in second.spans:
        boundaries.add(span.source_start)
        boundaries.add(span.source_end)

    cuts = sorted(b for b in boundaries if 0 <= b <= len(first.spoken))

    spans: list[Span] = []
    for mid_start, mid_end in zip(cuts, cuts[1:], strict=False):
        if mid_start >= mid_end:
            continue

        source_start, source_end = to_source_range(first.spans, mid_start, mid_end)
        spoken_start, spoken_end = to_source_range_forward(second.spans, mid_start, mid_end)

        first_replaced = _range_touches_replacement(first.spans, mid_start, mid_end)
        second_replaced = _range_touches_replacement_source(second.spans, mid_start, mid_end)

        spans.append(
            Span(
                source_start=source_start,
                source_end=source_end,
                spoken_start=spoken_start,
                spoken_end=spoken_end,
                # `replaced` lan truyền: đoạn bị lượt nào thay thì ở bảng gộp
                # vẫn phải mang cờ, nếu không nơi gọi tưởng nó ánh xạ tuyến tính.
                replaced=first_replaced or second_replaced,
            )
        )

    if not spans:
        return NormalizedText(source=first.source, spoken=second.spoken, spans=second.spans)

    return NormalizedText(source=first.source, spoken=second.spoken, spans=tuple(spans))


def to_source_range_forward(
    spans: tuple[Span, ...], source_start: int, source_end: int
) -> tuple[int, int]:
    """Chiều ngược của `to_source_range`: từ trục `source` sang trục `spoken`.

    `compose` cần cả hai chiều — quy về gốc thì đi lùi qua `first`, còn xác định
    đoạn tương ứng ở bản đọc cuối thì đi tới qua `second`.
    """
    flipped = tuple(
        Span(
            source_start=span.spoken_start,
            source_end=span.spoken_end,
            spoken_start=span.source_start,
            spoken_end=span.source_end,
            replaced=span.replaced,
        )
        for span in spans
    )
    return to_source_range(flipped, source_start, source_end)


def _range_touches_replacement(spans: tuple[Span, ...], start: int, end: int) -> bool:
    """Khoảng `[start, end)` trên trục **spoken** có chạm đoạn đã bị thay không."""
    return any(
        span.replaced and span.spoken_start < max(end, start + 1) and span.spoken_end > start
        for span in spans
    )


def _range_touches_replacement_source(
    spans: tuple[Span, ...], start: int, end: int
) -> bool:
    """Như trên nhưng xét trên trục **source** của bộ span."""
    return any(
        span.replaced and span.source_start < max(end, start + 1) and span.source_end > start
        for span in spans
    )


def to_source_range(
    spans: tuple[Span, ...], spoken_start: int, spoken_end: int
) -> tuple[int, int]:
    """Quy khoảng `[spoken_start, spoken_end)` về khoảng ở text gốc.

    Quy tắc **nới rộng ra ngoài**: khoảng ở bản gốc phải phủ trọn mọi đoạn mà
    khoảng đọc chạm tới. Một từ đọc (`"Shin"` trong `"Shin-can-xen"`) chỉ là một
    mảnh của từ gốc (`"Shinkansen"`), mà tô nửa từ thì nhìn như lỗi hiển thị —
    nên cả từ gốc sáng lên cùng lúc.

    Trong đoạn **không** bị thay thì ánh xạ chính xác từng ký tự, vì hai bên
    dài bằng nhau.
    """
    if not spans:
        return (spoken_start, spoken_end)

    if spoken_end < spoken_start:
        spoken_start, spoken_end = spoken_end, spoken_start

    starts = [span.spoken_start for span in spans]

    # Đoạn chứa `spoken_start`: đoạn cuối cùng bắt đầu tại hoặc trước nó.
    begin_index = max(0, bisect.bisect_right(starts, spoken_start) - 1)
    # Khoảng rỗng chạm đúng ranh giới hai đoạn thì lấy đoạn bên trái.
    end_probe = spoken_end - 1 if spoken_end > spoken_start else spoken_start
    end_index = max(0, bisect.bisect_right(starts, end_probe) - 1)

    begin = spans[begin_index]
    finish = spans[end_index]

    source_start = _map_point(begin, spoken_start, at_end=False)
    source_end = _map_point(finish, spoken_end, at_end=True)

    if source_end < source_start:
        source_end = source_start
    return (source_start, source_end)


def _map_point(span: Span, spoken_pos: int, *, at_end: bool) -> int:
    """Quy một mốc ở bản đọc về mốc ở bản gốc, trong phạm vi một đoạn.

    Đoạn đã bị thay không có tương ứng từng ký tự (`"2024"` 4 ký tự thành 34 ký
    tự chữ), nên mọi mốc bên trong đều bung ra tới **biên** của đoạn: mốc đầu về
    đầu đoạn, mốc cuối về cuối đoạn. Nội suy tỉ lệ ở đây sẽ cắt `"Shinkansen"`
    thành những mảnh vô nghĩa như `"Shink"`.
    """
    if span.replaced:
        return span.source_end if at_end else span.source_start

    offset = spoken_pos - span.spoken_start
    # Kẹp trong đoạn: mốc có thể rơi ngoài khi khoảng đọc vượt quá đoạn cuối.
    offset = max(0, min(offset, span.source_length))
    return span.source_start + offset
