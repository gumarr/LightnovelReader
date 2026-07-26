import { join } from 'node:path';

/**
 * Tìm chương trình sidecar để spawn.
 *
 * Có hai đường đi hoàn toàn khác nhau, và đây là chỗ **duy nhất** biết điều đó:
 *
 * - **Lúc dev**: chạy mã nguồn Python bằng interpreter của venv
 *   (`sidecar/.venv/Scripts/python.exe -m app.server`, cwd = `sidecar/`).
 * - **Bản đóng gói**: chạy file `.exe` do PyInstaller sinh ra, nằm trong
 *   `resources/sidecar/`. Máy user không có Python.
 *
 * Hàm ở đây **thuần**: nhận đường dẫn gốc + hàm kiểm tra tồn tại, không tự gọi
 * `fs` hay `app.getAppPath()`. Nhờ vậy test khoá được thứ tự tìm kiếm mà không
 * cần dựng cây thư mục thật — đúng bài học ở mục 4.19 (worker của pdfjs), nơi
 * đường dẫn sai chỉ lộ ra ở bản đóng gói.
 */

/** Kiểm tra một đường dẫn có tồn tại không. Tách ra để test không cần fs thật. */
export type PathExists = (path: string) => boolean;

export type SidecarCommand = {
  /** File thực thi để spawn */
  command: string;
  /** Tham số dòng lệnh. KHÔNG bao giờ chứa token — xem `sidecar/app/config.py` */
  args: string[];
  /** Thư mục làm việc của tiến trình con */
  cwd: string;
  /** `true` khi chạy từ mã nguồn bằng venv (chỉ có lúc dev) */
  fromSource: boolean;
};

/**
 * Tên file thực thi PyInstaller sinh ra. Chỉ nhắm Windows x64 (xem CLAUDE.md)
 * nên đuôi `.exe` là cố định, không suy theo `process.platform`.
 */
export const SIDECAR_EXE_NAME = 'ln-sidecar.exe';

/** Interpreter trong venv của sidecar */
export const VENV_PYTHON_RELATIVE = join('.venv', 'Scripts', 'python.exe');

export type ResolveSidecarOptions = {
  /**
   * Thư mục `resources/` của bản đóng gói (`process.resourcesPath`).
   * `undefined` lúc dev vì Electron chưa đóng gói.
   */
  resourcesPath?: string | undefined;
  /** Gốc repo — chỉ có ý nghĩa lúc dev, nơi thư mục `sidecar/` còn tồn tại */
  repoRoot?: string | undefined;
  exists: PathExists;
};

/**
 * Trả về lệnh spawn sidecar, hoặc `undefined` nếu không tìm thấy ở đâu cả.
 *
 * Thứ tự **bản đóng gói trước**: ở bản đóng gói `repoRoot` không tồn tại nên
 * nhánh dev tự rụng, nhưng lúc dev thì cả hai đều có thể có (khi đã chạy thử
 * `build.py`) — lúc đó `.exe` mới build là thứ ta muốn kiểm, không phải mã nguồn.
 */
export const resolveSidecarCommand = (
  options: ResolveSidecarOptions,
): SidecarCommand | undefined => {
  const { resourcesPath, repoRoot, exists } = options;

  if (resourcesPath !== undefined && resourcesPath !== '') {
    const dir = join(resourcesPath, 'sidecar');
    const exe = join(dir, SIDECAR_EXE_NAME);
    if (exists(exe)) {
      // cwd đặt vào thư mục chứa exe: PyInstaller onedir để .dll và dữ liệu
      // cạnh file thực thi.
      return { command: exe, args: [], cwd: dir, fromSource: false };
    }
  }

  if (repoRoot !== undefined && repoRoot !== '') {
    const dir = join(repoRoot, 'sidecar');
    const python = join(dir, VENV_PYTHON_RELATIVE);
    if (exists(python)) {
      // `-X utf8`: không có nó thì thông báo lỗi tiếng Việt in ra stderr bị mã
      // hoá lung tung trên Windows (xem PROGRESS mục 5.4).
      return { command: python, args: ['-X', 'utf8', '-m', 'app.server'], cwd: dir, fromSource: true };
    }
  }

  return undefined;
};

/**
 * Thông báo khi không tìm thấy sidecar. Tách ra để cả supervisor lẫn test dùng
 * chung một câu chữ — user cần biết phải làm gì, không chỉ biết là hỏng.
 */
export const sidecarNotFoundMessage = (options: {
  resourcesPath?: string | undefined;
  repoRoot?: string | undefined;
}): string => {
  const { repoRoot } = options;
  if (repoRoot !== undefined && repoRoot !== '') {
    return (
      'Không tìm thấy sidecar. Lúc dev cần dựng venv trước:\n' +
      `  cd ${join(repoRoot, 'sidecar')}\n` +
      '  py -3.12 -m venv .venv\n' +
      '  .venv/Scripts/python.exe -m pip install -r requirements-dev.txt'
    );
  }
  return 'Không tìm thấy sidecar trong bản cài đặt. Cài lại ứng dụng có thể khắc phục.';
};
