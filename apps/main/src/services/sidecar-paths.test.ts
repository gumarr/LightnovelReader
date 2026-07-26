import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import {
  SIDECAR_EXE_NAME,
  VENV_PYTHON_RELATIVE,
  resolveSidecarCommand,
  sidecarNotFoundMessage,
} from './sidecar-paths.js';

/**
 * Đường dẫn sidecar là thứ hỏng riêng ở bản đóng gói mà unit test thường
 * không lộ — chính xác vết xe đổ của worker pdfjs (PROGRESS mục 4.19). Test ở
 * đây khoá **thứ tự tìm kiếm**, không khoá sự tồn tại của file thật.
 */

const packagedExe = join('C:/app/resources', 'sidecar', SIDECAR_EXE_NAME);
const devPython = join('D:/repo', 'sidecar', VENV_PYTHON_RELATIVE);

/** `exists` giả: chỉ những path liệt kê ra mới coi là có */
const existsOnly =
  (...paths: string[]) =>
  (path: string): boolean =>
    paths.includes(path);

describe('resolveSidecarCommand', () => {
  it('bản đóng gói: chạy .exe trong resources/sidecar', () => {
    const command = resolveSidecarCommand({
      resourcesPath: 'C:/app/resources',
      exists: existsOnly(packagedExe),
    });

    expect(command).toEqual({
      command: packagedExe,
      args: [],
      cwd: join('C:/app/resources', 'sidecar'),
      fromSource: false,
    });
  });

  it('lúc dev: chạy python của venv với -m app.server', () => {
    const command = resolveSidecarCommand({
      repoRoot: 'D:/repo',
      exists: existsOnly(devPython),
    });

    expect(command?.command).toBe(devPython);
    expect(command?.args).toEqual(['-X', 'utf8', '-m', 'app.server']);
    expect(command?.cwd).toBe(join('D:/repo', 'sidecar'));
    expect(command?.fromSource).toBe(true);
  });

  it('cwd là thư mục sidecar, không phải gốc repo — `-m app.server` cần đúng cwd', () => {
    const command = resolveSidecarCommand({ repoRoot: 'D:/repo', exists: existsOnly(devPython) });
    expect(command?.cwd).toBe(join('D:/repo', 'sidecar'));
    expect(command?.cwd).not.toBe('D:/repo');
  });

  it('có cả hai thì ưu tiên bản đóng gói: .exe vừa build mới là thứ cần kiểm', () => {
    const command = resolveSidecarCommand({
      resourcesPath: 'C:/app/resources',
      repoRoot: 'D:/repo',
      exists: existsOnly(packagedExe, devPython),
    });

    expect(command?.fromSource).toBe(false);
    expect(command?.command).toBe(packagedExe);
  });

  it('không tìm thấy ở đâu thì trả undefined, không ném', () => {
    expect(
      resolveSidecarCommand({
        resourcesPath: 'C:/app/resources',
        repoRoot: 'D:/repo',
        exists: () => false,
      }),
    ).toBeUndefined();
  });

  it('thiếu cả hai gốc thì trả undefined', () => {
    expect(resolveSidecarCommand({ exists: () => true })).toBeUndefined();
  });

  it('tham số nào có nhưng rỗng thì bỏ qua, không ghép thành đường dẫn tương đối', () => {
    // Chuỗi rỗng lọt vào `join` sẽ cho `sidecar/...` tương đối với cwd hiện
    // tại — spawn một file bất kỳ trùng tên là chuyện không được phép xảy ra.
    expect(resolveSidecarCommand({ resourcesPath: '', repoRoot: '', exists: () => true })).toBeUndefined();
  });

  it('KHÔNG bao giờ đặt token vào args — Windows cho đọc command line tiến trình khác', () => {
    const dev = resolveSidecarCommand({ repoRoot: 'D:/repo', exists: existsOnly(devPython) });
    const packaged = resolveSidecarCommand({
      resourcesPath: 'C:/app/resources',
      exists: existsOnly(packagedExe),
    });

    for (const args of [dev?.args ?? [], packaged?.args ?? []]) {
      expect(args.join(' ').toLowerCase()).not.toContain('token');
    }
  });
});

describe('sidecarNotFoundMessage', () => {
  it('lúc dev thì chỉ rõ cách dựng venv', () => {
    const message = sidecarNotFoundMessage({ repoRoot: 'D:/repo' });
    expect(message).toContain('py -3.12 -m venv .venv');
    expect(message).toContain(join('D:/repo', 'sidecar'));
  });

  it('bản đóng gói thì không nhắc venv — máy user không có Python', () => {
    const message = sidecarNotFoundMessage({ resourcesPath: 'C:/app/resources' });
    expect(message).not.toContain('venv');
    expect(message).toContain('Cài lại ứng dụng');
  });
});
