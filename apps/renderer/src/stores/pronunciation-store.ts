import { create } from 'zustand';
import { errorMessage, type PronunciationOverride } from '@ln/shared';

/**
 * Phiên âm do user sửa — tầng 3 của plan.md mục 8.1.
 *
 * Danh sách giữ **cả mục toàn cục lẫn mục của sách đang mở**, đúng thứ main trả
 * về: user cần thấy vì sao một từ đang được đọc như vậy, mà nguyên nhân có thể
 * nằm ở mục toàn cục đặt từ nhiều tháng trước.
 *
 * **Không đụng tới hàng đợi generate.** Sửa cách đọc xong, audio cũ vẫn nằm trên
 * đĩa với cách đọc cũ. Store chỉ giữ cờ `dirty` để UI nhắc; quyết định tạo lại
 * là của user (CLAUDE.md cấm generate hàng loạt mà không hiện ước lượng trước).
 */

const IPC_FAILED = 'Không kết nối được tiến trình chính. Hãy khởi động lại ứng dụng.';

export type PronunciationState = {
  /** Mục của sách đang mở + mục toàn cục */
  entries: PronunciationOverride[];
  /** Sách đang mở, `null` khi chưa mở sách nào */
  bookId: string | null;
  loading: boolean;
  error: string | null;
  /**
   * Đã sửa phiên âm kể từ lần generate gần nhất.
   *
   * Chỉ là gợi ý cho UI ("audio cũ vẫn đọc theo cách cũ"), không phải trạng
   * thái thật của đĩa — đóng app rồi mở lại là mất. Đúng mức cần thiết: nhắc
   * đúng lúc user vừa sửa, không phải theo dõi lâu dài.
   */
  dirty: boolean;

  load: (bookId: string) => Promise<void>;
  save: (input: { term: string; replacement: string; global: boolean }) => Promise<boolean>;
  remove: (id: string) => Promise<void>;
  clearError: () => void;
  clearDirty: () => void;
};

export const usePronunciationStore = create<PronunciationState>((set, get) => ({
  entries: [],
  bookId: null,
  loading: false,
  error: null,
  dirty: false,

  load: async (bookId) => {
    set({ loading: true, error: null, bookId });
    try {
      const result = await window.api.pronunciations.list(bookId);
      if (result.ok) set({ entries: result.data, loading: false });
      else set({ error: result.error.message, loading: false });
    } catch (e) {
      set({ error: `${IPC_FAILED} (${errorMessage(e)})`, loading: false });
    }
  },

  save: async ({ term, replacement, global }) => {
    const { bookId } = get();
    // Mục theo sách cần biết là sách nào. Mở dialog từ trình đọc thì luôn có,
    // nhưng chặn ở đây để không gửi request chắc chắn hỏng.
    if (!global && bookId === null) {
      set({ error: 'Chưa mở sách nào nên không lưu riêng cho sách được.' });
      return false;
    }

    set({ error: null });
    try {
      const result = await window.api.pronunciations.save({
        ...(global || bookId === null ? {} : { bookId }),
        term,
        replacement,
      });
      if (!result.ok) {
        set({ error: result.error.message });
        return false;
      }

      // Nạp lại thay vì tự chèn vào mảng: `save` có thể **ghi đè** một mục đã
      // có, nên chèn thêm sẽ ra hai dòng cùng `term`.
      if (bookId !== null) await get().load(bookId);
      set({ dirty: true });
      return true;
    } catch (e) {
      set({ error: `${IPC_FAILED} (${errorMessage(e)})` });
      return false;
    }
  },

  remove: async (id) => {
    try {
      const result = await window.api.pronunciations.remove(id);
      if (!result.ok) {
        set({ error: result.error.message });
        return;
      }
      set((s) => ({ entries: s.entries.filter((e) => e.id !== id), dirty: true }));
    } catch (e) {
      set({ error: `${IPC_FAILED} (${errorMessage(e)})` });
    }
  },

  clearError: () => set({ error: null }),
  clearDirty: () => set({ dirty: false }),
}));
