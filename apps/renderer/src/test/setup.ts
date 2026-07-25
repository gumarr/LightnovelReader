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

/**
 * jsdom thiếu `DOMMatrix`, mà pdfjs có `new DOMMatrix()` ở cấp module — chỉ
 * cần *import* `pdf-document.ts` là nổ, kể cả test không đụng tới PDF.
 *
 * Trùng nguyên nhân với lỗi đóng gói ở PROGRESS mục 4.19, khác chỗ: ở đây là
 * jsdom thiếu thật, còn Electron main thì bị pdfjs nhận nhầm là trình duyệt.
 * Renderer thật chạy trên Chromium nên luôn có sẵn.
 */
if (!('DOMMatrix' in globalThis)) {
  vi.stubGlobal(
    'DOMMatrix',
    class {
      a = 1;
      b = 0;
      c = 0;
      d = 1;
      e = 0;
      f = 0;
    },
  );
}

/**
 * jsdom không dựng layout nên thiếu hẳn nhóm API cuộn. Trình đọc dùng chúng
 * để đưa segment đang đọc vào tầm nhìn — giả lập ở đây thay vì bọc `?.` trong
 * component, vì trên Electron thật chúng luôn có.
 */
Element.prototype.scrollIntoView = vi.fn();
Element.prototype.scrollTo = vi.fn();

/** Ảo hoá danh sách dài cần `ResizeObserver` để biết chiều cao khung */
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  },
);

afterEach(() => {
  cleanup();
  listeners.clear();
  prefersDark = false;
  document.documentElement.className = '';
  document.documentElement.style.colorScheme = '';
});
