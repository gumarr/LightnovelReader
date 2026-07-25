import { create } from 'zustand';
import {
  errorMessage,
  type BookDetail,
  type LibraryEntry,
} from '@ln/shared';

/**
 * State thư viện: danh sách sách và sách đang mở.
 *
 * Nguồn sự thật là SQLite ở main — store này chỉ giữ bản sao và gọi IPC.
 */

/** Xem PROGRESS.md mục 4.3 — invoke vẫn reject được dù handler không throw */
const IPC_FAILED = 'Không kết nối được tiến trình chính. Hãy khởi động lại ứng dụng.';

export type LibraryState = {
  entries: LibraryEntry[];
  /** Sách đang mở kèm danh sách chương. `null` = đang ở màn thư viện */
  opened: BookDetail | null;
  loading: boolean;
  error: string | null;

  load: () => Promise<void>;
  open: (bookId: string) => Promise<void>;
  close: () => void;
  remove: (bookId: string) => Promise<void>;
  /** Ghi vị trí đọc dở. Lỗi ở đây không chặn user đọc tiếp. */
  saveProgress: (bookId: string, segmentId: string) => Promise<void>;
};

export const useLibraryStore = create<LibraryState>((set) => ({
  entries: [],
  opened: null,
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const result = await window.api.library.list();
      if (result.ok) set({ entries: result.data, loading: false });
      else set({ error: result.error.message, loading: false });
    } catch (e) {
      set({ error: `${IPC_FAILED} (${errorMessage(e)})`, loading: false });
    }
  },

  open: async (bookId) => {
    set({ loading: true, error: null });
    try {
      const result = await window.api.library.openBook(bookId);
      if (result.ok) set({ opened: result.data, loading: false });
      else set({ error: result.error.message, loading: false });
    } catch (e) {
      set({ error: `${IPC_FAILED} (${errorMessage(e)})`, loading: false });
    }
  },

  close: () => set({ opened: null }),

  remove: async (bookId) => {
    try {
      const result = await window.api.library.removeBook(bookId);
      if (!result.ok) {
        set({ error: result.error.message });
        return;
      }

      // Bỏ khỏi danh sách ngay thay vì gọi lại `list()` — kết quả đã biết
      set((s) => ({
        entries: s.entries.filter((e) => e.book.id !== bookId),
        opened: s.opened?.book.id === bookId ? null : s.opened,
        error: null,
      }));
    } catch (e) {
      set({ error: `${IPC_FAILED} (${errorMessage(e)})` });
    }
  },

  saveProgress: async (bookId, segmentId) => {
    try {
      const result = await window.api.library.setProgress({ bookId, segmentId });
      if (result.ok) return;
      set({ error: result.error.message });
    } catch (e) {
      // Không chặn việc đọc: mất vị trí resume khó chịu nhưng không hỏng gì
      set({ error: `${IPC_FAILED} (${errorMessage(e)})` });
    }
  },
}));

/**
 * Sách đọc gần nhất — dùng cho nút "Đọc tiếp" ở đầu thư viện.
 *
 * `list()` đã sắp theo `lastOpenedAt` giảm dần, nên chỉ cần lấy mục đầu tiên
 * đã từng được mở. Sách chưa mở bao giờ không tính là "đọc tiếp".
 */
export const mostRecentlyRead = (entries: readonly LibraryEntry[]): LibraryEntry | undefined =>
  entries.find((entry) => entry.book.lastOpenedAt !== undefined);
