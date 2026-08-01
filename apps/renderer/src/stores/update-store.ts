import { create } from 'zustand';
import { errorMessage, type Result, type UpdateStatus } from '@ln/shared';

/**
 * State auto-update phía renderer (P5.5c). Nguồn sự thật là máy trạng thái ở
 * main (`services/update-service.ts`) — store chỉ giữ bản sao mới nhất.
 *
 * **Trạng thái tới qua event, không qua giá trị trả về.** `check()` và
 * `download()` trả `UpdateStatus` *tại thời điểm hàm kết thúc*, mà cả hai đều
 * kết thúc **trước** khi việc thật xong: `checkForUpdates()` trả về rồi sự kiện
 * `update-available` mới bắn, còn tải thì chạy hàng phút. Nếu chỉ đọc giá trị
 * trả về thì UI đứng im ở `checking` mãi. Vì vậy `subscribe()` là đường chính,
 * còn giá trị trả về chỉ dùng để bắt ca hỏng ngay lập tức.
 *
 * `error` ở đây **khác** `status.state === 'error'`: cái này là IPC không tới
 * được main, cái kia là main đã trả lời rằng cập nhật hỏng.
 */

/** Xem PROGRESS.md mục 4.3 — invoke vẫn reject được dù handler không throw */
const IPC_FAILED = 'Không kết nối được tiến trình chính. Hãy khởi động lại ứng dụng.';

export type UpdateStoreState = {
  /** `null` khi chưa nạp lần nào — khác `idle` vốn là "đã hỏi, không có gì mới" */
  status: UpdateStatus | null;
  /** Lỗi đường IPC, hiện cho user thay vì nuốt im lặng */
  error: string | null;
  /**
   * User đã đóng dải báo bản mới trong phiên này.
   *
   * Chỉ giữ trong bộ nhớ, **không** ghi vào settings: đóng dải báo là "để tôi
   * yên lúc này", không phải "đừng bao giờ báo nữa". Mở lại app thì báo lại —
   * bản cập nhật vẫn còn đó và vẫn đáng cài.
   */
  dismissed: boolean;

  load: () => Promise<void>;
  check: () => Promise<void>;
  download: () => Promise<void>;
  /**
   * Thoát app để cài. Trả `false` khi main từ chối (chưa tải xong) — nơi gọi
   * phải xử lý chứ không giả định app sắp đóng.
   */
  install: () => Promise<boolean>;
  /** Dùng khi main đẩy event `update:statusChanged` */
  applyExternal: (status: UpdateStatus) => void;
  dismiss: () => void;
  clearError: () => void;
};

export const useUpdateStore = create<UpdateStoreState>((set) => {
  /**
   * Gọi IPC rồi ghi lỗi vào store. Trả `undefined` khi hỏng.
   *
   * Cùng khuôn với `queue-store.ts`: bốn hàm dưới đây đều cần đúng một mẫu
   * try/catch + kiểm `result.ok`, viết lại bốn lần là bốn chỗ có thể quên bắt.
   */
  const call = async <T>(run: () => Promise<Result<T>>): Promise<T | undefined> => {
    try {
      const result = await run();
      if (result.ok) {
        set({ error: null });
        return result.data;
      }
      set({ error: result.error.message });
      return undefined;
    } catch (e) {
      set({ error: `${IPC_FAILED} (${errorMessage(e)})` });
      return undefined;
    }
  };

  return {
    status: null,
    error: null,
    dismissed: false,

    load: async () => {
      const status = await call(() => window.api.update.getStatus());
      if (status !== undefined) set({ status });
    },

    check: async () => {
      // Đặt `checking` ngay chứ không chờ event: user vừa bấm nút và cần thấy
      // phản hồi trong nhịp này. Main sẽ bắn `checking-for-update` ngay sau đó
      // và đè lên bằng đúng giá trị ấy — không có gì lệch.
      set((s) => (s.status === null ? s : { status: { ...s.status, state: 'checking' } }));

      const status = await call(() => window.api.update.check());
      if (status !== undefined) set({ status });
    },

    download: async () => {
      // Mở lại dải báo: user bấm tải nghĩa là họ **đang** quan tâm, và sau khi
      // tải xong dải phải hiện lại được để mời cài.
      set({ dismissed: false });
      const status = await call(() => window.api.update.download());
      if (status !== undefined) set({ status });
    },

    install: async () => {
      const started = await call(() => window.api.update.quitAndInstall());
      return started ?? false;
    },

    applyExternal: (status) => set({ status }),

    dismiss: () => set({ dismissed: true }),

    clearError: () => set({ error: null }),
  };
});
