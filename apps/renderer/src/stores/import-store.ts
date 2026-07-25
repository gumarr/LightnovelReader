import { create } from 'zustand';
import {
  errorMessage,
  hasBlockingIssue,
  mergeWithPrevious,
  removeChapter,
  renameChapter,
  splitAt,
  toggleExcluded,
  validateDraft,
  type ChapterDraft,
  type DraftIssue,
  type ImportPreview,
} from '@ln/shared';

/**
 * State của màn "Xác nhận cấu trúc chương".
 *
 * Logic sửa chương nằm ở `@ln/shared/chapter-draft` (hàm thuần, test riêng) —
 * store này chỉ giữ trạng thái và nối vào IPC.
 */

/** Xem `PROGRESS.md` mục 4.3 — invoke vẫn reject được dù handler không throw */
const IPC_FAILED = 'Không kết nối được tiến trình chính. Hãy khởi động lại ứng dụng.';

/** Số bước hoàn tác giữ lại. Đủ để sửa nhầm vài thao tác liên tiếp. */
const UNDO_LIMIT = 20;

export type ImportState = {
  preview: ImportPreview | null;
  chapters: ChapterDraft[];
  /** Text preview theo chapterId, tải lười khi user mở chương */
  previews: Record<string, string>;
  /** Chương đang tải preview — để không gọi IPC hai lần cho cùng chương */
  loadingPreviews: string[];
  issues: DraftIssue[];
  /** Đang parse file — thao tác này mất vài giây với sách 270 trang */
  parsing: boolean;
  error: string | null;
  /** Ngăn xếp hoàn tác, phần tử cuối là trạng thái gần nhất */
  history: ChapterDraft[][];

  pickFile: () => Promise<void>;
  parseFile: (filePath: string) => Promise<void>;
  loadPreview: (chapterId: string) => Promise<void>;
  merge: (chapterId: string) => void;
  split: (chapterId: string, atPage: number) => void;
  rename: (chapterId: string, title: string) => void;
  remove: (chapterId: string) => void;
  toggleExclude: (chapterId: string) => void;
  undo: () => void;
  reset: () => Promise<void>;
  canConfirm: () => boolean;
};

const initial = {
  preview: null,
  chapters: [],
  previews: {},
  loadingPreviews: [],
  issues: [],
  parsing: false,
  error: null,
  history: [],
} satisfies Omit<
  ImportState,
  | 'pickFile'
  | 'parseFile'
  | 'loadPreview'
  | 'merge'
  | 'split'
  | 'rename'
  | 'remove'
  | 'toggleExclude'
  | 'undo'
  | 'reset'
  | 'canConfirm'
>;

/**
 * So sánh hai danh sách chương theo nội dung.
 *
 * Cần vì các hàm sửa luôn trả mảng mới (chúng sắp xếp lại), nên `===` không
 * phân biệt được "đã sửa" với "bị từ chối".
 */
const sameChapters = (a: readonly ChapterDraft[], b: readonly ChapterDraft[]): boolean =>
  a.length === b.length &&
  a.every((chapter, i) => {
    const other = b[i]!;
    return (
      chapter.id === other.id &&
      chapter.title === other.title &&
      chapter.pageStart === other.pageStart &&
      chapter.pageEnd === other.pageEnd &&
      chapter.excluded === other.excluded
    );
  });

export const useImportStore = create<ImportState>((set, get) => {
  /**
   * Áp một phép sửa lên danh sách chương: đẩy trạng thái cũ vào history, tính
   * lại vấn đề. Gom vào một chỗ để không có thao tác nào quên bước nào.
   */
  const apply = (fn: (chapters: ChapterDraft[]) => ChapterDraft[]): void => {
    const state = get();
    if (state.preview === null) return;

    const next = fn(state.chapters);
    // Thao tác bị từ chối (tách sai chỗ, gộp chương đầu) trả về mảng nội dung
    // y hệt — nhưng KHÔNG cùng tham chiếu, vì mọi hàm sửa đều sắp xếp lại nên
    // luôn tạo mảng mới. So sánh theo nội dung, nếu không undo sẽ tích lại
    // những bước không làm gì.
    if (sameChapters(next, state.chapters)) return;

    set({
      chapters: next,
      history: [...state.history, state.chapters].slice(-UNDO_LIMIT),
      issues: validateDraft(next, state.preview.totalPages),
    });
  };

  const acceptPreview = (preview: ImportPreview): void => {
    set({
      preview,
      chapters: preview.chapters,
      previews: {},
      loadingPreviews: [],
      issues: validateDraft(preview.chapters, preview.totalPages),
      parsing: false,
      error: null,
      history: [],
    });
  };

  return {
    ...initial,

    pickFile: async () => {
      set({ parsing: true, error: null });
      try {
        const result = await window.api.import.pickFile();
        if (!result.ok) {
          set({ error: result.error.message, parsing: false });
          return;
        }
        // `null` = user bấm huỷ ở dialog, không phải lỗi
        if (result.data === null) {
          set({ parsing: false });
          return;
        }
        acceptPreview(result.data);
      } catch (e) {
        set({ error: `${IPC_FAILED} (${errorMessage(e)})`, parsing: false });
      }
    },

    parseFile: async (filePath) => {
      set({ parsing: true, error: null });
      try {
        const result = await window.api.import.parseFile(filePath);
        if (result.ok) acceptPreview(result.data);
        else set({ error: result.error.message, parsing: false });
      } catch (e) {
        set({ error: `${IPC_FAILED} (${errorMessage(e)})`, parsing: false });
      }
    },

    loadPreview: async (chapterId) => {
      const state = get();
      const chapter = state.chapters.find((c) => c.id === chapterId);
      if (state.preview === null || chapter === undefined) return;
      // Đã có hoặc đang tải thì thôi — tránh gọi IPC lặp khi user bấm liên tục
      if (state.previews[chapterId] !== undefined) return;
      if (state.loadingPreviews.includes(chapterId)) return;

      set({ loadingPreviews: [...state.loadingPreviews, chapterId] });

      const done = (): void => {
        set((s) => ({ loadingPreviews: s.loadingPreviews.filter((id) => id !== chapterId) }));
      };

      try {
        const result = await window.api.import.getChapterPreview({
          importId: state.preview.importId,
          chapterId,
          pageStart: chapter.pageStart,
          pageEnd: chapter.pageEnd,
        });

        if (result.ok) {
          set((s) => ({ previews: { ...s.previews, [chapterId]: result.data.text } }));
        } else {
          set({ error: result.error.message });
        }
      } catch (e) {
        set({ error: `${IPC_FAILED} (${errorMessage(e)})` });
      } finally {
        done();
      }
    },

    merge: (chapterId) => {
      apply((chapters) => mergeWithPrevious(chapters, chapterId));
      // Vùng trang đổi → preview cũ không còn đúng nội dung chương
      invalidatePreview(set, chapterId);
    },

    split: (chapterId, atPage) => {
      apply((chapters) => splitAt(chapters, chapterId, atPage));
      invalidatePreview(set, chapterId);
    },

    rename: (chapterId, title) => apply((chapters) => renameChapter(chapters, chapterId, title)),

    remove: (chapterId) => {
      apply((chapters) => removeChapter(chapters, chapterId));
      invalidatePreview(set, chapterId);
    },

    toggleExclude: (chapterId) => apply((chapters) => toggleExcluded(chapters, chapterId)),

    undo: () => {
      const state = get();
      const previous = state.history.at(-1);
      if (previous === undefined || state.preview === null) return;

      set({
        chapters: previous,
        history: state.history.slice(0, -1),
        issues: validateDraft(previous, state.preview.totalPages),
        // Vùng trang quay lại trạng thái cũ → preview đã tải không còn tin được
        previews: {},
      });
    },

    reset: async () => {
      const { preview } = get();
      set({ ...initial });
      if (preview === null) return;

      try {
        // Báo main giải phóng tài liệu đã parse. Lỗi ở đây không ảnh hưởng
        // user (màn hình đã đóng) nên chỉ ghi vào error, không chặn.
        const result = await window.api.import.cancel(preview.importId);
        if (!result.ok) set({ error: result.error.message });
      } catch (e) {
        set({ error: `${IPC_FAILED} (${errorMessage(e)})` });
      }
    },

    canConfirm: () => {
      const { preview, issues, parsing } = get();
      return preview !== null && !parsing && !hasBlockingIssue(issues);
    },
  };
});

/** Bỏ preview đã tải của một chương — dùng khi vùng trang của nó đổi */
const invalidatePreview = (
  set: (fn: (state: ImportState) => Partial<ImportState>) => void,
  chapterId: string,
): void => {
  set((state) => {
    if (state.previews[chapterId] === undefined) return {};
    const next = { ...state.previews };
    delete next[chapterId];
    return { previews: next };
  });
};
