import {
  DEFAULT_SETTINGS,
  appSettingsSchema,
  type AppSettings,
  type AppSettingsPatch,
} from '@ln/shared';

/**
 * Quản lý settings. Lưu qua `electron-store` (JSON) chứ không phải SQLite —
 * settings cần đọc được trước khi DB mở, và không dùng localStorage vì
 * renderer không được giữ dữ liệu quan trọng.
 *
 * Lớp này thuần logic: nhận một `SettingsStorage` để test không cần Electron.
 */

export type SettingsStorage = {
  read: () => unknown;
  write: (value: AppSettings) => void;
};

export type SettingsService = {
  getAll: () => AppSettings;
  update: (patch: AppSettingsPatch) => AppSettings;
};

/**
 * Ghép giá trị đã lưu với mặc định rồi validate.
 * File settings hỏng hoặc thiếu field không được làm app chết — rơi về mặc
 * định cho field đó, giữ lại field còn hợp lệ.
 */
export const resolveSettings = (stored: unknown, defaultAudioDir: string): AppSettings => {
  const fallback: AppSettings = { ...DEFAULT_SETTINGS, audioDir: defaultAudioDir };

  if (stored === null || typeof stored !== 'object') return fallback;

  const merged = { ...fallback, ...(stored as Record<string, unknown>) };
  const parsed = appSettingsSchema.safeParse(merged);
  if (parsed.success) return parsed.data;

  // Có field hỏng: giữ những field parse được, phần còn lại về mặc định
  const repaired: Record<string, unknown> = { ...fallback };
  for (const [key, value] of Object.entries(merged)) {
    if (!(key in fallback)) continue;
    const candidate = { ...repaired, [key]: value };
    if (appSettingsSchema.safeParse(candidate).success) {
      repaired[key] = value;
    }
  }

  return appSettingsSchema.parse(repaired);
};

export const createSettingsService = (
  storage: SettingsStorage,
  defaultAudioDir: string,
): SettingsService => {
  let current = resolveSettings(storage.read(), defaultAudioDir);
  // Ghi lại ngay để file trên đĩa luôn ở dạng đã chuẩn hoá
  storage.write(current);

  return {
    getAll: () => current,

    update: (patch) => {
      // Bỏ key mang giá trị undefined — spread thẳng sẽ xoá mất giá trị cũ
      const defined = Object.fromEntries(
        Object.entries(patch).filter(([, value]) => value !== undefined),
      );

      const next = appSettingsSchema.parse({ ...current, ...defined });
      current = next;
      storage.write(next);
      return next;
    },
  };
};
