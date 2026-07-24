import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { resolvePreloadPath, resolveRendererFile } from './window.js';

/**
 * Đường dẫn preload/renderer phải đúng ở CẢ hai ngữ cảnh:
 * - dev:      D:\...\apps\main\dist
 * - đóng gói: <resources>\app.asar\apps\main\dist
 *
 * `appRoot` luôn là thư mục chứa file main đã build (`__dirname`), không
 * phải `app.getAppPath()` — ghép nhầm sẽ ra `.../dist/dist/...` và app mở
 * lên với cửa sổ trống.
 */

const DEV_ROOT = join('D:', 'Project', 'LightnovelReader', 'apps', 'main', 'dist');
const PACKED_ROOT = join('C:', 'app', 'resources', 'app.asar', 'apps', 'main', 'dist');

describe('resolvePreloadPath', () => {
  it('trỏ vào preload/index.cjs cạnh file main', () => {
    expect(resolvePreloadPath(DEV_ROOT)).toBe(join(DEV_ROOT, 'preload', 'index.cjs'));
  });

  it('hoạt động với đường dẫn trong asar', () => {
    expect(resolvePreloadPath(PACKED_ROOT)).toBe(join(PACKED_ROOT, 'preload', 'index.cjs'));
  });

  it('dùng đuôi .cjs — preload sandbox không nạp được ESM', () => {
    expect(resolvePreloadPath(DEV_ROOT).endsWith('.cjs')).toBe(true);
  });
});

describe('resolveRendererFile', () => {
  it('trỏ vào renderer/index.html cạnh file main', () => {
    expect(resolveRendererFile(DEV_ROOT)).toBe(join(DEV_ROOT, 'renderer', 'index.html'));
  });

  it('hoạt động với đường dẫn trong asar', () => {
    expect(resolveRendererFile(PACKED_ROOT)).toBe(join(PACKED_ROOT, 'renderer', 'index.html'));
  });

  it('không lồng thêm "dist" — lỗi từng làm app mở ra cửa sổ trống', () => {
    const path = resolveRendererFile(DEV_ROOT);
    const distCount = path.split(/[\\/]/).filter((p) => p === 'dist').length;
    expect(distCount).toBe(1);
  });
});
