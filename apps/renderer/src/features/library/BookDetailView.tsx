import type { BookDetail } from '@ln/shared';
import { rangeLabel } from '@/features/import/confidence';
import { formatLabel } from './format';

/**
 * Màn chi tiết sách: danh sách chương, chỉ ra chương đang đọc dở.
 *
 * P1.6c thay phần bên phải bằng viewer thật; hiện tại mới là mục lục.
 */

export type BookDetailViewProps = {
  detail: BookDetail;
  onBack: () => void;
};

export const BookDetailView = ({ detail, onBack }: BookDetailViewProps): JSX.Element => {
  const { book, chapters, resumeChapterId } = detail;

  // DOCX không có trang giấy — `pageStart` khi đó là chỉ số đoạn văn
  const hasRealPages = book.format !== 'docx';
  const totalSegments = chapters.reduce((sum, c) => sum + c.segmentCount, 0);

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          className="rounded px-2 py-1 text-sm text-fg-muted transition-colors hover:bg-bg-subtle hover:text-fg"
        >
          ← Thư viện
        </button>

        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold text-fg">{book.title}</h1>
          <p className="text-xs text-fg-muted">
            {formatLabel(book.format)} · {chapters.length} chương · {totalSegments} segment
          </p>
        </div>
      </header>

      {chapters.length === 0 ? (
        <p className="p-8 text-center text-fg-muted">Sách này chưa có chương nào.</p>
      ) : (
        <ol className="flex-1 space-y-1 overflow-y-auto px-4 pb-4">
          {chapters.map((chapter) => {
            const isResume = chapter.id === resumeChapterId;

            return (
              <li
                key={chapter.id}
                data-testid="chapter-item"
                data-resume={isResume}
                className={`flex items-center gap-3 rounded border px-3 py-2 ${
                  isResume ? 'border-accent bg-accent/5' : 'border-border bg-bg-elevated'
                }`}
              >
                <span className="w-6 shrink-0 text-right text-sm tabular-nums text-fg-muted">
                  {chapter.index + 1}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-fg">{chapter.title}</span>
                  <span className="text-xs text-fg-muted">
                    {chapter.pageStart !== undefined && chapter.pageEnd !== undefined
                      ? `${rangeLabel(chapter.pageStart, chapter.pageEnd, hasRealPages)} · `
                      : ''}
                    {chapter.segmentCount} segment
                  </span>
                </span>

                {isResume ? (
                  <span className="shrink-0 rounded bg-accent/10 px-2 py-0.5 text-xs text-accent">
                    Đang đọc
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}

      <footer className="shrink-0 border-t border-border px-4 py-2 text-xs text-fg-muted">
        Trình đọc và phát audio thuộc P1.6c / Phase 2 — chưa nối vào đây.
      </footer>
    </div>
  );
};
