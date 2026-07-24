import { create } from 'zustand';
import { errorMessage, type AppSettings, type AppSettingsPatch, type ThemeMode } from '@ln/shared';

/**
 * State settings phía renderer. Nguồn sự thật vẫn nằm ở main —
 * store này chỉ giữ bản sao và gọi IPC để thay đổi.
 */

export type SettingsState = {
  settings: AppSettings | null;
  /** Lỗi gần nhất từ IPC, hiển thị cho user thay vì nuốt im lặng */
  error: string | null;
  loading: boolean;
  load: () => Promise<void>;
  update: (patch: AppSettingsPatch) => Promise<void>;
  setTheme: (theme: ThemeMode) => Promise<void>;
  /** Dùng khi main đẩy event settings:changed */
  applyExternal: (settings: AppSettings) => void;
};

/**
 * Handler bên main không throw, nhưng `ipcRenderer.invoke` vẫn reject được khi
 * kênh chưa đăng ký hoặc main chết giữa chừng. Không bắt thì UI kẹt ở trạng
 * thái "Đang tải…" vĩnh viễn.
 */
const IPC_FAILED = 'Không kết nối được tiến trình chính. Hãy khởi động lại ứng dụng.';

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: null,
  error: null,
  loading: false,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const result = await window.api.settings.getAll();
      if (result.ok) set({ settings: result.data, loading: false });
      else set({ error: result.error.message, loading: false });
    } catch (e) {
      set({ error: `${IPC_FAILED} (${errorMessage(e)})`, loading: false });
    }
  },

  update: async (patch) => {
    try {
      const result = await window.api.settings.update(patch);
      if (result.ok) set({ settings: result.data, error: null });
      else set({ error: result.error.message });
    } catch (e) {
      set({ error: `${IPC_FAILED} (${errorMessage(e)})` });
    }
  },

  setTheme: async (theme) => {
    try {
      const result = await window.api.settings.setTheme(theme);
      if (result.ok) set({ settings: result.data, error: null });
      else set({ error: result.error.message });
    } catch (e) {
      set({ error: `${IPC_FAILED} (${errorMessage(e)})` });
    }
  },

  applyExternal: (settings) => set({ settings }),
}));
