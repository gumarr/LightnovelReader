import { BrowserWindow, shell } from 'electron';
import { join } from 'node:path';
import type { AppSettings } from '@ln/shared';

/**
 * Tạo cửa sổ chính. Frameless để dùng titlebar tự vẽ.
 *
 * Cấu hình bảo mật là bắt buộc, không được nới lỏng:
 * `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`.
 */

export type CreateWindowOptions = {
  preloadPath: string;
  /** URL dev server hoặc `undefined` khi chạy bản build */
  devServerUrl: string | undefined;
  /** File index.html của bản build */
  rendererFile: string;
  settings: AppSettings;
};

export const createMainWindow = (options: CreateWindowOptions): BrowserWindow => {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    frame: false,
    backgroundColor: options.settings.theme === 'light' ? '#ffffff' : '#0f0f11',
    webPreferences: {
      preload: options.preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });

  // Tránh nháy trắng lúc khởi động
  window.once('ready-to-show', () => window.show());

  // Link ngoài mở bằng trình duyệt hệ thống, không mở cửa sổ Electron mới
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });

  // Chặn điều hướng khỏi app — renderer không được rời khỏi trang gốc
  window.webContents.on('will-navigate', (event, url) => {
    const allowed = options.devServerUrl;
    if (allowed === undefined || !url.startsWith(allowed)) {
      event.preventDefault();
    }
  });

  if (options.devServerUrl !== undefined) {
    void window.loadURL(options.devServerUrl);
  } else {
    void window.loadFile(options.rendererFile);
  }

  return window;
};

export const resolvePreloadPath = (appRoot: string): string =>
  join(appRoot, 'preload', 'index.cjs');

export const resolveRendererFile = (appRoot: string): string =>
  join(appRoot, 'renderer', 'index.html');
