import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

/**
 * jsdom không có `matchMedia` — theme provider cần nó để đọc thiết lập OS.
 * Mặc định trả `matches: false` (giao diện sáng); test nào cần dark thì
 * gọi `setPrefersDark(true)`.
 */

let prefersDark = false;

export const setPrefersDark = (value: boolean): void => {
  prefersDark = value;
};

const listeners = new Set<(e: MediaQueryListEvent) => void>();

/** Giả lập user đổi thiết lập dark mode của Windows */
export const emitPrefersDarkChange = (value: boolean): void => {
  prefersDark = value;
  for (const listener of listeners) {
    listener({ matches: value } as MediaQueryListEvent);
  }
};

vi.stubGlobal(
  'matchMedia',
  vi.fn((query: string) => ({
    matches: query.includes('dark') ? prefersDark : false,
    media: query,
    onchange: null,
    addEventListener: (_: string, listener: (e: MediaQueryListEvent) => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_: string, listener: (e: MediaQueryListEvent) => void) => {
      listeners.delete(listener);
    },
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
);

afterEach(() => {
  cleanup();
  listeners.clear();
  prefersDark = false;
  document.documentElement.className = '';
  document.documentElement.style.colorScheme = '';
});
