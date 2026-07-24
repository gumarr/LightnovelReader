import type { BrowserWindow } from 'electron';
import { err, ok, type Result, type WindowState } from '@ln/shared';

/**
 * Handler cho titlebar tự vẽ (frameless) — nút thu nhỏ / phóng to / đóng.
 */

export const readWindowState = (window: BrowserWindow): WindowState => ({
  isMaximized: window.isMaximized(),
  isFullScreen: window.isFullScreen(),
});

export type WindowHandlers = {
  minimize: () => Result<void>;
  toggleMaximize: () => Result<WindowState>;
  close: () => Result<void>;
  getState: () => Result<WindowState>;
};

export const createWindowHandlers = (
  getWindow: () => BrowserWindow | null,
): WindowHandlers => {
  const withWindow = <T>(fn: (window: BrowserWindow) => T): Result<T> => {
    const window = getWindow();
    if (window === null || window.isDestroyed()) {
      return err('NOT_FOUND', 'Cửa sổ không còn tồn tại');
    }
    return ok(fn(window));
  };

  return {
    minimize: () => withWindow((w) => w.minimize()),

    toggleMaximize: () =>
      withWindow((w) => {
        if (w.isMaximized()) w.unmaximize();
        else w.maximize();
        return readWindowState(w);
      }),

    close: () => withWindow((w) => w.close()),

    getState: () => withWindow(readWindowState),
  };
};
