import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type AppSettings } from '@ln/shared';
import { createSettingsHandlers } from './settings.js';
import { createSettingsService, type SettingsStorage } from '../../services/settings.js';
import { InvalidInputError } from '../wrap.js';

const showOpenDialog = vi.hoisted(() => vi.fn());
vi.mock('electron', () => ({ dialog: { showOpenDialog } }));

const AUDIO_DIR = 'E:\\ln-audio';

const setup = (): {
  handlers: ReturnType<typeof createSettingsHandlers>;
  changes: AppSettings[];
} => {
  let stored: unknown = null;
  const storage: SettingsStorage = {
    read: () => stored,
    write: (v) => {
      stored = v;
    },
  };

  const changes: AppSettings[] = [];
  const handlers = createSettingsHandlers({
    settings: createSettingsService(storage, AUDIO_DIR),
    onChanged: (next) => changes.push(next),
    getWindow: () => null,
  });

  return { handlers, changes };
};

beforeEach(() => {
  showOpenDialog.mockReset();
});

describe('settings:getAll', () => {
  it('trả về settings hiện tại', () => {
    const { handlers } = setup();
    const result = handlers.getAll();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.audioDir).toBe(AUDIO_DIR);
  });

  it('không phát event khi chỉ đọc', () => {
    const { handlers, changes } = setup();
    handlers.getAll();
    expect(changes).toEqual([]);
  });
});

describe('settings:update', () => {
  it('cập nhật field hợp lệ và phát event', () => {
    const { handlers, changes } = setup();
    const result = handlers.update({ bitrate: 32 });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.bitrate).toBe(32);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.bitrate).toBe(32);
  });

  it('cập nhật nhiều field cùng lúc', () => {
    const { handlers } = setup();
    const result = handlers.update({ theme: 'dark', subtitleFontSize: 22 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.theme).toBe('dark');
      expect(result.data.subtitleFontSize).toBe(22);
    }
  });

  it('từ chối bitrate ngoài 16/24/32', () => {
    const { handlers, changes } = setup();
    expect(() => handlers.update({ bitrate: 128 })).toThrow(InvalidInputError);
    expect(changes).toEqual([]);
  });

  it('từ chối input không phải object', () => {
    const { handlers } = setup();
    expect(() => handlers.update('hack')).toThrow(InvalidInputError);
    expect(() => handlers.update(null)).toThrow(InvalidInputError);
  });

  it('từ chối playbackRate ngoài khoảng 0.5–2.0', () => {
    const { handlers } = setup();
    expect(() => handlers.update({ playbackRate: 4 })).toThrow(InvalidInputError);
  });

  it('không đổi state khi input bị từ chối', () => {
    const { handlers } = setup();
    expect(() => handlers.update({ bitrate: 999 })).toThrow();
    const after = handlers.getAll();
    if (after.ok) expect(after.data.bitrate).toBe(DEFAULT_SETTINGS.bitrate);
  });
});

describe('settings:setTheme', () => {
  it.each(['light', 'dark', 'system'] as const)('chấp nhận theme %s', (theme) => {
    const { handlers } = setup();
    const result = handlers.setTheme(theme);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.theme).toBe(theme);
  });

  it('từ chối theme lạ với thông báo tiếng Việt', () => {
    const { handlers } = setup();
    expect(() => handlers.setTheme('tím')).toThrow(/light, dark hoặc system/);
  });

  it('từ chối kiểu không phải chuỗi', () => {
    const { handlers } = setup();
    expect(() => handlers.setTheme(1)).toThrow(InvalidInputError);
  });

  it('giữ nguyên các field khác khi đổi theme', () => {
    const { handlers } = setup();
    handlers.update({ bitrate: 16 });
    const result = handlers.setTheme('dark');
    if (result.ok) {
      expect(result.data.bitrate).toBe(16);
      expect(result.data.theme).toBe('dark');
    }
  });
});

describe('settings:pickAudioDir', () => {
  it('lưu thư mục user chọn', async () => {
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['D:\\new-audio'] });
    const { handlers, changes } = setup();

    const result = await handlers.pickAudioDir();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBe('D:\\new-audio');
    expect(changes[0]?.audioDir).toBe('D:\\new-audio');
  });

  it('trả null và giữ nguyên settings khi user huỷ', async () => {
    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    const { handlers, changes } = setup();

    const result = await handlers.pickAudioDir();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBeNull();
    expect(changes).toEqual([]);
  });

  it('coi như huỷ khi dialog trả mảng rỗng', async () => {
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [] });
    const { handlers, changes } = setup();

    const result = await handlers.pickAudioDir();
    if (result.ok) expect(result.data).toBeNull();
    expect(changes).toEqual([]);
  });

  it('mở dialog ở thư mục audio hiện tại', async () => {
    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    const { handlers } = setup();

    await handlers.pickAudioDir();
    expect(showOpenDialog).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: AUDIO_DIR }),
    );
  });
});
