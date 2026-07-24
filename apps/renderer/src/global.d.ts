import type { LnApi } from '@ln/preload/api';

/**
 * `window.api` do preload expose qua contextBridge.
 * Kiểu lấy thẳng từ preload nên đổi API mà quên cập nhật renderer sẽ lỗi
 * typecheck ngay, không đợi tới lúc chạy.
 */
declare global {
  interface Window {
    readonly api: LnApi;
  }
}

export {};
