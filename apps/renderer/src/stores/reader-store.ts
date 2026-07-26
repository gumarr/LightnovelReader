import { create } from 'zustand';
import { errorMessage, type BookHtml, type Segment } from '@ln/shared';

/**
 * State của trình đọc: nội dung sách và segment đang chọn.
 *
 * Tách khỏi `library-store` vì vòng đời khác hẳn — thư viện sống suốt phiên,
 * còn nội dung sách phải bỏ đi khi đóng để không giữ vài chục MB bytes PDF.
 */

/** Xem PROGRESS.md mục 4.3 — invoke vẫn reject được dù handler không throw */
const IPC_FAILED = 'Không kết nối được tiến trình chính. Hãy khởi động lại ứng dụng.';

export type ReaderState = {
  /** Bytes file PDF. `null` với sách DOCX hoặc khi chưa nạp */
  pdfBytes: ArrayBuffer | null;
  /** HTML sách DOCX. `null` với sách PDF hoặc khi chưa nạp */
  html: BookHtml | null;
  /** Segment của chương đang mở */
  segments: Segment[];
  /** Chương đang mở — biết để không nạp lại khi user bấm đúng chương đó */
  chapterId: string | null;
  activeSegmentId: string | null;
  loading: boolean;
  error: string | null;

  loadBook: (bookId: string, format: 'pdf' | 'docx' | 'epub') => Promise<void>;
  loadChapter: (chapterId: string) => Promise<void>;
  setActiveSegment: (segmentId: string) => void;
  /**
   * Thay một segment vừa đổi trạng thái (hàng đợi generate xong).
   *
   * Chỉ thay tại chỗ, **không** tải lại cả danh sách: một chương có tới 1353
   * segment, mà generate cả sách thì mỗi vài giây lại xong một cái.
   * Segment thuộc chương khác bị bỏ qua.
   */
  applySegmentUpdate: (segment: Segment) => void;
  reset: () => void;
};

/** State ban đầu, dùng lại cho `reset()`. Hàm để mỗi lần gọi là một mảng mới. */
const emptyState = (): Omit<
  ReaderState,
  'loadBook' | 'loadChapter' | 'setActiveSegment' | 'applySegmentUpdate' | 'reset'
> => ({
  pdfBytes: null,
  html: null,
  segments: [],
  chapterId: null,
  activeSegmentId: null,
  loading: false,
  error: null,
});

export const useReaderStore = create<ReaderState>((set, get) => ({
  ...emptyState(),

  loadBook: async (bookId, format) => {
    if (format === 'epub') {
      set({ error: 'Chưa hỗ trợ EPUB.', loading: false });
      return;
    }

    set({ loading: true, error: null });

    try {
      if (format === 'pdf') {
        const result = await window.api.reader.getBookFile(bookId);
        if (result.ok) set({ pdfBytes: result.data.bytes, html: null, loading: false });
        else set({ error: result.error.message, loading: false });
        return;
      }

      const result = await window.api.reader.getBookHtml(bookId);
      if (result.ok) set({ html: result.data, pdfBytes: null, loading: false });
      else set({ error: result.error.message, loading: false });
    } catch (e) {
      set({ error: `${IPC_FAILED} (${errorMessage(e)})`, loading: false });
    }
  },

  loadChapter: async (chapterId) => {
    // Bấm lại đúng chương đang mở thì không nạp lại — 1353 segment qua IPC
    if (get().chapterId === chapterId) return;

    set({ loading: true, error: null });

    try {
      const result = await window.api.reader.listSegments(chapterId);
      if (result.ok) {
        set({
          segments: result.data,
          chapterId,
          // Đổi chương thì bỏ segment đang chọn: nó thuộc chương cũ, giữ lại
          // sẽ khiến viewer cuộn về chỗ không còn liên quan.
          activeSegmentId: null,
          loading: false,
        });
      } else {
        set({ error: result.error.message, loading: false });
      }
    } catch (e) {
      set({ error: `${IPC_FAILED} (${errorMessage(e)})`, loading: false });
    }
  },

  setActiveSegment: (segmentId) => set({ activeSegmentId: segmentId }),

  applySegmentUpdate: (segment) => {
    const { segments } = get();
    const index = segments.findIndex((s) => s.id === segment.id);
    // Segment của chương khác (generate cả sách chạy nền) — không chen vào
    // danh sách đang mở.
    if (index === -1) return;

    const next = [...segments];
    next[index] = segment;
    set({ segments: next });
  },

  reset: () => set(emptyState()),
}));

/** Segment đang chọn, tra từ danh sách hiện có */
export const activeSegmentOf = (state: ReaderState): Segment | undefined =>
  state.activeSegmentId === null
    ? undefined
    : state.segments.find((s) => s.id === state.activeSegmentId);
