import { vi } from 'vitest';
import { DEFAULT_SETTINGS, ok, type AppSettings, type WindowState } from '@ln/shared';

/**
 * `window.api` giả cho test renderer — thay cho preload thật vốn cần Electron.
 * Test có thể can thiệp từng hàm để mô phỏng lỗi hoặc thay đổi từ main.
 */

export type FakeApi = ReturnType<typeof createFakeApi>;

export type FakeApiOptions = {
  settings?: Partial<AppSettings>;
  windowState?: Partial<WindowState>;
};

export const createFakeApi = (options: FakeApiOptions = {}) => {
  let settings: AppSettings = {
    ...DEFAULT_SETTINGS,
    audioDir: 'E:\\ln-audio',
    ...options.settings,
  };

  let windowState: WindowState = {
    isMaximized: false,
    isFullScreen: false,
    ...options.windowState,
  };

  const settingsListeners = new Set<(s: AppSettings) => void>();
  const windowListeners = new Set<(s: WindowState) => void>();

  const api = {
    app: {
      getInfo: vi.fn(async () =>
        ok({
          version: '0.1.0',
          electronVersion: '33.0.0',
          chromeVersion: '130.0.0',
          nodeVersion: '20.18.0',
          platform: 'win32',
          userDataPath: 'C:\\ud',
        }),
      ),
    },

    settings: {
      getAll: vi.fn(async () => ok(settings)),
      update: vi.fn(async (patch: Partial<AppSettings>) => {
        settings = { ...settings, ...patch };
        return ok(settings);
      }),
      setTheme: vi.fn(async (theme: AppSettings['theme']) => {
        settings = { ...settings, theme };
        return ok(settings);
      }),
      pickAudioDir: vi.fn(async () => ok(null)),
      onChanged: vi.fn((listener: (s: AppSettings) => void) => {
        settingsListeners.add(listener);
        return () => settingsListeners.delete(listener);
      }),
    },

    window: {
      minimize: vi.fn(async () => ok(undefined)),
      toggleMaximize: vi.fn(async () => {
        windowState = { ...windowState, isMaximized: !windowState.isMaximized };
        for (const l of windowListeners) l(windowState);
        return ok(windowState);
      }),
      close: vi.fn(async () => ok(undefined)),
      getState: vi.fn(async () => ok(windowState)),
      onStateChanged: vi.fn((listener: (s: WindowState) => void) => {
        windowListeners.add(listener);
        return () => windowListeners.delete(listener);
      }),
    },
  };

  return {
    api,
    /** Mô phỏng main đẩy event settings:changed */
    emitSettingsChanged: (next: AppSettings) => {
      settings = next;
      for (const l of settingsListeners) l(next);
    },
    getSettings: () => settings,
    settingsListenerCount: () => settingsListeners.size,
    windowListenerCount: () => windowListeners.size,
  };
};

/** Gắn api giả vào `window` và trả về handle để test điều khiển */
export const installFakeApi = (options: FakeApiOptions = {}): FakeApi => {
  const fake = createFakeApi(options);
  vi.stubGlobal('api', fake.api);
  Object.defineProperty(window, 'api', { value: fake.api, configurable: true, writable: true });
  return fake;
};
