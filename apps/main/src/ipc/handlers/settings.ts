import { dialog } from 'electron';
import type { BrowserWindow } from 'electron';
import {
  appSettingsPatchSchema,
  ok,
  themeModeSchema,
  type AppSettings,
  type AppSettingsPatch,
  type Result,
  type ThemeMode,
} from '@ln/shared';
import type { SettingsService } from '../../services/settings.js';
import { InvalidInputError } from '../wrap.js';

/**
 * Handler cho nhóm `settings:*`.
 *
 * Mọi input từ renderer đều đi qua zod trước khi dùng — main không tin
 * dữ liệu phía renderer kể cả khi preload đã có kiểu.
 */

export type SettingsHandlers = {
  getAll: () => Result<AppSettings>;
  update: (input: unknown) => Result<AppSettings>;
  setTheme: (input: unknown) => Result<AppSettings>;
  pickAudioDir: () => Promise<Result<string | null>>;
};

export type SettingsHandlerDeps = {
  settings: SettingsService;
  /** Gọi sau mỗi lần settings đổi để đẩy event xuống renderer */
  onChanged: (next: AppSettings) => void;
  getWindow: () => BrowserWindow | null;
};

export const createSettingsHandlers = (deps: SettingsHandlerDeps): SettingsHandlers => {
  const applyPatch = (patch: AppSettingsPatch): Result<AppSettings> => {
    const next = deps.settings.update(patch);
    deps.onChanged(next);
    return ok(next);
  };

  return {
    getAll: () => ok(deps.settings.getAll()),

    update: (input) => {
      const parsed = appSettingsPatchSchema.safeParse(input);
      if (!parsed.success) {
        throw new InvalidInputError(`Settings không hợp lệ: ${parsed.error.issues[0]?.message}`);
      }
      return applyPatch(parsed.data);
    },

    setTheme: (input) => {
      const parsed = themeModeSchema.safeParse(input);
      if (!parsed.success) {
        throw new InvalidInputError('Theme phải là light, dark hoặc system');
      }
      const theme: ThemeMode = parsed.data;
      return applyPatch({ theme });
    },

    pickAudioDir: async () => {
      const window = deps.getWindow();
      const options = {
        title: 'Chọn thư mục lưu audio',
        defaultPath: deps.settings.getAll().audioDir,
        properties: ['openDirectory', 'createDirectory'] as const,
      };

      const result =
        window === null
          ? await dialog.showOpenDialog({ ...options, properties: [...options.properties] })
          : await dialog.showOpenDialog(window, {
              ...options,
              properties: [...options.properties],
            });

      const picked = result.canceled ? undefined : result.filePaths[0];
      if (picked === undefined) return ok(null);

      // Đổi thư mục audio là thay đổi settings, không tự di chuyển file cũ —
      // việc di chuyển do Storage Manager (Phase 2) xử lý tường minh.
      applyPatch({ audioDir: picked });
      return ok(picked);
    },
  };
};
