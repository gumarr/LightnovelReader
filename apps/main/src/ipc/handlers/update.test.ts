import { describe, expect, it, vi } from 'vitest';
import type { UpdateStatus } from '@ln/shared';
import { createUpdateHandlers } from './update.js';
import type { UpdateService } from '../../services/update-service.js';

const status: UpdateStatus = { state: 'available', currentVersion: '0.1.0', availableVersion: '0.2.0' };

const createFakeService = (over: Partial<UpdateService> = {}): UpdateService => ({
  getStatus: () => status,
  check: () => Promise.resolve(status),
  download: () => Promise.resolve(status),
  quitAndInstall: () => true,
  ...over,
});

describe('createUpdateHandlers', () => {
  it('getStatus trả ok kèm trạng thái', () => {
    const handlers = createUpdateHandlers({ service: createFakeService() });
    expect(handlers.getStatus()).toEqual({ ok: true, data: status });
  });

  it('check gọi xuống service và bọc ok', async () => {
    const check = vi.fn(() => Promise.resolve(status));
    const handlers = createUpdateHandlers({ service: createFakeService({ check }) });

    await expect(handlers.check()).resolves.toEqual({ ok: true, data: status });
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('check của IPC KHÔNG silent — user bấm thì lỗi phải vào log', async () => {
    // Lượt nền lúc khởi động gọi thẳng service với `silent: true`. Kênh IPC này
    // chỉ chạy khi user bấm, và lúc đó lỗi là thứ họ đang chờ nghe.
    const check = vi.fn(() => Promise.resolve(status));
    const handlers = createUpdateHandlers({ service: createFakeService({ check }) });

    await handlers.check();
    expect(check).toHaveBeenCalledWith();
  });

  it('download bọc ok', async () => {
    const download = vi.fn(() => Promise.resolve(status));
    const handlers = createUpdateHandlers({ service: createFakeService({ download }) });

    await expect(handlers.download()).resolves.toEqual({ ok: true, data: status });
    expect(download).toHaveBeenCalledTimes(1);
  });

  it('quitAndInstall trả về false chứ không phải err khi chưa tải xong', () => {
    // `false` là **dữ liệu**, không phải lỗi IPC. Trả `err` thì renderer chỉ
    // biết "hỏng" mà không biết là do chưa tải xong.
    const handlers = createUpdateHandlers({
      service: createFakeService({ quitAndInstall: () => false }),
    });

    expect(handlers.quitAndInstall()).toEqual({ ok: true, data: false });
  });

  it('trạng thái unsupported vẫn đi qua ok, không thành lỗi', () => {
    // Bản portable/dev không cập nhật được là chuyện bình thường. Biến nó thành
    // `err` thì UI hiện chữ đỏ cho một tình huống user không làm gì được.
    const unsupported: UpdateStatus = {
      state: 'unsupported',
      currentVersion: '0.1.0',
      message: 'Bản portable không tự cập nhật được.',
    };
    const handlers = createUpdateHandlers({
      service: createFakeService({ getStatus: () => unsupported }),
    });

    expect(handlers.getStatus()).toEqual({ ok: true, data: unsupported });
  });
});
