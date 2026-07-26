import { create } from 'zustand';
import {
  errorMessage,
  type ChapterUsageInfo,
  type DeleteAudioResultInfo,
  type Result,
  type StorageUsageInfo,
} from '@ln/shared';

/**
 * State cho Storage Manager.
 *
 * Số liệu **không** cache lâu: `getUsage` có quét thư mục audio, nên con số đổi
 * mỗi khi hàng đợi ghi xong một segment. Nạp lại sau mỗi lượt xoá thay vì tự
 * tính trừ ở renderer — trừ tay thì hai bên lệch dần và không ai biết bên nào
 * đúng.
 */

/** Xem PROGRESS.md mục 4.3 — invoke vẫn reject được dù handler không throw */
const IPC_FAILED = 'Không kết nối được tiến trình chính. Hãy khởi động lại ứng dụng.';

export type StorageStoreState = {
  /** `null` khi chưa nạp lần nào */
  usage: StorageUsageInfo | null;
  /** Dung lượng theo chương của sách đang mở rộng. Rỗng khi chưa mở sách nào */
  chapters: ChapterUsageInfo[];
  /** Sách đang xem chi tiết chương. `null` = đang xem danh sách */
  expandedBookId: string | null;
  loading: boolean;
  /** `true` trong lúc xoá — chặn bấm hai lần vào cùng một lượt xoá */
  deleting: boolean;
  error: string | null;
  /** Kết quả lượt xoá gần nhất, để nói "đã giải phóng X" */
  lastDeleted: DeleteAudioResultInfo | null;

  load: () => Promise<void>;
  expandBook: (bookId: string | null) => Promise<void>;
  deleteChapterAudio: (chapterId: string) => Promise<void>;
  deleteBookAudio: (bookId: string) => Promise<void>;
  deleteReadAudio: (bookId: string) => Promise<void>;
  deleteOrphans: () => Promise<void>;
  clearError: () => void;
  clearLastDeleted: () => void;
};

/** Tổng chỗ chiếm: audio + bản copy sách gốc. Sách gốc cũng nặng vài chục MB */
export const totalBytesOf = (usage: StorageUsageInfo | null): number =>
  usage === null
    ? 0
    : usage.audioBytes + usage.books.reduce((sum, book) => sum + book.bookFileBytes, 0);

/** Đã vượt ngưỡng user đặt. `warnBytes` = 0 nghĩa là user tắt cảnh báo */
export const isOverWarnThreshold = (usage: StorageUsageInfo | null): boolean =>
  usage !== null && usage.warnBytes > 0 && usage.audioBytes > usage.warnBytes;

/**
 * DB và đĩa lệch nhau quá mức làm tròn.
 *
 * Không so bằng `!==`: `audioBytesOnDisk` gồm cả file `.json` timing mà
 * `audioBytes` không đếm, nên lệch nhỏ là bình thường. Chỉ coi là bất thường
 * khi có file mồ côi thật sự — thứ user cần bấm dọn.
 */
export const hasOrphans = (usage: StorageUsageInfo | null): boolean =>
  usage !== null && usage.orphanFiles > 0;

export const useStorageStore = create<StorageStoreState>((set, get) => {
  const call = async <T>(
    run: () => Promise<Result<T>>,
    clearOnSuccess = true,
  ): Promise<T | undefined> => {
    try {
      const result = await run();
      if (result.ok) {
        if (clearOnSuccess) set({ error: null });
        return result.data;
      }
      set({ error: result.error.message });
      return undefined;
    } catch (e) {
      set({ error: `${IPC_FAILED} (${errorMessage(e)})` });
      return undefined;
    }
  };

  /**
   * Nạp lại số liệu sau một lượt xoá — **không** được xoá lỗi của lượt xoá đó.
   *
   * Cùng cái bẫy đã sửa ở `queue-store`: lượt nạp lại thành công sẽ ghi
   * `error: null` và thông báo hỏng biến mất trước khi user đọc được.
   */
  const refresh = async (): Promise<void> => {
    const usage = await call(() => window.api.storage.getUsage(), false);
    if (usage !== undefined) set({ usage });

    // Đang mở chi tiết chương thì nạp lại luôn, nếu không bảng chương vẫn hiện
    // dung lượng cũ của chương vừa xoá.
    const bookId = get().expandedBookId;
    if (bookId === null) return;
    const chapters = await call(() => window.api.storage.getChapterUsage(bookId), false);
    if (chapters !== undefined) set({ chapters });
  };

  /** Một lượt xoá: chặn bấm trùng, ghi kết quả, rồi nạp lại số thật */
  const runDelete = async (
    run: () => Promise<Result<DeleteAudioResultInfo>>,
  ): Promise<void> => {
    if (get().deleting) return;
    set({ deleting: true, lastDeleted: null });

    try {
      const result = await call(run);
      if (result !== undefined) set({ lastDeleted: result });
      await refresh();
    } finally {
      // `finally` chứ không đặt sau `refresh`: lượt nạp lại ném thì cờ vẫn phải
      // hạ, nếu không mọi nút xoá bị vô hiệu tới khi user mở lại màn hình.
      set({ deleting: false });
    }
  };

  return {
    usage: null,
    chapters: [],
    expandedBookId: null,
    loading: false,
    deleting: false,
    error: null,
    lastDeleted: null,

    load: async () => {
      set({ loading: true });
      try {
        const usage = await call(() => window.api.storage.getUsage());
        if (usage !== undefined) set({ usage });
      } finally {
        set({ loading: false });
      }
    },

    expandBook: async (bookId) => {
      // Đóng lại: xoá danh sách chương luôn để lần mở sách khác không nhấp nháy
      // dữ liệu của sách trước.
      if (bookId === null) {
        set({ expandedBookId: null, chapters: [] });
        return;
      }

      set({ expandedBookId: bookId, chapters: [] });
      const chapters = await call(() => window.api.storage.getChapterUsage(bookId));
      if (chapters !== undefined) set({ chapters });
    },

    deleteChapterAudio: async (chapterId) => {
      await runDelete(() => window.api.storage.deleteChapterAudio(chapterId));
    },

    deleteBookAudio: async (bookId) => {
      await runDelete(() => window.api.storage.deleteBookAudio(bookId));
    },

    deleteReadAudio: async (bookId) => {
      await runDelete(() => window.api.storage.deleteReadAudio(bookId));
    },

    deleteOrphans: async () => {
      await runDelete(() => window.api.storage.deleteOrphans());
    },

    clearError: () => set({ error: null }),
    clearLastDeleted: () => set({ lastDeleted: null }),
  };
});
