import type { ThemeMode } from '@ln/shared';

/**
 * Logic theme thuần — không đụng React, test được độc lập.
 */

export type ResolvedTheme = 'light' | 'dark';

/** `system` phân giải theo thiết lập OS, hai chế độ còn lại giữ nguyên */
export const resolveTheme = (mode: ThemeMode, prefersDark: boolean): ResolvedTheme => {
  if (mode === 'system') return prefersDark ? 'dark' : 'light';
  return mode;
};

/** Áp theme lên <html>: class `.dark` cho Tailwind, `color-scheme` cho scrollbar/native */
export const applyTheme = (root: HTMLElement, theme: ResolvedTheme): void => {
  root.classList.toggle('dark', theme === 'dark');
  root.style.colorScheme = theme;
};

export const THEME_LABELS: Record<ThemeMode, string> = {
  light: 'Sáng',
  dark: 'Tối',
  system: 'Theo hệ thống',
};

/** Thứ tự khi bấm nút xoay vòng theme */
export const nextThemeMode = (current: ThemeMode): ThemeMode => {
  const order: readonly ThemeMode[] = ['light', 'dark', 'system'];
  const index = order.indexOf(current);
  return order[(index + 1) % order.length] ?? 'system';
};
