import { beforeEach, describe, expect, it } from 'vitest';
import { err, type AppSettings } from '@ln/shared';
import { useSettingsStore } from './settings-store';
import { installFakeApi, type FakeApi } from '@/test/fake-api';

let fake: FakeApi;

const reset = (): void => {
  useSettingsStore.setState({ settings: null, error: null, loading: false });
};

beforeEach(() => {
  fake = installFakeApi();
  reset();
});

describe('load', () => {
  it('nạp settings từ main', async () => {
    await useSettingsStore.getState().load();

    const state = useSettingsStore.getState();
    expect(state.settings?.audioDir).toBe('E:\\ln-audio');
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });

  it('lưu thông báo lỗi khi main trả Result lỗi', async () => {
    fake.api.settings.getAll.mockResolvedValueOnce(err('DB_ERROR', 'Lỗi đọc DB'));

    await useSettingsStore.getState().load();

    const state = useSettingsStore.getState();
    expect(state.error).toBe('Lỗi đọc DB');
    expect(state.loading).toBe(false);
  });

  it('không kẹt ở loading khi IPC reject — main chết giữa chừng', async () => {
    fake.api.settings.getAll.mockRejectedValueOnce(new Error('No handler registered'));

    await useSettingsStore.getState().load();

    const state = useSettingsStore.getState();
    expect(state.loading).toBe(false);
    expect(state.error).toContain('Không kết nối được tiến trình chính');
    expect(state.error).toContain('No handler registered');
  });

  it('xoá lỗi cũ khi load lại thành công', async () => {
    fake.api.settings.getAll.mockRejectedValueOnce(new Error('lỗi tạm'));
    await useSettingsStore.getState().load();
    expect(useSettingsStore.getState().error).not.toBeNull();

    await useSettingsStore.getState().load();
    expect(useSettingsStore.getState().error).toBeNull();
  });
});

describe('update', () => {
  it('cập nhật settings sau khi main xác nhận', async () => {
    await useSettingsStore.getState().update({ bitrate: 32 });
    expect(useSettingsStore.getState().settings?.bitrate).toBe(32);
  });

  it('giữ settings cũ khi main từ chối', async () => {
    await useSettingsStore.getState().load();
    fake.api.settings.update.mockResolvedValueOnce(err('INVALID_INPUT', 'Bitrate không hợp lệ'));

    await useSettingsStore.getState().update({ bitrate: 999 as never });

    const state = useSettingsStore.getState();
    expect(state.settings?.bitrate).toBe(24);
    expect(state.error).toBe('Bitrate không hợp lệ');
  });

  it('không throw khi IPC reject', async () => {
    fake.api.settings.update.mockRejectedValueOnce(new Error('mất kết nối'));

    await expect(useSettingsStore.getState().update({ bitrate: 16 })).resolves.toBeUndefined();
    expect(useSettingsStore.getState().error).toContain('Không kết nối được');
  });
});

describe('setTheme', () => {
  it('đổi theme qua IPC', async () => {
    await useSettingsStore.getState().setTheme('dark');
    expect(fake.api.settings.setTheme).toHaveBeenCalledWith('dark');
    expect(useSettingsStore.getState().settings?.theme).toBe('dark');
  });

  it('không throw khi IPC reject', async () => {
    fake.api.settings.setTheme.mockRejectedValueOnce(new Error('lỗi'));
    await expect(useSettingsStore.getState().setTheme('light')).resolves.toBeUndefined();
    expect(useSettingsStore.getState().error).not.toBeNull();
  });
});

describe('applyExternal', () => {
  it('nhận settings do main đẩy xuống mà không gọi IPC', () => {
    const next: AppSettings = {
      theme: 'light',
      audioDir: 'D:\\khac',
      bitrate: 16,
      storageWarnBytes: 0,
      alignmentEnabled: false,
      viewerPaneRatio: 0.5,
      subtitleFontSize: 20,
      playbackRate: 1.5,
    };

    useSettingsStore.getState().applyExternal(next);

    expect(useSettingsStore.getState().settings).toEqual(next);
    expect(fake.api.settings.getAll).not.toHaveBeenCalled();
  });
});
