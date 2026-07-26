import { formatBytes, type BookUsageInfo, type ChapterUsageInfo } from '@ln/shared';
import { canDeleteChapter, chapterProgressLabel } from './format';

/**
 * Một sách trong bảng dung lượng, mở ra được để xem từng chương.
 *
 * Chương chỉ tải khi user bấm mở (`storage:getChapterUsage`), không tải sẵn cho
 * mọi sách: một sách có 12–30 chương, mà thư viện có thể vài chục sách.
 */

export type StorageBookRowProps = {
  book: BookUsageInfo;
  expanded: boolean;
  /** Chương của sách này. Chỉ có nghĩa khi `expanded` */
  chapters: readonly ChapterUsageInfo[];
  busy: boolean;
  onToggle: () => void;
  onDeleteBook: () => void;
  onDeleteChapter: (chapter: ChapterUsageInfo) => void;
};

export const StorageBookRow = ({
  book,
  expanded,
  chapters,
  busy,
  onToggle,
  onDeleteBook,
  onDeleteChapter,
}: StorageBookRowProps): JSX.Element => {
  const hasAudio = book.audioBytes > 0;

  return (
    <li
      data-testid={`storage-book-${book.bookId}`}
      className="rounded-lg border border-border bg-bg-elevated"
    >
      <div className="flex items-center gap-3 p-3">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          {/* Mũi tên bằng ký tự chứ không phải icon: chưa có bộ icon nào trong
              project, thêm dependency cho một tam giác là không cần thiết. */}
          <span aria-hidden className="text-xs text-fg-muted">
            {expanded ? '▾' : '▸'}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm text-fg">{book.title}</span>
            <span className="block text-xs text-fg-muted">
              {book.completeChapters}/{book.chapterCount} chương đủ audio · sách{' '}
              {formatBytes(book.bookFileBytes)}
            </span>
          </span>
        </button>

        <span
          data-testid={`storage-book-bytes-${book.bookId}`}
          className="shrink-0 tabular-nums text-sm text-fg"
        >
          {formatBytes(book.audioBytes)}
        </span>

        <button
          type="button"
          onClick={onDeleteBook}
          disabled={busy || !hasAudio}
          data-testid={`storage-delete-book-${book.bookId}`}
          title={hasAudio ? 'Xoá toàn bộ audio của sách này' : 'Sách này chưa có audio'}
          className="shrink-0 rounded border border-border px-2 py-1 text-xs text-danger transition-colors hover:bg-bg-subtle disabled:cursor-not-allowed disabled:opacity-40"
        >
          Xoá audio
        </button>
      </div>

      {expanded && (
        <ul className="border-t border-border">
          {chapters.length === 0 ? (
            <li className="px-3 py-2 text-xs text-fg-muted">Đang tải danh sách chương…</li>
          ) : (
            chapters.map((chapter) => (
              <li
                key={chapter.chapterId}
                data-testid={`storage-chapter-${chapter.chapterId}`}
                className="flex items-center gap-3 px-3 py-1.5"
              >
                <span className="min-w-0 flex-1 truncate text-xs text-fg">{chapter.title}</span>
                <span className="shrink-0 text-xs text-fg-muted">
                  {chapterProgressLabel(chapter)}
                </span>
                <span className="w-20 shrink-0 text-right tabular-nums text-xs text-fg">
                  {formatBytes(chapter.audioBytes)}
                </span>
                <button
                  type="button"
                  onClick={() => onDeleteChapter(chapter)}
                  disabled={busy || !canDeleteChapter(chapter)}
                  data-testid={`storage-delete-chapter-${chapter.chapterId}`}
                  className="shrink-0 rounded px-1.5 py-0.5 text-xs text-danger transition-colors hover:bg-bg-subtle disabled:cursor-not-allowed disabled:opacity-30"
                >
                  Xoá
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </li>
  );
};
