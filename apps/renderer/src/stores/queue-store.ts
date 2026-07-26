import { create } from 'zustand';
import {
  errorMessage,
  JOB_PRIORITY_PREFETCH,
  type GenerateEstimateInfo,
  type QueueStatusInfo,
  type Result,
} from '@ln/shared';

/**
 * State hàng đợi generate. Nguồn sự thật nằm trong SQLite ở main — store chỉ
 * giữ bản sao mới nhất mà main đẩy xuống.
 *
 * **Không hỏi vòng.** Một lượt "generate cả sách" chạy hàng giờ mà không có
 * tương tác nào; hỏi vòng thì hoặc UI trễ, hoặc phí IPC liên tục. `status` cập
 * nhật qua event `queue:statusChanged`, còn `queue:segmentUpdated` cho biết
 * segment nào vừa đổi để reader đổi nút phát mà không tải lại cả danh sách.
 */

/** Xem PROGRESS.md mục 4.3 — invoke vẫn reject được dù handler không throw */
const IPC_FAILED = 'Không kết nối được tiến trình chính. Hãy khởi động lại ứng dụng.';

export type QueueStoreState = {
  /** `null` khi chưa nạp lần nào */
  status: QueueStatusInfo | null;
  /** Lỗi gần nhất, hiện cho user thay vì nuốt im lặng */
  error: string | null;
  /**
   * Chương đã prefetch trong phiên này.
   *
   * Giữ ở đây chứ không ở component: đọc qua lại giữa hai chương sẽ dựng lại
   * component, mà xếp lại chương đã prefetch là một lượt IPC vô ích mỗi lần.
   */
  prefetched: string[];

  loadStatus: () => Promise<void>;
  applyStatus: (status: QueueStatusInfo) => void;
  enqueueChapter: (chapterId: string) => Promise<number>;
  enqueueBook: (bookId: string) => Promise<number>;
  /** Xếp trước chương kế. Gọi nhiều lần với cùng `chapterId` chỉ chạy một lần. */
  prefetchChapter: (chapterId: string) => Promise<void>;
  estimateChapter: (chapterId: string) => Promise<GenerateEstimateInfo | null>;
  estimateBook: (bookId: string) => Promise<GenerateEstimateInfo | null>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  cancelAll: () => Promise<void>;
  cancelBook: (bookId: string) => Promise<void>;
  clearError: () => void;
};

/** Số job còn phải chạy — dùng cho thanh tiến độ và nhãn "đang chạy" */
export const pendingCountOf = (status: QueueStatusInfo | null): number =>
  status === null ? 0 : status.queued + status.running;

/** Hàng đợi có việc đang chạy hoặc đang chờ */
export const isBusyOf = (status: QueueStatusInfo | null): boolean => pendingCountOf(status) > 0;

export const useQueueStore = create<QueueStoreState>((set, get) => {
  /**
   * Gọi IPC rồi ghi lỗi vào store. Trả `undefined` khi hỏng.
   *
   * Mọi hàm dưới đây đều cần đúng một mẫu try/catch + kiểm `result.ok`; viết lại
   * mười lần là mười chỗ có thể quên bắt rejection.
   *
   * `clearOnSuccess: false` cho lượt gọi **phụ** (nạp lại trạng thái sau khi xếp
   * hàng): lượt phụ thành công không có nghĩa việc user vừa yêu cầu đã thành
   * công, mà xoá lỗi ở đó thì thông báo biến mất trước khi user đọc được.
   */
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

  /** Nạp lại trạng thái sau một hành động — không được xoá lỗi của hành động đó */
  const refresh = async (): Promise<void> => {
    const status = await call(() => window.api.queue.getStatus(), false);
    if (status !== undefined) set({ status });
  };

  return {
    status: null,
    error: null,
    prefetched: [],

    loadStatus: async () => {
      const status = await call(() => window.api.queue.getStatus());
      if (status !== undefined) set({ status });
    },

    applyStatus: (status) => set({ status }),

    enqueueChapter: async (chapterId) => {
      const result = await call(() => window.api.queue.enqueueChapter({ chapterId }));
      // Main đẩy `queue:statusChanged` ngay sau khi xếp, nhưng nạp lại luôn để
      // UI đúng cả khi event bị bỏ lỡ (vừa mở màn, chưa kịp đăng ký listener).
      await refresh();
      return result?.added ?? 0;
    },

    enqueueBook: async (bookId) => {
      const result = await call(() => window.api.queue.enqueueBook(bookId));
      await refresh();
      return result?.added ?? 0;
    },

    prefetchChapter: async (chapterId) => {
      if (get().prefetched.includes(chapterId)) return;
      // Ghi nhận TRƯỚC khi gọi: `await` cho phép lượt cuộn kế tiếp chen vào giữa
      // và gọi lần thứ hai cho cùng chương.
      set((s) => ({ prefetched: [...s.prefetched, chapterId] }));

      const result = await call(() =>
        window.api.queue.enqueueChapter({ chapterId, priority: JOB_PRIORITY_PREFETCH }),
      );
      // Prefetch hỏng thì bỏ dấu để lần cuộn sau thử lại — đây là việc chạy ngầm
      // user không yêu cầu, không đáng chặn vĩnh viễn vì một lần lỗi.
      if (result === undefined) {
        set((s) => ({ prefetched: s.prefetched.filter((id) => id !== chapterId) }));
        return;
      }
      await refresh();
    },

    estimateChapter: async (chapterId) =>
      (await call(() => window.api.queue.estimateChapter(chapterId))) ?? null,

    estimateBook: async (bookId) =>
      (await call(() => window.api.queue.estimateBook(bookId))) ?? null,

    pause: async () => {
      const status = await call(() => window.api.queue.pause());
      if (status !== undefined) set({ status });
    },

    resume: async () => {
      const status = await call(() => window.api.queue.resume());
      if (status !== undefined) set({ status });
    },

    cancelAll: async () => {
      await call(() => window.api.queue.cancelAll());
      await refresh();
    },

    cancelBook: async (bookId) => {
      await call(() => window.api.queue.cancelBook(bookId));
      await refresh();
    },

    clearError: () => set({ error: null }),
  };
});
