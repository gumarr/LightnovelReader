import { create } from 'zustand';
import { errorMessage, type BookmarkEntry, type ReadingStats } from '@ln/shared';

/**
 * Dấu trang + thống kê đọc của sách đang mở (P5.4).
 *
 * Hai thứ ở chung một store vì chúng **luôn thay đổi cùng nhau**: thêm hay xoá
 * dấu trang là `stats.bookmarkCount` lệch ngay. Tách hai store thì mỗi lần đánh
 * dấu phải nhớ gọi hai lượt nạp, mà quên một chỗ là con số sai âm thầm.
 *
 * `stats` giữ `null` cho tới khi nạp xong — component phải chịu được cả trạng
 * thái đó chứ không dựng số 0 giả, vì "chưa biết" và "bằng 0" hiện ra khác nhau.
 */

/** Xem PROGRESS.md mục 4.3 — invoke vẫn reject được dù handler không throw */
const IPC_FAILED = 'Không kết nối được tiến trình chính. Hãy khởi động lại ứng dụng.';

export type BookmarkState = {
  entries: BookmarkEntry[];
  stats: ReadingStats | null;
  /** Sách đang mở, `null` khi chưa mở sách nào */
  bookId: string | null;
  loading: boolean;
  error: string | null;

  /** Nạp cả dấu trang lẫn thống kê của một sách */
  load: (bookId: string) => Promise<void>;
  /** Đánh dấu đoạn đang đọc. Đoạn đã có dấu thì cập nhật ghi chú */
  add: (segmentId: string, note?: string) => Promise<boolean>;
  updateNote: (id: string, note: string) => Promise<boolean>;
  remove: (id: string) => Promise<void>;
  /** Quên sách cũ khi rời trình đọc — không để dấu trang sách trước lộ sang sách sau */
  reset: () => void;
  clearError: () => void;
};

/** Dấu trang của một đoạn, `undefined` khi đoạn chưa được đánh dấu */
export const bookmarkOfSegment = (
  entries: readonly BookmarkEntry[],
  segmentId: string | null,
): BookmarkEntry | undefined =>
  segmentId === null ? undefined : entries.find((e) => e.bookmark.segmentId === segmentId);

export const useBookmarkStore = create<BookmarkState>((set, get) => {
  /**
   * Nạp lại thống kê sau khi danh sách đổi.
   *
   * Không tự cộng trừ `bookmarkCount` ở renderer: `add` có thể là **cập nhật**
   * một mục đã có, và đoán sai chiều thì con số trôi dần mà không lượt nạp nào
   * sửa lại cho tới khi user mở lại sách.
   */
  const refreshStats = async (bookId: string): Promise<void> => {
    try {
      const result = await window.api.library.getStats(bookId);
      // Lỗi ở lượt phụ này KHÔNG ghi đè lỗi của hành động user vừa làm, và cũng
      // không đáng hiện riêng: dấu trang đã lưu xong, chỉ con số thống kê cũ đi.
      if (result.ok) set({ stats: result.data });
    } catch {
      // Cùng lý do trên — nuốt ở đây là có chủ đích, không phải bỏ sót.
    }
  };

  return {
    entries: [],
    stats: null,
    bookId: null,
    loading: false,
    error: null,

    load: async (bookId) => {
      set({ loading: true, error: null, bookId });
      try {
        // Song song: hai kênh độc lập, chờ nối tiếp là gấp đôi thời gian mở màn.
        const [listResult, statsResult] = await Promise.all([
          window.api.bookmarks.list(bookId),
          window.api.library.getStats(bookId),
        ]);

        if (!listResult.ok) {
          set({ error: listResult.error.message, loading: false });
          return;
        }

        set({
          entries: listResult.data,
          // Thống kê hỏng không làm hỏng cả màn: danh sách dấu trang vẫn dùng
          // được, phần thống kê tự ẩn khi `stats` là `null`.
          stats: statsResult.ok ? statsResult.data : null,
          loading: false,
        });
      } catch (e) {
        set({ error: `${IPC_FAILED} (${errorMessage(e)})`, loading: false });
      }
    },

    add: async (segmentId, note) => {
      const { bookId } = get();
      if (bookId === null) {
        set({ error: 'Chưa mở sách nào nên không đánh dấu được.' });
        return false;
      }

      set({ error: null });
      try {
        const result = await window.api.bookmarks.add({
          bookId,
          segmentId,
          ...(note === undefined ? {} : { note }),
        });
        if (!result.ok) {
          set({ error: result.error.message });
          return false;
        }

        // Nạp lại cả danh sách thay vì chèn vào cuối: thứ tự là **mạch đọc**
        // (chương rồi đoạn), mà chèn cuối thì dấu trang mới ở chương 2 nằm sau
        // dấu trang cũ ở chương 9.
        const listResult = await window.api.bookmarks.list(bookId);
        if (listResult.ok) set({ entries: listResult.data });
        await refreshStats(bookId);
        return true;
      } catch (e) {
        set({ error: `${IPC_FAILED} (${errorMessage(e)})` });
        return false;
      }
    },

    updateNote: async (id, note) => {
      set({ error: null });
      try {
        const result = await window.api.bookmarks.updateNote({ id, note });
        if (!result.ok) {
          set({ error: result.error.message });
          return false;
        }

        // Sửa ghi chú không đổi vị trí trong danh sách nên thay tại chỗ là đủ —
        // khác `add`, chỗ này không có đường nào làm lệch thứ tự.
        set((s) => ({
          entries: s.entries.map((e) => (e.bookmark.id === id ? result.data : e)),
        }));
        return true;
      } catch (e) {
        set({ error: `${IPC_FAILED} (${errorMessage(e)})` });
        return false;
      }
    },

    remove: async (id) => {
      const { bookId } = get();
      set({ error: null });
      try {
        const result = await window.api.bookmarks.remove(id);
        if (!result.ok) {
          set({ error: result.error.message });
          return;
        }
        set((s) => ({ entries: s.entries.filter((e) => e.bookmark.id !== id) }));
        if (bookId !== null) await refreshStats(bookId);
      } catch (e) {
        set({ error: `${IPC_FAILED} (${errorMessage(e)})` });
      }
    },

    reset: () => set({ entries: [], stats: null, bookId: null, error: null, loading: false }),

    clearError: () => set({ error: null }),
  };
});
