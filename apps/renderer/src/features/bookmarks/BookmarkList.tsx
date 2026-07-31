import { useBookmarkStore } from '@/stores/bookmark-store';

/**
 * Danh sách dấu trang của sách đang mở (P5.4).
 *
 * Xếp theo **mạch đọc** (main lo phần này) chứ không theo lúc tạo: user tìm dấu
 * trang bằng cách nhớ "khoảng giữa sách", không phải nhớ mình đặt nó hôm nào.
 *
 * Bấm một hàng thì **nhảy tới đoạn đó**, và nếu đoạn thuộc chương khác thì phải
 * đổi chương trước — việc đó do `onSelect` ở `ReaderScreen` lo, vì chỉ nơi đó
 * biết chương nào đang mở.
 */

export type BookmarkListProps = {
  /** Nhảy tới đoạn. Nhận cả `chapterIndex` để nơi gọi biết có phải đổi chương không */
  onSelect: (segmentId: string, chapterIndex: number) => void;
};

export const BookmarkList = ({ onSelect }: BookmarkListProps): JSX.Element => {
  const entries = useBookmarkStore((s) => s.entries);
  const loading = useBookmarkStore((s) => s.loading);

  if (loading && entries.length === 0) {
    return <p className="p-3 text-xs text-fg-muted">Đang tải dấu trang…</p>;
  }

  if (entries.length === 0) {
    return (
      <p data-testid="bookmark-empty" className="p-3 text-xs text-fg-muted">
        Chưa có dấu trang nào. Chọn một đoạn rồi bấm “Đánh dấu”.
      </p>
    );
  }

  return (
    <ul data-testid="bookmark-list" className="divide-y divide-border">
      {entries.map((entry) => (
        <li key={entry.bookmark.id}>
          <button
            type="button"
            data-testid="bookmark-item"
            onClick={() => onSelect(entry.bookmark.segmentId, entry.chapterIndex)}
            className="block w-full px-3 py-2 text-left transition-colors hover:bg-bg-subtle"
          >
            <p className="truncate text-xs font-medium text-fg">{entry.chapterTitle}</p>

            {/*
              Ghi chú của user đứng TRƯỚC trích đoạn: đó là thứ họ tự viết ra để
              nhận lại chỗ này, đáng thấy trước nội dung máy cắt sẵn.
            */}
            {entry.bookmark.note === undefined ? null : (
              <p className="mt-0.5 line-clamp-2 text-xs text-accent">{entry.bookmark.note}</p>
            )}

            <p className="mt-0.5 line-clamp-2 text-xs text-fg-muted">{entry.excerpt}</p>
          </button>
        </li>
      ))}
    </ul>
  );
};
