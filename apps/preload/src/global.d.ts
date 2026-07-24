import type { LnApi } from './api.js';

/** Khai báo `window.api` cho renderer. */
declare global {
  interface Window {
    readonly api: LnApi;
  }
}

export {};
