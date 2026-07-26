import { useEffect } from 'react';
import { formatBytes, type BookDetail } from '@ln/shared';
import { rangeLabel } from '@/features/import/confidence';
import { GenerateControls } from '@/features/generate/GenerateControls';
import { useQueueStore } from '@/stores/queue-store';
import { useSettingsStore } from '@/stores/settings-store';
import { formatLabel } from './format';

/**
 * Màn chi tiết sách: mục lục chương, chỉ ra chương đang đọc dở.
 *
 * Bấm một chương là mở trình đọc (`ReaderScreen`).
 */

export type BookDetailViewProps = {
  detail: BookDetail;
  onBack: () => void;
  /**
   * Mở trình đọc. Gọi không kèm chương = mở chỗ đọc dở.
   * Vắng mặt thì mục lục chỉ để xem — dùng khi chưa nối trình đọc.
   */
  onRead?: (chapterId?: string) => void;
};

export const BookDetailView = ({ detail, onBack, onRead }: BookDetailViewProps): JSX.Element => {
  const { book, chapters, resumeChapterId } = detail;

  const loadQueueStatus = useQueueStore((s) => s.loadStatus);
  const applyQueueStatus = useQueueStore((s) => s.applyStatus);

  // Giọng theo ngôn ngữ sách — rỗng thì hàng đợi dừng ngay (xem PROGRESS 4.36)
  const voiceReady = useSettingsStore(
    (s) => ((book.lang === 'vi' ? s.settings?.voiceVi : s.settings?.voiceEn) ?? '') !== '',
  );

  useEffect(() => {
    void loadQueueStatus();
    return window.api.queue.onStatusChanged(applyQueueStatus);
  }, [loadQueueStatus, applyQueueStatus]);

  // DOCX không có trang giấy — `pageStart` khi đó là chỉ số đoạn văn
  const hasRealPages = book.format !== 'docx';
  const totalSegments = chapters.reduce((sum, c) => sum + c.segmentCount, 0);
  const audioBytes = chapters.reduce((sum, c) => sum + c.audioBytes, 0);

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
            {audioBytes > 0 && ` · ${formatBytes(audioBytes)} audio`}
          </p>
        </div>

        {chapters.length > 0 && onRead !== undefined ? (
          <button
            type="button"
            onClick={() => onRead()}
            className="ml-auto shrink-0 rounded bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg transition-opacity hover:opacity-90"
          >
            {resumeChapterId === undefined ? 'Đọc' : 'Đọc tiếp'}
          </button>
        ) : null}
      </header>

      {chapters.length === 0 ? (
        <p className="p-8 text-center text-fg-muted">Sách này chưa có chương nào.</p>
      ) : (
        <ol className="flex-1 space-y-1 overflow-y-auto px-4 pb-4">
          {chapters.map((chapter) => {
            const isResume = chapter.id === resumeChapterId;

            return (
              <li key={chapter.id} data-testid="chapter-item" data-resume={isResume}>
                <button
                  type="button"
                  onClick={() => onRead?.(chapter.id)}
                  aria-label={`Đọc ${chapter.title}`}
                  className={`flex w-full items-center gap-3 rounded border px-3 py-2 text-left transition-colors ${
                    isResume
                      ? 'border-accent bg-accent/5 hover:bg-accent/10'
                      : 'border-border bg-bg-elevated hover:border-accent'
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
                      {chapter.audioBytes > 0 && ` · ${formatBytes(chapter.audioBytes)}`}
                    </span>
                  </span>

                  {/* Chương đã có audio hay chưa là thứ user cần thấy trước khi
                      bấm generate — không thì phải mở từng chương ra mới biết. */}
                  {chapter.generateStatus !== 'none' ? (
                    <span
                      data-testid="chapter-generate-status"
                      data-generate-status={chapter.generateStatus}
                      className="shrink-0 rounded bg-bg-subtle px-2 py-0.5 text-xs text-fg-muted"
                    >
                      {chapter.generateStatus === 'complete' ? 'Đủ audio' : 'Một phần'}
                    </span>
                  ) : null}

                  {isResume ? (
                    <span className="shrink-0 rounded bg-accent/10 px-2 py-0.5 text-xs text-accent">
                      Đang đọc
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ol>
      )}

      {chapters.length > 0 && (
        <footer className="shrink-0 border-t border-border px-4 py-2.5">
          <GenerateControls bookId={book.id} bookTitle={book.title} voiceReady={voiceReady} />
        </footer>
      )}
    </div>
  );
};
