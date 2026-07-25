import { useEffect, useMemo, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { BookDetail } from '@ln/shared';
import { errorMessage } from '@ln/shared';
import { useReaderStore, activeSegmentOf } from '@/stores/reader-store';
import { useLibraryStore } from '@/stores/library-store';
import { loadPdf } from './pdf-document';
import { PdfViewer } from './PdfViewer';
import { DocxViewer } from './DocxViewer';
import { SegmentList } from './SegmentList';
import { ChapterPicker } from './ChapterPicker';

/**
 * Trình đọc: viewer chiếm toàn bộ màn, panel segment bật/tắt được.
 *
 * Chưa dựng khung 2/3–1/3 với subtitle pane như mockup trong plan.md: pane đó
 * chỉ có nghĩa khi đã có timing từng từ (Phase 2). Dựng sẵn một khung rỗng ở
 * đây là đúng thứ CLAUDE.md cấm.
 */

export type ReaderScreenProps = {
  detail: BookDetail;
  /** Chương user bấm ở mục lục. Không có = mở chỗ đọc dở. */
  startChapterId?: string;
  onBack: () => void;
};

export const ReaderScreen = ({
  detail,
  startChapterId,
  onBack,
}: ReaderScreenProps): JSX.Element => {
  const { book, chapters, resumeChapterId } = detail;

  const pdfBytes = useReaderStore((s) => s.pdfBytes);
  const html = useReaderStore((s) => s.html);
  const segments = useReaderStore((s) => s.segments);
  const chapterId = useReaderStore((s) => s.chapterId);
  const activeSegmentId = useReaderStore((s) => s.activeSegmentId);
  const loading = useReaderStore((s) => s.loading);
  const error = useReaderStore((s) => s.error);
  const loadBook = useReaderStore((s) => s.loadBook);
  const loadChapter = useReaderStore((s) => s.loadChapter);
  const setActiveSegment = useReaderStore((s) => s.setActiveSegment);
  const reset = useReaderStore((s) => s.reset);

  const saveProgress = useLibraryStore((s) => s.saveProgress);

  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [showSegments, setShowSegments] = useState(true);

  const activeSegment = useReaderStore(activeSegmentOf);

  // Chương user chọn ở mục lục thắng; không có thì chỗ đọc dở, rồi mới chương đầu
  const initialChapterId = startChapterId ?? resumeChapterId ?? chapters[0]?.id;

  useEffect(() => {
    void loadBook(book.id, book.format);
    return () => {
      // Bỏ nội dung khi rời trình đọc — bytes PDF có thể vài chục MB
      reset();
    };
  }, [book.id, book.format, loadBook, reset]);

  useEffect(() => {
    if (initialChapterId !== undefined) void loadChapter(initialChapterId);
  }, [initialChapterId, loadChapter]);

  // Dựng tài liệu pdfjs từ bytes. Tách khỏi store vì `PDFDocumentProxy` là đối
  // tượng có vòng đời (phải `destroy`), không phải state thuần.
  useEffect(() => {
    if (pdfBytes === null) return;

    let cancelled = false;
    let dispose: (() => Promise<void>) | undefined;

    void (async () => {
      try {
        const { doc: loaded, destroy } = await loadPdf(pdfBytes);
        dispose = destroy;

        if (cancelled) {
          void destroy();
          return;
        }
        setDoc(loaded);
        setPdfError(null);
      } catch (e) {
        if (!cancelled) setPdfError(`Không mở được file PDF: ${errorMessage(e)}`);
      }
    })();

    return () => {
      cancelled = true;
      setDoc(null);
      void dispose?.();
    };
  }, [pdfBytes]);

  // Ghi vị trí đọc khi đổi segment. `ref` để không gọi lại lúc `saveProgress`
  // đổi tham chiếu — chỉ đúng segment mới là lý do ghi.
  const lastSavedRef = useRef<string | null>(null);
  useEffect(() => {
    if (activeSegmentId === null || lastSavedRef.current === activeSegmentId) return;
    lastSavedRef.current = activeSegmentId;
    void saveProgress(book.id, activeSegmentId);
  }, [activeSegmentId, book.id, saveProgress]);

  const currentChapter = useMemo(
    () => chapters.find((c) => c.id === chapterId),
    [chapters, chapterId],
  );

  const message = pdfError ?? error;

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2">
        <button
          type="button"
          onClick={onBack}
          className="rounded px-2 py-1 text-sm text-fg-muted transition-colors hover:bg-bg-subtle hover:text-fg"
        >
          ← Thư viện
        </button>

        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-medium text-fg">{book.title}</h1>
          <p className="truncate text-xs text-fg-muted">
            {currentChapter?.title ?? 'Chưa chọn chương'} · {segments.length} đoạn
          </p>
        </div>

        <ChapterPicker
          chapters={chapters}
          currentChapterId={chapterId}
          onSelect={(id) => void loadChapter(id)}
        />

        <button
          type="button"
          onClick={() => setShowSegments((v) => !v)}
          aria-pressed={showSegments}
          className="rounded border border-border px-2 py-1 text-xs text-fg-muted transition-colors hover:bg-bg-subtle hover:text-fg"
        >
          {showSegments ? 'Ẩn đoạn' : 'Hiện đoạn'}
        </button>
      </header>

      {message !== null ? (
        <p role="alert" className="mx-4 mt-2 text-sm text-danger">
          {message}
        </p>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1">
          {book.format === 'pdf' ? (
            doc === null ? (
              <p className="p-8 text-center text-fg-muted">
                {loading || message === null ? 'Đang mở sách…' : 'Không mở được sách.'}
              </p>
            ) : (
              <PdfViewer doc={doc} activeSegment={activeSegment} />
            )
          ) : html === null ? (
            <p className="p-8 text-center text-fg-muted">
              {loading || message === null ? 'Đang mở sách…' : 'Không mở được sách.'}
            </p>
          ) : (
            <DocxViewer content={html} activeSegment={activeSegment} />
          )}
        </main>

        {showSegments ? (
          <aside
            data-testid="segment-panel"
            className="flex w-72 shrink-0 flex-col border-l border-border bg-bg-elevated"
          >
            <SegmentList
              segments={segments}
              activeSegmentId={activeSegmentId}
              onSelect={setActiveSegment}
            />
          </aside>
        ) : null}
      </div>
    </div>
  );
};
