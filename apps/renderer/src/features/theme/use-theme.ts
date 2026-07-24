import { useEffect, useState } from 'react';
import type { ThemeMode } from '@ln/shared';
import { applyTheme, resolveTheme, type ResolvedTheme } from '@/lib/theme';
import { useSettingsStore } from '@/stores/settings-store';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** Theo dõi thiết lập dark mode của OS */
const usePrefersDark = (): boolean => {
  const [prefersDark, setPrefersDark] = useState(
    () => window.matchMedia(DARK_QUERY).matches,
  );

  useEffect(() => {
    const media = window.matchMedia(DARK_QUERY);
    const onChange = (e: MediaQueryListEvent): void => setPrefersDark(e.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  return prefersDark;
};

export type UseThemeResult = {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
};

/**
 * Đồng bộ theme từ settings xuống <html>.
 * Chế độ `system` bám theo OS và đổi ngay khi user đổi thiết lập Windows.
 */
export const useTheme = (): UseThemeResult => {
  const settings = useSettingsStore((s) => s.settings);
  const setThemeSetting = useSettingsStore((s) => s.setTheme);
  const prefersDark = usePrefersDark();

  const mode: ThemeMode = settings?.theme ?? 'system';
  const resolved = resolveTheme(mode, prefersDark);

  useEffect(() => {
    applyTheme(document.documentElement, resolved);
  }, [resolved]);

  return {
    mode,
    resolved,
    setMode: (next) => void setThemeSetting(next),
  };
};
