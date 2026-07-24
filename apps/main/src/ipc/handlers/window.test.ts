import { describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { createWindowHandlers, readWindowState } from './window.js';

/**
 * BrowserWindow giả — chỉ có phần hành vi handler dùng tới.
 * Ép kiểu qua `unknown` vì đây là test double, không phải instance thật.
 */
type FakeWindow = {
  maximized: boolean;
  fullScreen: boolean;
  destroyed: boolean;
  closed: boolean;
  minimized: boolean;
};

const createFake = (
  overrides: Partial<FakeWindow> = {},
): { state: FakeWindow; window: BrowserWindow } => {
  const state: FakeWindow = {
    maximized: false,
    fullScreen: false,
    destroyed: false,
    closed: false,
    minimized: false,
    ...overrides,
  };

  const window = {
    isMaximized: () => state.maximized,
    isFullScreen: () => state.fullScreen,
    isDestroyed: () => state.destroyed,
    maximize: () => {
      state.maximized = true;
    },
    unmaximize: () => {
      state.maximized = false;
    },
    minimize: () => {
      state.minimized = true;
    },
    close: () => {
      state.closed = true;
    },
  } as unknown as BrowserWindow;

  return { state, window };
};

describe('readWindowState', () => {
  it('đọc đúng trạng thái maximize và fullscreen', () => {
    const { window } = createFake({ maximized: true, fullScreen: true });
    expect(readWindowState(window)).toEqual({ isMaximized: true, isFullScreen: true });
  });
});

describe('createWindowHandlers', () => {
  it('minimize thu nhỏ cửa sổ', () => {
    const { state, window } = createFake();
    const handlers = createWindowHandlers(() => window);

    expect(handlers.minimize().ok).toBe(true);
    expect(state.minimized).toBe(true);
  });

  it('toggleMaximize phóng to khi đang thường', () => {
    const { state, window } = createFake({ maximized: false });
    const result = createWindowHandlers(() => window).toggleMaximize();

    expect(state.maximized).toBe(true);
    if (result.ok) expect(result.data.isMaximized).toBe(true);
  });

  it('toggleMaximize thu nhỏ khi đang phóng to', () => {
    const { state, window } = createFake({ maximized: true });
    const result = createWindowHandlers(() => window).toggleMaximize();

    expect(state.maximized).toBe(false);
    if (result.ok) expect(result.data.isMaximized).toBe(false);
  });

  it('toggleMaximize hai lần quay về trạng thái đầu', () => {
    const { state, window } = createFake({ maximized: false });
    const handlers = createWindowHandlers(() => window);
    handlers.toggleMaximize();
    handlers.toggleMaximize();
    expect(state.maximized).toBe(false);
  });

  it('close đóng cửa sổ', () => {
    const { state, window } = createFake();
    expect(createWindowHandlers(() => window).close().ok).toBe(true);
    expect(state.closed).toBe(true);
  });

  it('getState trả về trạng thái hiện tại', () => {
    const { window } = createFake({ maximized: true });
    const result = createWindowHandlers(() => window).getState();
    if (result.ok) expect(result.data).toEqual({ isMaximized: true, isFullScreen: false });
  });

  it('trả lỗi NOT_FOUND thay vì throw khi chưa có cửa sổ', () => {
    const handlers = createWindowHandlers(() => null);
    for (const result of [
      handlers.minimize(),
      handlers.toggleMaximize(),
      handlers.close(),
      handlers.getState(),
    ]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
    }
  });

  it('trả lỗi NOT_FOUND khi cửa sổ đã bị huỷ', () => {
    const { window } = createFake({ destroyed: true });
    const result = createWindowHandlers(() => window).getState();
    expect(result.ok).toBe(false);
  });

  it('không gọi thao tác nào lên cửa sổ đã huỷ', () => {
    const { window } = createFake({ destroyed: true });
    const spy = vi.spyOn(window, 'minimize');
    createWindowHandlers(() => window).minimize();
    expect(spy).not.toHaveBeenCalled();
  });
});
