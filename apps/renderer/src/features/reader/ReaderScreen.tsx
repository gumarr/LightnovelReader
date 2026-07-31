import { useEffect, useMemo, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { BookDetail } from '@ln/shared';
import { DEFAULT_SETTINGS, errorMessage, PREFETCH_THRESHOLD } from '@ln/shared';
import { useReaderStore, activeSegmentOf } from '@/stores/reader-store';
import { useLibraryStore } from '@/stores/library-store';
import { useQueueStore } from '@/stores/queue-store';
import { useSettingsStore } from '@/stores/settings-store';
import { GenerateControls } from '@/features/generate/GenerateControls';
import { nextChapterToPrefetch } from '@/features/generate/format';
import { PlayerBar } from '@/features/player/PlayerBar';
import { usePlayer } from '@/features/player/usePlayer';
import { usePlayerStore } from '@/stores/player-store';
import { SubtitlePane } from '@/features/player/SubtitlePane';
import { PronunciationDialog } from '@/features/player/PronunciationDialog';
import { usePronunciationStore } from '@/stores/pronunciation-store';
import { loadPdf } from './pdf-document';
import { PdfViewer } from './PdfViewer';
import { DocxViewer } from './DocxViewer';
import { SegmentList } from './SegmentList';
import { ChapterPicker } from './ChapterPicker';
import { PaneSplitter } from './PaneSplitter';

/**
 * Trình đọc: viewer ở trên, phụ đề ở dưới, panel segment bật/tắt bên phải.
 *
 * Khung 2/3–1/3 như mockup plan.md, dựng ở P3.4 khi đã có timing từng từ. Tỉ lệ
 * user kéo được và nhớ qua phiên (`viewerPaneRatio`).
 */

export type ReaderScreenProps = {
  detail: BookDetail;
  /** Chương user bấm ở mục lục. Không có = mở chỗ đọc dở. */
  startChapterId?: string;
  onBack: () => void;
  /**
   * Mở màn Giọng đọc. Dùng cho đường tắt ở thanh player khi chưa chọn giọng —
   * màn đó nằm ngoài trình đọc nên phải đóng sách, việc của `App`.
   */
  onOpenVoices?: () => void;
};

export const ReaderScreen = ({
  detail,
  startChapterId,
  onBack,
  onOpenVoices,
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
  const applySegmentUpdate = useReaderStore((s) => s.applySegmentUpdate);
  const reset = useReaderStore((s) => s.reset);

  const saveProgress = useLibraryStore((s) => s.saveProgress);

  const loadQueueStatus = useQueueStore((s) => s.loadStatus);
  const applyQueueStatus = useQueueStore((s) => s.applyStatus);
  const prefetchChapter = useQueueStore((s) => s.prefetchChapter);

  // Giọng đọc theo ngôn ngữ sách. Rỗng thì hàng đợi dừng ngay ở job đầu — chặn
  // nút ngay tại đây thay vì để user chờ rồi mới thấy lỗi (xem PROGRESS 4.36).
  const voiceReady = useSettingsStore(
    (s) => ((book.lang === 'vi' ? s.settings?.voiceVi : s.settings?.voiceEn) ?? '') !== '',
  );

  // Tốc độ phát nhớ qua phiên. `undefined` khi settings chưa nạp xong — player
  // giữ 1× rồi áp lại khi có, chứ không đoán bừa.
  const storedRate = useSettingsStore((s) => s.settings?.playbackRate);
  const updateSettings = useSettingsStore((s) => s.update);

  // Tỉ lệ viewer / phụ đề. Nhớ qua phiên nên nguồn thật là settings, nhưng lúc
  // **đang kéo** phải dùng state cục bộ: ghi SQLite mỗi khung hình là không
  // chấp nhận được (xem `PaneSplitter`). `null` = chưa kéo, lấy theo settings.
  // Cỡ chữ phụ đề — cùng lối với `playbackRate`: settings là nguồn thật, còn
  // `DEFAULT_SETTINGS` che khoảng thời gian settings chưa nạp xong.
  const subtitleFontSize = useSettingsStore(
    (s) => s.settings?.subtitleFontSize ?? DEFAULT_SETTINGS.subtitleFontSize,
  );

  const storedPaneRatio = useSettingsStore((s) => s.settings?.viewerPaneRatio);
  const [draggingRatio, setDraggingRatio] = useState<number | null>(null);
  const paneRatio = draggingRatio ?? storedPaneRatio ?? DEFAULT_SETTINGS.viewerPaneRatio;

  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [showSegments, setShowSegments] = useState(true);
  /** Từ đang sửa cách đọc, `null` khi hộp thoại đóng */
  const [editingTerm, setEditingTerm] = useState<string | null>(null);

  const loadPronunciations = usePronunciationStore((s) => s.load);
  const [showSubtitle, setShowSubtitle] = useState(true);

  const activeSegment = useReaderStore(activeSegmentOf);

  // Phụ đề bám segment **đang phát**, không phải segment đang chọn: bấm vào một
  // đoạn khác để xem nó ở trang nào thì phụ đề vẫn phải chạy theo tiếng đang
  // nghe, nếu không chữ và tiếng lệch nhau.
  const playingSegmentId = usePlayerStore((s) => s.segmentId);
  const subtitleText = useMemo(
    () => segments.find((segment) => segment.id === playingSegmentId)?.text ?? '',
    [segments, playingSegmentId],
  );

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

  // Nạp phiên âm của sách một lần khi mở. Hộp sửa cách đọc cần danh sách này để
  // biết từ user bấm đã có mục chưa — mở hộp rồi mới đi hỏi thì ô nhập trống
  // một nhịp rồi mới điền, trông như mất dữ liệu.
  useEffect(() => {
    void loadPronunciations(book.id);
  }, [book.id, loadPronunciations]);

  // Hàng đợi generate: nạp trạng thái một lần rồi nghe event. Hai nguồn đẩy —
  // số đếm cho thanh tiến độ, và segment vừa xong để đổi trạng thái trong danh
  // sách. Cả hai phải huỷ đăng ký khi rời trình đọc, nếu không là rò listener.
  useEffect(() => {
    void loadQueueStatus();
    const offStatus = window.api.queue.onStatusChanged(applyQueueStatus);
    const offSegment = window.api.queue.onSegmentUpdated((segment) => {
      // Hai nơi cùng cần tin này. Danh sách đoạn đổi dấu trạng thái, còn player
      // có thể đang **đứng chờ** đúng segment vừa xong — bỏ qua nó là player
      // treo ở "đang tạo audio" mãi dù file đã sẵn sàng.
      applySegmentUpdate(segment);
      void usePlayerStore.getState().handleSegmentUpdate(segment);
    });
    return () => {
      offStatus();
      offSegment();
    };
  }, [loadQueueStatus, applyQueueStatus, applySegmentUpdate]);

  // Player: dựng thẻ audio, nối IPC, nhả Blob URL khi rời trình đọc.
  // `setActiveSegment` để viewer cuộn tới và tô đúng đoạn đang phát — chính là
  // đường P1.6c đã dựng sẵn cho Phase 3.
  usePlayer({
    segments,
    canGenerate: voiceReady,
    onSegmentChanged: setActiveSegment,
    ...(storedRate === undefined ? {} : { storedRate }),
    onRateChanged: (playbackRate) => {
      // Không `await`: đổi tốc độ phải ăn ngay ở thẻ audio, còn việc ghi xuống
      // SQLite là chuyện nền. Hỏng thì `settings-store` đã hiện lỗi của nó.
      void updateSettings({ playbackRate });
    },
  });

  // Prefetch chương kế khi đọc tới 80% chương hiện tại. Tiến độ đo bằng segment
  // đang đọc chứ không bằng cuộn — xem `nextChapterToPrefetch`.
  const activeIndex = useMemo(
    () => segments.findIndex((segment) => segment.id === activeSegmentId),
    [segments, activeSegmentId],
  );
  useEffect(() => {
    if (!voiceReady) return;

    const target = nextChapterToPrefetch(
      chapters.map((chapter) => chapter.id),
      chapterId,
      activeIndex,
      segments.length,
      PREFETCH_THRESHOLD,
    );
    if (target !== undefined) void prefetchChapter(target);
  }, [voiceReady, chapters, chapterId, activeIndex, segments.length, prefetchChapter]);

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

  /**
   * Bấm một đoạn: đang nghe thì **nhảy tới đó**, chưa nghe thì chỉ chọn.
   *
   * Không tự bắt đầu phát khi player đang `idle`: bấm vào đoạn để xem nó nằm ở
   * trang nào là thao tác thường gặp, mà tự phát tiếng lúc đó là bất ngờ khó
   * chịu. Đang phát rồi thì bấm đoạn khác rõ ràng là ý muốn nhảy tới.
   */
  const handleSelectSegment = (segmentId: string): void => {
    setActiveSegment(segmentId);

    const player = usePlayerStore.getState();
    if (player.state === 'playing' || player.state === 'waiting') {
      void player.playFrom(segmentId);
    }
  };

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
          onClick={() => setShowSubtitle((v) => !v)}
          aria-pressed={showSubtitle}
          className="rounded border border-border px-2 py-1 text-xs text-fg-muted transition-colors hover:bg-bg-subtle hover:text-fg"
        >
          {showSubtitle ? 'Ẩn phụ đề' : 'Hiện phụ đề'}
        </button>

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
        {/*
          Cột trái chia dọc: trang sách trên, phụ đề dưới. `min-w-0` để cột không
          bị nội dung PDF đẩy rộng ra ngoài khung.
        */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <main
            className="min-h-0 overflow-hidden"
            // Chiều cao theo tỉ lệ chứ không theo `flex-1`: cả hai pane đều cần
            // co giãn được, mà `flex-basis` phần trăm cho ra đúng tỉ lệ user kéo.
            // Ẩn phụ đề thì viewer lấy hết chỗ.
            style={showSubtitle ? { flex: `${String(paneRatio)} 1 0%` } : { flex: '1 1 0%' }}
          >
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

          {showSubtitle ? (
            <>
              <PaneSplitter
                ratio={paneRatio}
                onDrag={setDraggingRatio}
                onCommit={(ratio) => {
                  // Nhả chuột mới ghi xuống SQLite, rồi trả quyền cho settings.
                  setDraggingRatio(null);
                  void updateSettings({ viewerPaneRatio: ratio });
                }}
              />
              <section
                aria-label="Phụ đề"
                className="min-h-0 bg-bg-elevated"
                style={{ flex: `${String(1 - paneRatio)} 1 0%` }}
              >
                <SubtitlePane
                  text={subtitleText}
                  fontSizePx={subtitleFontSize}
                  onEditPronunciation={setEditingTerm}
                />
              </section>
            </>
          ) : null}
        </div>

        {showSegments ? (
          <aside
            data-testid="segment-panel"
            className="flex w-72 shrink-0 flex-col border-l border-border bg-bg-elevated"
          >
            <div className="shrink-0 border-b border-border p-2.5">
              <GenerateControls
                bookId={book.id}
                bookTitle={book.title}
                {...(chapterId === null ? {} : { chapterId })}
                {...(currentChapter === undefined ? {} : { chapterTitle: currentChapter.title })}
                voiceReady={voiceReady}
              />
            </div>

            {/*
              `flex-1 min-h-0` là bắt buộc, không phải trang trí. Thiếu nó thì ô
              cuộn bên trong `SegmentList` (`h-full`) lấy chiều cao theo **nội
              dung** lúc đo lần đầu — mà lúc đó segment chưa nạp xong nên nó chốt
              ở một chiều cao nhỏ và danh sách bị cắt mất nửa dưới. Bấm ẩn rồi
              hiện lại thì component dựng lại sau khi layout đã xong nên trông
              như hết lỗi. `min-h-0` để flex item được phép co dưới chiều cao nội
              dung, nếu không nó đẩy tràn cả `aside`.
            */}
            <div className="min-h-0 flex-1">
              <SegmentList
                segments={segments}
                activeSegmentId={activeSegmentId}
                onSelect={handleSelectSegment}
              />
            </div>
          </aside>
        ) : null}
      </div>

      <PlayerBar
        voiceReady={voiceReady}
        {...(onOpenVoices === undefined ? {} : { onOpenVoices })}
      />

      {editingTerm !== null ? (
        <PronunciationDialog term={editingTerm} onClose={() => setEditingTerm(null)} />
      ) : null}
    </div>
  );
};
