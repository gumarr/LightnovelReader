import { contextBridge } from 'electron';
import { api } from './api.js';

/**
 * Preload chạy với `contextIsolation: true` và `sandbox: true`.
 * Chỉ `window.api` được đưa sang renderer — không có `require`, `ipcRenderer`
 * hay bất kỳ module Node nào lọt qua.
 */

contextBridge.exposeInMainWorld('api', api);
