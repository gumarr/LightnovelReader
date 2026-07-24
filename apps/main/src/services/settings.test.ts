import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type AppSettings } from '@ln/shared';
import { createSettingsService, resolveSettings, type SettingsStorage } from './settings.js';

const AUDIO_DIR = 'E:\\ln-audio';

const memoryStorage = (initial: unknown = null): SettingsStorage & { value: unknown } => {
  const store = {
    value: initial,
    read: () => store.value,
    write: (v: AppSettings) => {
      store.value = v;
    },
  };
  return store;
};

describe('resolveSettings', () => {
  it('trả về mặc định khi chưa có gì lưu', () => {
    const s = resolveSettings(null, AUDIO_DIR);
    expect(s).toEqual({ ...DEFAULT_SETTINGS, audioDir: AUDIO_DIR });
  });

  it('trả về mặc định khi giá trị lưu không phải object', () => {
    expect(resolveSettings('hỏng', AUDIO_DIR).bitrate).toBe(DEFAULT_SETTINGS.bitrate);
    expect(resolveSettings(42, AUDIO_DIR).theme).toBe(DEFAULT_SETTINGS.theme);
  });

  it('giữ giá trị đã lưu hợp lệ', () => {
    const s = resolveSettings({ theme: 'dark', bitrate: 32 }, AUDIO_DIR);
    expect(s.theme).toBe('dark');
    expect(s.bitrate).toBe(32);
  });

  it('field hỏng rơi về mặc định nhưng field hợp lệ khác được giữ', () => {
    const s = resolveSettings({ theme: 'dark', bitrate: 999 }, AUDIO_DIR);
    expect(s.theme).toBe('dark');
    expect(s.bitrate).toBe(DEFAULT_SETTINGS.bitrate);
  });

  it('bỏ qua field lạ không có trong schema', () => {
    const s = resolveSettings({ theme: 'light', hackerField: 'rm -rf' }, AUDIO_DIR);
    expect(s.theme).toBe('light');
    expect('hackerField' in s).toBe(false);
  });

  it('audioDir đã lưu được ưu tiên hơn mặc định — user đổi thư mục', () => {
    const custom = 'D:\\other\\audio';
    expect(resolveSettings({ audioDir: custom }, AUDIO_DIR).audioDir).toBe(custom);
  });

  it('audioDir rỗng rơi về mặc định — path audio phải luôn xác định', () => {
    expect(resolveSettings({ audioDir: '' }, AUDIO_DIR).audioDir).toBe(AUDIO_DIR);
  });

  it('playbackRate ngoài khoảng rơi về mặc định', () => {
    expect(resolveSettings({ playbackRate: 5 }, AUDIO_DIR).playbackRate).toBe(
      DEFAULT_SETTINGS.playbackRate,
    );
  });

  it('file settings hỏng hoàn toàn vẫn cho ra settings dùng được', () => {
    const garbage = { theme: 1, bitrate: 'x', audioDir: [], playbackRate: null };
    const s = resolveSettings(garbage, AUDIO_DIR);
    expect(s).toEqual({ ...DEFAULT_SETTINGS, audioDir: AUDIO_DIR });
  });
});

describe('createSettingsService', () => {
  it('chuẩn hoá và ghi lại ngay lúc khởi tạo', () => {
    const storage = memoryStorage({ theme: 'dark', bitrate: 999 });
    createSettingsService(storage, AUDIO_DIR);
    expect((storage.value as AppSettings).bitrate).toBe(DEFAULT_SETTINGS.bitrate);
    expect((storage.value as AppSettings).theme).toBe('dark');
  });

  it('update trả về settings mới và lưu xuống storage', () => {
    const storage = memoryStorage();
    const service = createSettingsService(storage, AUDIO_DIR);

    const next = service.update({ theme: 'dark' });
    expect(next.theme).toBe('dark');
    expect(service.getAll().theme).toBe('dark');
    expect((storage.value as AppSettings).theme).toBe('dark');
  });

  it('update chỉ đổi field được truyền', () => {
    const service = createSettingsService(memoryStorage(), AUDIO_DIR);
    service.update({ bitrate: 32 });
    const s = service.update({ theme: 'light' });
    expect(s.bitrate).toBe(32);
    expect(s.theme).toBe('light');
  });

  it('bỏ qua key mang undefined thay vì xoá giá trị cũ', () => {
    const service = createSettingsService(memoryStorage(), AUDIO_DIR);
    service.update({ theme: 'dark' });

    const next = service.update({ theme: undefined, bitrate: 32 });
    expect(next.theme).toBe('dark');
    expect(next.bitrate).toBe(32);
  });

  it('update rỗng giữ nguyên mọi thứ', () => {
    const service = createSettingsService(memoryStorage(), AUDIO_DIR);
    const before = service.getAll();
    expect(service.update({})).toEqual(before);
  });

  it('update từ chối giá trị không hợp lệ và không ghi đè state', () => {
    const storage = memoryStorage();
    const service = createSettingsService(storage, AUDIO_DIR);
    const writeSpy = vi.spyOn(storage, 'write');

    expect(() => service.update({ bitrate: 99 as never })).toThrow();
    expect(service.getAll().bitrate).toBe(DEFAULT_SETTINGS.bitrate);
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('không lưu settings vào localStorage — chỉ qua storage được truyền vào', () => {
    const storage = memoryStorage();
    const service = createSettingsService(storage, AUDIO_DIR);
    service.update({ subtitleFontSize: 24 });
    expect((storage.value as AppSettings).subtitleFontSize).toBe(24);
  });
});
