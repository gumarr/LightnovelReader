import { describe, expect, it } from 'vitest';
import type { ThemeMode } from '@ln/shared';
import { THEME_LABELS, applyTheme, nextThemeMode, resolveTheme } from './theme.js';

describe('resolveTheme', () => {
  it('light và dark không phụ thuộc OS', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('light', false)).toBe('light');
    expect(resolveTheme('dark', true)).toBe('dark');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('system theo thiết lập OS', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });
});

describe('applyTheme', () => {
  it('thêm class dark khi theme tối', () => {
    const root = document.createElement('html');
    applyTheme(root, 'dark');
    expect(root.classList.contains('dark')).toBe(true);
    expect(root.style.colorScheme).toBe('dark');
  });

  it('gỡ class dark khi chuyển sang sáng', () => {
    const root = document.createElement('html');
    applyTheme(root, 'dark');
    applyTheme(root, 'light');
    expect(root.classList.contains('dark')).toBe(false);
    expect(root.style.colorScheme).toBe('light');
  });

  it('gọi nhiều lần cùng theme không nhân đôi class', () => {
    const root = document.createElement('html');
    applyTheme(root, 'dark');
    applyTheme(root, 'dark');
    expect(root.className).toBe('dark');
  });

  it('giữ nguyên class khác trên root', () => {
    const root = document.createElement('html');
    root.classList.add('có-sẵn');
    applyTheme(root, 'dark');
    expect(root.classList.contains('có-sẵn')).toBe(true);
  });
});

describe('nextThemeMode', () => {
  it('xoay vòng light → dark → system → light', () => {
    expect(nextThemeMode('light')).toBe('dark');
    expect(nextThemeMode('dark')).toBe('system');
    expect(nextThemeMode('system')).toBe('light');
  });

  it('ba lần bấm quay về ban đầu', () => {
    let mode: ThemeMode = 'light';
    for (let i = 0; i < 3; i += 1) mode = nextThemeMode(mode);
    expect(mode).toBe('light');
  });
});

describe('THEME_LABELS', () => {
  it('có nhãn tiếng Việt cho cả ba chế độ', () => {
    expect(THEME_LABELS).toEqual({ light: 'Sáng', dark: 'Tối', system: 'Theo hệ thống' });
  });
});
