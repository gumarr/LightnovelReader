import { create } from 'zustand';
import {
  errorMessage,
  type SidecarStatus,
  type VoiceCatalogItem,
  type VoiceDownloadProgress,
} from '@ln/shared';

/**
 * State voice manager. Nguồn sự thật nằm ở sidecar — store chỉ giữ bản sao.
 *
 * **Tiến độ tải giữ riêng theo `voiceId`**, không nhét vào từng mục catalog:
 * danh sách catalog được nạp lại sau mỗi lần tải xong, mà gộp hai thứ vào một
 * chỗ thì mỗi lần nạp lại là mất tiến độ của voice đang tải dở khác.
 */

const IPC_FAILED = 'Không kết nối được tiến trình chính. Hãy khởi động lại ứng dụng.';

export type VoiceState = {
  catalog: VoiceCatalogItem[];
  /** Tiến độ theo voiceId. Không có khoá = voice đó không tải */
  progress: Record<string, VoiceDownloadProgress>;
  loading: boolean;
  error: string | null;
  /** Trạng thái sidecar — UI chặn nút tải khi chưa `ready` */
  sidecar: SidecarStatus | null;

  load: () => Promise<void>;
  download: (voiceId: string) => Promise<void>;
  cancel: (voiceId: string) => Promise<void>;
  remove: (voiceId: string) => Promise<void>;
  applyProgress: (progress: VoiceDownloadProgress) => void;
  setSidecar: (status: SidecarStatus) => void;
  clearError: () => void;
};

export const useVoiceStore = create<VoiceState>((set, get) => ({
  catalog: [],
  progress: {},
  loading: false,
  error: null,
  sidecar: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const [catalog, status] = await Promise.all([
        window.api.voices.listCatalog(),
        window.api.sidecar.getStatus(),
      ]);

      if (status.ok) set({ sidecar: status.data });

      if (catalog.ok) set({ catalog: catalog.data, loading: false });
      else set({ error: catalog.error.message, loading: false });
    } catch (e) {
      set({ error: `${IPC_FAILED} (${errorMessage(e)})`, loading: false });
    }
  },

  download: async (voiceId) => {
    // Đặt mốc 0% ngay tại chỗ, không chờ khung SSE đầu tiên: sidecar mất một
    // lúc mới nối được tới Hugging Face, mà nút bấm rồi không đổi gì thì user
    // sẽ bấm lại lần nữa.
    set((s) => ({
      progress: {
        ...s.progress,
        [voiceId]: { voiceId, state: 'downloading', receivedBytes: 0, totalBytes: 0 },
      },
      error: null,
    }));

    try {
      const result = await window.api.voices.download(voiceId);
      if (!result.ok) {
        set((s) => {
          const next = { ...s.progress };
          delete next[voiceId];
          return { progress: next, error: result.error.message };
        });
      }
    } catch (e) {
      set((s) => {
        const next = { ...s.progress };
        delete next[voiceId];
        return { progress: next, error: `${IPC_FAILED} (${errorMessage(e)})` };
      });
    }
  },

  cancel: async (voiceId) => {
    try {
      await window.api.voices.cancelDownload(voiceId);
    } catch (e) {
      set({ error: `${IPC_FAILED} (${errorMessage(e)})` });
    }
    // Xoá tiến độ ngay: lượt tải bị huỷ không bao giờ gửi thêm khung nào nữa,
    // để lại thanh tiến trình đứng im trông như đang treo.
    set((s) => {
      const next = { ...s.progress };
      delete next[voiceId];
      return { progress: next };
    });
  },

  remove: async (voiceId) => {
    try {
      const result = await window.api.voices.remove(voiceId);
      if (!result.ok) {
        set({ error: result.error.message });
        return;
      }
      await get().load();
    } catch (e) {
      set({ error: `${IPC_FAILED} (${errorMessage(e)})` });
    }
  },

  applyProgress: (progress) => {
    if (progress.state === 'done') {
      // Tải xong thì bỏ tiến độ và nạp lại catalog để cờ `installed` đổi theo.
      set((s) => {
        const next = { ...s.progress };
        delete next[progress.voiceId];
        return { progress: next };
      });
      void get().load();
      return;
    }

    if (progress.state === 'error') {
      set((s) => {
        const next = { ...s.progress };
        delete next[progress.voiceId];
        return {
          progress: next,
          error: progress.message ?? 'Tải giọng đọc thất bại.',
        };
      });
      return;
    }

    set((s) => ({ progress: { ...s.progress, [progress.voiceId]: progress } }));
  },

  setSidecar: (status) => set({ sidecar: status }),

  clearError: () => set({ error: null }),
}));
