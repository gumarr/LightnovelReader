import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { ICON_FILE_NAME, resolveIconPath } from './icon-paths.js';

/**
 * Cùng loại test với `sidecar-paths.test.ts`: khoá **thứ tự tìm kiếm**, không
 * khoá sự tồn tại của file thật. Đường dẫn icon hỏng chỉ lộ ra ở bản đóng gói,
 * nơi không gắn được debugger (PROGRESS mục 4.19, 4.29a).
 */

const packagedIcon = join('C:/app/resources', ICON_FILE_NAME);
const devIcon = join('D:/repo', 'resources', ICON_FILE_NAME);

const existsOnly =
  (...paths: string[]) =>
  (path: string): boolean =>
    paths.includes(path);

describe('resolveIconPath', () => {
  it('bản đóng gói: lấy icon thẳng trong resources/', () => {
    const found = resolveIconPath({
      resourcesPath: 'C:/app/resources',
      exists: existsOnly(packagedIcon),
    });

    expect(found).toBe(packagedIcon);
  });

  it('lúc dev: lấy icon trong resources/ của gốc repo', () => {
    const found = resolveIconPath({
      repoRoot: 'D:/repo',
      exists: existsOnly(devIcon),
    });

    expect(found).toBe(devIcon);
  });

  it('có cả hai thì ưu tiên bản đóng gói', () => {
    // Sau khi chạy thử `build:win`, máy dev có cả hai. Bản vừa đóng gói mới là
    // thứ đang muốn kiểm — giống thứ tự của `resolveSidecarCommand`.
    const found = resolveIconPath({
      resourcesPath: 'C:/app/resources',
      repoRoot: 'D:/repo',
      exists: existsOnly(packagedIcon, devIcon),
    });

    expect(found).toBe(packagedIcon);
  });

  it('không thấy ở đâu thì trả undefined, KHÔNG ném lỗi', () => {
    // Thiếu icon thì cửa sổ mang logo Electron mặc định — xấu, nhưng app vẫn
    // phải mở được. Ném lỗi ở đây là đánh sập app vì một file trang trí.
    const found = resolveIconPath({
      resourcesPath: 'C:/app/resources',
      repoRoot: 'D:/repo',
      exists: () => false,
    });

    expect(found).toBeUndefined();
  });

  it('bỏ qua gốc rỗng thay vì ghép thành đường dẫn tương đối', () => {
    // `process.resourcesPath` là chuỗi rỗng ở vài ngữ cảnh dev. Ghép bừa sẽ ra
    // `icon.ico` tương đối theo cwd — có thể "tồn tại" một cách tình cờ.
    const found = resolveIconPath({
      resourcesPath: '',
      repoRoot: '',
      exists: () => true,
    });

    expect(found).toBeUndefined();
  });
});
