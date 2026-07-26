import { describe, expect, it } from 'vitest';
import type { SidecarStatus } from '@ln/shared';
import { createSidecarHandlers } from './sidecar.js';

describe('createSidecarHandlers', () => {
  const statusOf = (status: SidecarStatus) => createSidecarHandlers({ getStatus: () => status });

  it('trả trạng thái hiện tại', () => {
    const handlers = statusOf({ state: 'ready', restarts: 0, port: 50123, engineReady: false });

    expect(handlers.getStatus()).toEqual({
      ok: true,
      data: { state: 'ready', restarts: 0, port: 50123, engineReady: false },
    });
  });

  it('sidecar hỏng vẫn trả ok — lỗi nằm trong `state`, không phải lỗi lời gọi IPC', () => {
    // Trả `err` thì renderer mất luôn `message` giải thích vì sao hỏng.
    const handlers = statusOf({
      state: 'failed',
      restarts: 3,
      engineReady: false,
      message: 'Dịch vụ TTS không khởi động được sau 3 lần thử.',
    });

    const result = handlers.getStatus();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.state).toBe('failed');
    expect(result.data.message).toContain('3 lần');
  });

  it('đọc lại mỗi lần gọi, không giữ ảnh chụp cũ', () => {
    let current: SidecarStatus = { state: 'starting', restarts: 0, engineReady: false };
    const handlers = createSidecarHandlers({ getStatus: () => current });

    expect(handlers.getStatus()).toMatchObject({ data: { state: 'starting' } });

    current = { state: 'ready', restarts: 0, port: 1, engineReady: true };

    expect(handlers.getStatus()).toMatchObject({ data: { state: 'ready', engineReady: true } });
  });
});
