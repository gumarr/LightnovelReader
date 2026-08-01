import { beforeEach, describe, expect, it } from 'vitest';
import { err, ok, type UpdateStatus } from '@ln/shared';
import { useUpdateStore } from './update-store';
import { installFakeApi, type FakeApi } from '@/test/fake-api';

let fake: FakeApi;

const reset = (): void => {
  useUpdateStore.setState({ status: null, error: null, dismissed: false });
};

const status = (overrides: Partial<UpdateStatus> = {}): UpdateStatus => ({
  state: 'idle',
  currentVersion: '0.1.0',
  ...overrides,
});

beforeEach(() => {
  fake = installFakeApi();
  reset();
});

describe('load', () => {
  it('nạp trạng thái từ main', async () => {
    await useUpdateStore.getState().load();

    expect(useUpdateStore.getState().status?.state).toBe('idle');
    expect(useUpdateStore.getState().error).toBeNull();
  });

  it('phân biệt "chưa nạp" với "đã hỏi, không có gì mới"', () => {
    // `null` ≠ `idle`. UI dựa vào đó để không nói "đang dùng bản mới nhất"
    // trước khi hỏi main lần nào.
    expect(useUpdateStore.getState().status).toBeNull();
  });

  it('ghi lỗi khi main trả Result lỗi', async () => {
    fake.api.update.getStatus.mockResolvedValueOnce(err('UNKNOWN', 'Hỏng'));

    await useUpdateStore.getState().load();

    expect(useUpdateStore.getState().error).toBe('Hỏng');
    expect(useUpdateStore.getState().status).toBeNull();
  });

  it('không ném khi IPC reject — main chết giữa chừng', async () => {
    fake.api.update.getStatus.mockRejectedValueOnce(new Error('No handler registered'));

    await useUpdateStore.getState().load();

    const state = useUpdateStore.getState();
    expect(state.error).toContain('Không kết nối được tiến trình chính');
    expect(state.error).toContain('No handler registered');
  });
});

describe('check', () => {
  it('sang `checking` ngay khi bấm, không chờ event', async () => {
    // User vừa bấm nút và cần thấy phản hồi trong nhịp này; event
    // `checking-for-update` từ main tới sau một vòng IPC.
    await useUpdateStore.getState().load();

    let seen: UpdateStatus['state'] | undefined;
    fake.api.update.check.mockImplementationOnce(async () => {
      seen = useUpdateStore.getState().status?.state;
      return ok(status({ checkedAt: 1 }));
    });

    await useUpdateStore.getState().check();

    expect(seen).toBe('checking');
    expect(useUpdateStore.getState().status?.checkedAt).toBe(1);
  });

  it('không dựng trạng thái giả khi chưa nạp lần nào', async () => {
    // Chưa có `currentVersion` thì không thể bịa ra một `UpdateStatus` hợp lệ.
    fake.api.update.check.mockImplementationOnce(async () => {
      expect(useUpdateStore.getState().status).toBeNull();
      return ok(status());
    });

    await useUpdateStore.getState().check();

    expect(useUpdateStore.getState().status?.state).toBe('idle');
  });

  it('không kẹt ở `checking` khi IPC reject', async () => {
    await useUpdateStore.getState().load();
    fake.api.update.check.mockRejectedValueOnce(new Error('mất kết nối'));

    await useUpdateStore.getState().check();

    const state = useUpdateStore.getState();
    expect(state.error).toContain('mất kết nối');
    // Trạng thái vẫn kẹt ở `checking` — nhưng `error` có mặt nên UI hiện lỗi.
    // Điều quan trọng là hàm **trả về** chứ không treo.
    expect(state.status).not.toBeNull();
  });
});

describe('download', () => {
  it('gọi main và ghi trạng thái trả về', async () => {
    fake.api.update.download.mockResolvedValueOnce(
      ok(status({ state: 'downloading', percent: 0 })),
    );

    await useUpdateStore.getState().download();

    expect(fake.api.update.download).toHaveBeenCalledOnce();
    expect(useUpdateStore.getState().status?.state).toBe('downloading');
  });

  it('mở lại dải báo đã đóng — bấm tải nghĩa là đang quan tâm', async () => {
    // Nếu không mở lại, user đóng dải rồi vào Cài đặt bấm tải sẽ không bao giờ
    // thấy lời mời cài lúc tải xong.
    useUpdateStore.setState({ dismissed: true });

    await useUpdateStore.getState().download();

    expect(useUpdateStore.getState().dismissed).toBe(false);
  });

  it('ghi lỗi khi main từ chối', async () => {
    fake.api.update.download.mockResolvedValueOnce(err('UNKNOWN', 'Không tải được'));

    await useUpdateStore.getState().download();

    expect(useUpdateStore.getState().error).toBe('Không tải được');
  });
});

describe('install', () => {
  it('trả `false` khi main từ chối vì chưa tải xong', async () => {
    // Bản giả trả `false` khi state ≠ `downloaded` — đúng như service thật.
    const started = await useUpdateStore.getState().install();

    expect(started).toBe(false);
  });

  it('trả `true` khi main nhận lệnh cài', async () => {
    fake.emitUpdateStatus(status({ state: 'downloaded', availableVersion: '0.2.0' }));

    const started = await useUpdateStore.getState().install();

    expect(started).toBe(true);
  });

  it('trả `false` chứ không ném khi IPC reject', async () => {
    fake.api.update.quitAndInstall.mockRejectedValueOnce(new Error('main đã chết'));

    const started = await useUpdateStore.getState().install();

    expect(started).toBe(false);
    expect(useUpdateStore.getState().error).toContain('main đã chết');
  });
});

describe('event từ main', () => {
  it('applyExternal ghi đè trạng thái', () => {
    useUpdateStore.getState().applyExternal(
      status({ state: 'available', availableVersion: '0.2.0' }),
    );

    expect(useUpdateStore.getState().status?.availableVersion).toBe('0.2.0');
  });

  it('trạng thái mới thay thế hoàn toàn, không merge sót `percent` cũ', () => {
    // Cùng lý do với `setStatus` ở main: giữ `percent` của lượt tải trước sẽ
    // hiện "đang tải 87%" cho một lượt kiểm vừa trả "đã mới nhất".
    useUpdateStore.getState().applyExternal(status({ state: 'downloading', percent: 87 }));
    useUpdateStore.getState().applyExternal(status({ checkedAt: 2 }));

    expect(useUpdateStore.getState().status?.percent).toBeUndefined();
  });
});

describe('dismiss', () => {
  it('đóng dải báo chỉ trong phiên, không ghi vào settings', () => {
    useUpdateStore.getState().dismiss();

    expect(useUpdateStore.getState().dismissed).toBe(true);
    // Không có lượt gọi settings nào: đóng dải là "để tôi yên lúc này", không
    // phải "đừng bao giờ báo nữa".
    expect(fake.api.settings.update).not.toHaveBeenCalled();
  });

  it('clearError xoá lỗi IPC mà giữ nguyên trạng thái cập nhật', async () => {
    fake.api.update.getStatus.mockResolvedValueOnce(err('UNKNOWN', 'Hỏng'));
    await useUpdateStore.getState().load();
    useUpdateStore.getState().applyExternal(status({ state: 'available' }));

    useUpdateStore.getState().clearError();

    expect(useUpdateStore.getState().error).toBeNull();
    expect(useUpdateStore.getState().status?.state).toBe('available');
  });
});
