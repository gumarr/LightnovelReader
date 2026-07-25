import type { LibraryEntry } from '@ln/shared';
import { coverInitials, coverShade, formatLabel, relativeTime } from './format';

export type BookCardProps = {
  entry: LibraryEntry;
  /** Mốc thời gian dùng để tính "đọc lúc nào" — truyền vào để test khoá được */
  now: number;
  onOpen: () => void;
  onRemove: () => void;
};

export const BookCard = ({ entry, now, onOpen, onRemove }: BookCardProps): JSX.Element => {
  const { book, chapterCount, segmentCount } = entry;

  return (
    <li
      data-testid="book-card"
      data-book-id={book.id}
      className="group relative flex flex-col overflow-hidden rounded-lg border border-border bg-bg-elevated transition-colors hover:border-accent"
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Mở ${book.title}`}
        // Số segment không lên mặt thẻ (150px không đủ chỗ) nhưng vẫn cần tra
        // được — nó là thứ quyết định dung lượng audio ở Phase 2
        title={`${book.title}\n${chapterCount} chương · ${segmentCount} segment`}
        className="flex flex-1 flex-col text-left"
      >
        <span
          aria-hidden="true"
          className="flex aspect-[3/4] w-full items-center justify-center text-3xl font-semibold text-accent"
          // Sắc độ suy từ tên sách để phân biệt bằng mắt. Dùng độ mờ của
          // `--accent` chồng lên nền nên vẫn đúng ở cả dark lẫn light.
          // Biến lưu kênh RGB rời nên phải bọc `rgb(...)`.
          style={{ backgroundColor: `rgb(var(--accent) / ${coverShade(book.title)})` }}
        >
          {coverInitials(book.title)}
        </span>

        <span className="flex flex-1 flex-col gap-1 p-2.5">
          <span className="line-clamp-2 break-words text-sm font-medium leading-snug text-fg">
            {book.title}
          </span>

          {/* Một dòng duy nhất: thẻ hẹp 150px không đủ chỗ cho "N chương · M segment" */}
          <span className="mt-auto flex items-center gap-1.5 text-xs text-fg-muted">
            <span className="shrink-0 rounded bg-bg-subtle px-1 py-0.5">
              {formatLabel(book.format)}
            </span>
            <span className="truncate">{chapterCount} chương</span>
          </span>

          <span className="truncate text-xs text-fg-muted">
            {relativeTime(book.lastOpenedAt, now)}
          </span>
        </span>
      </button>

      <button
        type="button"
        onClick={onRemove}
        aria-label={`Xoá ${book.title}`}
        title="Xoá khỏi thư viện"
        className="absolute right-1.5 top-1.5 rounded bg-bg/80 px-1.5 py-0.5 text-xs text-fg-muted opacity-0 transition-opacity hover:text-danger focus:opacity-100 group-hover:opacity-100"
      >
        Xoá
      </button>
    </li>
  );
};
