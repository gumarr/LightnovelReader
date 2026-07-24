import { describe, expect, it, vi } from 'vitest';
import { ok, type AppInfo, type Result } from '@ln/shared';
import { InvalidInputError, wrapHandler, type IpcLogger } from './wrap.js';

const silentLogger = (): IpcLogger & { calls: string[] } => {
  const calls: string[] = [];
  return { calls, error: (msg, detail) => calls.push(`${msg} :: ${detail}`) };
};

const logSpy = (): IpcLogger => ({ error: vi.fn() });

const appInfo: AppInfo = {
  version: '0.1.0',
  electronVersion: '33.0.0',
  chromeVersion: '130',
  nodeVersion: '20',
  platform: 'win32',
  userDataPath: 'C:\\ud',
};

describe('wrapHandler', () => {
  it('trả nguyên kết quả khi handler thành công', async () => {
    const wrapped = wrapHandler('app:getInfo', () => ok(appInfo), silentLogger());
    await expect(wrapped(undefined)).resolves.toEqual({ ok: true, data: appInfo });
  });

  it('hỗ trợ handler bất đồng bộ', async () => {
    const wrapped = wrapHandler(
      'app:getInfo',
      async () => Promise.resolve(ok(appInfo)),
      silentLogger(),
    );
    await expect(wrapped(undefined)).resolves.toMatchObject({ ok: true });
  });

  it('biến exception thành Result lỗi thay vì throw qua IPC', async () => {
    const wrapped = wrapHandler(
      'app:getInfo',
      () => {
        throw new Error('ổ đĩa lỗi');
      },
      silentLogger(),
    );

    const result = (await wrapped(undefined)) as Result<never>;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('UNKNOWN');
      expect(result.error.detail).toBe('ổ đĩa lỗi');
    }
  });

  it('promise reject cũng thành Result lỗi', async () => {
    const wrapped = wrapHandler(
      'app:getInfo',
      () => Promise.reject(new Error('bùm')),
      silentLogger(),
    );
    await expect(wrapped(undefined)).resolves.toMatchObject({ ok: false });
  });

  it('InvalidInputError thành mã INVALID_INPUT với message gốc', async () => {
    const wrapped = wrapHandler(
      'settings:setTheme',
      () => {
        throw new InvalidInputError('theme phải là light/dark/system');
      },
      silentLogger(),
    );

    const result = (await wrapped('tím')) as Result<never>;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_INPUT');
      expect(result.error.message).toBe('theme phải là light/dark/system');
    }
  });

  it('ghi log kèm stack khi có lỗi', async () => {
    const logger = silentLogger();
    const wrapped = wrapHandler(
      'app:getInfo',
      () => {
        throw new Error('lỗi có stack');
      },
      logger,
    );

    await wrapped(undefined);
    expect(logger.calls).toHaveLength(1);
    expect(logger.calls[0]).toContain('app:getInfo');
    expect(logger.calls[0]).toContain('lỗi có stack');
  });

  it('không log khi handler chạy bình thường', async () => {
    const logger = logSpy();
    const wrapped = wrapHandler('app:getInfo', () => ok(appInfo), logger);
    await wrapped(undefined);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('xử lý được giá trị throw không phải Error', async () => {
    const wrapped = wrapHandler(
      'app:getInfo',
      () => {
        throw 'chuỗi thô';
      },
      silentLogger(),
    );

    const result = (await wrapped(undefined)) as Result<never>;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.detail).toBe('chuỗi thô');
  });

  it('kết quả lỗi serialize được qua structured clone của IPC', async () => {
    const wrapped = wrapHandler(
      'app:getInfo',
      () => {
        throw new Error('lỗi');
      },
      silentLogger(),
    );

    const result = await wrapped(undefined);
    expect(() => structuredClone(result)).not.toThrow();
  });
});
