import { describe, expect, it, vi } from 'vitest';
import type { UpdateStatus } from '@ln/shared';
import {
  createUpdateService,
  type ProgressLike,
  type UpdateInfoLike,
  type UpdaterLike,
} from './update-service.js';

/**
 * Updater giả: giữ listener lại để test tự bắn sự kiện, đúng như
 * `electron-updater` bắn ra khi chạy thật.
 */
type FakeUpdater = UpdaterLike & {
  emitChecking: () => void;
  emitAvailable: (version: string) => void;
  emitNotAvailable: () => void;
  emitProgress: (progress: ProgressLike) => void;
  emitDownloaded: (version: string) => void;
  emitError: (error: Error) => void;
  checkCalls: number;
  downloadCalls: number;
  installCalls: Array<[boolean | undefined, boolean | undefined]>;
};

const createFakeUpdater = (overrides: Partial<Pick<UpdaterLike, 'checkForUpdates' | 'downloadUpdate'>> = {}): FakeUpdater => {
  const listeners = new Map<string, Array<(payload: never) => void>>();

  const add = (event: string, listener: (payload: never) => void): void => {
    const existing = listeners.get(event) ?? [];
    existing.push(listener);
    listeners.set(event, existing);
  };

  const emit = (event: string, payload?: unknown): void => {
    for (const listener of listeners.get(event) ?? []) {
      (listener as (value: unknown) => void)(payload);
    }
  };

  const fake: FakeUpdater = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    checkCalls: 0,
    downloadCalls: 0,
    installCalls: [],
    checkForUpdates: async () => {
      fake.checkCalls += 1;
      if (overrides.checkForUpdates !== undefined) return overrides.checkForUpdates();
      return Promise.resolve(undefined);
    },
    downloadUpdate: async () => {
      fake.downloadCalls += 1;
      if (overrides.downloadUpdate !== undefined) return overrides.downloadUpdate();
      return Promise.resolve(undefined);
    },
    quitAndInstall: (isSilent, isForceRunAfter) => {
      fake.installCalls.push([isSilent, isForceRunAfter]);
    },
    on: add as UpdaterLike['on'],
    emitChecking: () => {
      emit('checking-for-update');
    },
    emitAvailable: (version) => {
      emit('update-available', { version } satisfies UpdateInfoLike);
    },
    emitNotAvailable: () => {
      emit('update-not-available', { version: '0.0.0' } satisfies UpdateInfoLike);
    },
    emitProgress: (progress) => {
      emit('download-progress', progress);
    },
    emitDownloaded: (version) => {
      emit('update-downloaded', { version } satisfies UpdateInfoLike);
    },
    emitError: (error) => {
      emit('error', error);
    },
  };

  return fake;
};

const setup = (
  options: {
    updater?: FakeUpdater;
    currentVersion?: string;
    isPackaged?: boolean;
    hasUpdateConfig?: boolean;
  } = {},
) => {
  const updater = options.updater ?? createFakeUpdater();
  const seen: UpdateStatus[] = [];
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

  const service = createUpdateService({
    updater,
    currentVersion: options.currentVersion ?? '0.1.0',
    support: {
      isPackaged: options.isPackaged ?? true,
      hasUpdateConfig: options.hasUpdateConfig ?? true,
    },
    logger,
    onStatusChanged: (status) => seen.push(status),
    now: () => 1_700_000_000_000,
  });

  return { service, updater, seen, logger };
};

describe('createUpdateService — cấu hình bắt buộc', () => {
  it('TẮT autoDownload — tải 150 MB phải do user bấm', () => {
    const { updater } = setup();
    expect(updater.autoDownload).toBe(false);
  });

  it('TẮT autoInstallOnAppQuit — không thay app sau lưng user', () => {
    const { updater } = setup();
    expect(updater.autoInstallOnAppQuit).toBe(false);
  });
});

describe('createUpdateService — bản không cập nhật được', () => {
  it('bản dev vào thẳng unsupported, không gọi mạng', async () => {
    const { service, updater } = setup({ isPackaged: false, hasUpdateConfig: false });

    expect(service.getStatus().state).toBe('unsupported');
    await service.check();
    expect(updater.checkCalls).toBe(0);
  });

  it('bản portable cũng vậy, kèm câu giải thích riêng', async () => {
    const { service, updater } = setup({ isPackaged: true, hasUpdateConfig: false });

    const status = service.getStatus();
    expect(status.state).toBe('unsupported');
    expect(status.message).toContain('portable');

    await service.download();
    expect(updater.downloadCalls).toBe(0);
  });

  it('unsupported vẫn nói được phiên bản đang chạy', () => {
    const { service } = setup({ isPackaged: false, currentVersion: '0.3.1' });
    expect(service.getStatus().currentVersion).toBe('0.3.1');
  });
});

describe('createUpdateService — luồng đủ', () => {
  it('đi hết idle → checking → available → downloading → downloaded', async () => {
    const { service, updater, seen } = setup();

    expect(service.getStatus().state).toBe('idle');

    await service.check();
    updater.emitChecking();
    expect(service.getStatus().state).toBe('checking');

    updater.emitAvailable('0.2.0');
    expect(service.getStatus().state).toBe('available');
    expect(service.getStatus().availableVersion).toBe('0.2.0');

    await service.download();
    updater.emitProgress({ transferred: 50, total: 200 });
    expect(service.getStatus().state).toBe('downloading');
    expect(service.getStatus().percent).toBe(25);

    updater.emitDownloaded('0.2.0');
    expect(service.getStatus().state).toBe('downloaded');

    expect(seen.map((s) => s.state)).toEqual([
      'checking',
      'available',
      'downloading',
      'downloaded',
    ]);
  });

  it('không có bản mới thì về idle kèm mốc thời gian đã kiểm', async () => {
    const { service, updater } = setup();

    await service.check();
    updater.emitNotAvailable();

    const status = service.getStatus();
    expect(status.state).toBe('idle');
    expect(status.checkedAt).toBe(1_700_000_000_000);
    expect(status.availableVersion).toBeUndefined();
  });

  it('giữ availableVersion trong lúc tải để UI hiện đang tải bản nào', async () => {
    const { service, updater } = setup();

    await service.check();
    updater.emitAvailable('0.2.0');
    updater.emitProgress({ transferred: 10, total: 100 });

    expect(service.getStatus().availableVersion).toBe('0.2.0');
  });

  it('lượt kiểm mới xoá sạch percent của lượt trước', async () => {
    // Merge từng phần sẽ để lại `percent: 87` và UI hiện "đang tải 87%" cho
    // một lượt kiểm vừa trả về "đã mới nhất".
    const { service, updater } = setup();

    await service.check();
    updater.emitAvailable('0.2.0');
    updater.emitProgress({ transferred: 87, total: 100 });
    expect(service.getStatus().percent).toBe(87);

    updater.emitChecking();
    expect(service.getStatus().percent).toBeUndefined();
    expect(service.getStatus().availableVersion).toBeUndefined();
  });
});

describe('createUpdateService — chặn tụt phiên bản', () => {
  it('BỎ QUA bản cũ hơn dù thư viện báo có bản mới', async () => {
    // `latest.yml` là file người upload. Publish nhầm release cũ đè lên sẽ đẩy
    // toàn bộ user đang ở bản mới lùi lại, và họ không tự quay lại được.
    const { service, updater, logger } = setup({ currentVersion: '0.2.0' });

    await service.check();
    updater.emitAvailable('0.1.0');

    expect(service.getStatus().state).toBe('idle');
    expect(service.getStatus().availableVersion).toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('bỏ qua cả bản trùng đúng phiên bản đang chạy', async () => {
    const { service, updater } = setup({ currentVersion: '0.2.0' });

    await service.check();
    updater.emitAvailable('0.2.0');

    expect(service.getStatus().state).toBe('idle');
  });

  it('vẫn nhận bản mới hơn có tiền tố v', async () => {
    const { service, updater } = setup({ currentVersion: '0.1.0' });

    await service.check();
    updater.emitAvailable('v0.2.0');

    expect(service.getStatus().state).toBe('available');
  });
});

describe('createUpdateService — lỗi', () => {
  it('lỗi mạng lúc kiểm sang error, không ném ra ngoài', async () => {
    const updater = createFakeUpdater({
      checkForUpdates: () => Promise.reject(new Error('getaddrinfo ENOTFOUND github.com')),
    });
    const { service } = setup({ updater });

    await expect(service.check()).resolves.toBeDefined();
    expect(service.getStatus().state).toBe('error');
    expect(service.getStatus().message).toContain('ENOTFOUND');
  });

  it('lượt kiểm tự động ghi log info, lượt user bấm ghi log error', async () => {
    // App offline mất mạng là chuyện thường — kiểm nền mỗi lần khởi động mà ghi
    // error thì log đầy thứ không ai cần đọc.
    const updater = createFakeUpdater({
      checkForUpdates: () => Promise.reject(new Error('offline')),
    });
    const { service, logger } = setup({ updater });

    await service.check({ silent: true });
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalled();

    await service.check();
    expect(logger.error).toHaveBeenCalled();
  });

  it('sự kiện error của thư viện cũng sang error', async () => {
    const { service, updater } = setup();

    await service.check();
    updater.emitError(new Error('sha512 mismatch'));

    expect(service.getStatus().state).toBe('error');
    expect(service.getStatus().message).toContain('sha512');
  });

  it('lỗi tải sang error, không kẹt ở downloading', async () => {
    const updater = createFakeUpdater({
      downloadUpdate: () => Promise.reject(new Error('ổ đĩa đầy')),
    });
    const { service } = setup({ updater });

    await service.check();
    updater.emitAvailable('0.2.0');
    await service.download();

    expect(service.getStatus().state).toBe('error');
  });
});

describe('createUpdateService — chặn thao tác sai trạng thái', () => {
  it('không tải khi chưa kiểm thấy bản mới', async () => {
    const { service, updater } = setup();

    await service.download();
    expect(updater.downloadCalls).toBe(0);
  });

  it('bấm tải hai lần chỉ chạy một lượt', async () => {
    // Lượt thứ hai lúc đang `downloading` sẽ ghi song song vào cùng một file —
    // bản tải về hỏng mà chỉ sha512 mới bắt được.
    const { service, updater } = setup();

    await service.check();
    updater.emitAvailable('0.2.0');

    await service.download();
    updater.emitProgress({ transferred: 1, total: 100 });
    await service.download();

    expect(updater.downloadCalls).toBe(1);
  });

  it('không cài khi chưa tải xong, trả false', async () => {
    const { service, updater } = setup();

    await service.check();
    updater.emitAvailable('0.2.0');

    expect(service.quitAndInstall()).toBe(false);
    expect(updater.installCalls).toHaveLength(0);
  });

  it('cài được sau khi tải xong, hiện trình cài và mở lại app', async () => {
    const { service, updater } = setup();

    await service.check();
    updater.emitAvailable('0.2.0');
    updater.emitDownloaded('0.2.0');

    expect(service.quitAndInstall()).toBe(true);
    // isSilent=false để user thấy trình cài; isForceRunAfter=true để app mở lại
    expect(updater.installCalls).toEqual([[false, true]]);
  });
});
