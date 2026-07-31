import { join } from 'node:path';
import type { PathExists } from './sidecar-paths.js';

/**
 * Tìm icon cho cửa sổ ứng dụng.
 *
 * **Vì sao cần, khi electron-builder đã nhúng icon vào `.exe`:** icon nhúng chỉ
 * lo phần Explorer/taskbar của **bản đóng gói**. Cửa sổ lúc **dev** (`pnpm dev`)
 * không đi qua electron-builder nên vẫn mang logo Electron, và ảnh chụp
 * `ui-check` cũng vậy. Truyền `icon` cho `BrowserWindow` vá đúng khoảng đó.
 *
 * Hai đường đi giống hệt `resolveSidecarCommand`, và **cũng thuần** vì cùng một
 * lý do: đường dẫn sai chỉ lộ ra ở bản đóng gói, nơi không gắn được debugger.
 * Xem mục 4.19 (worker pdfjs) và 4.29a (sidecar) — hai lần cùng một hình dạng.
 *
 * Trả `undefined` khi không thấy. Nơi gọi **không** được coi là lỗi chí mạng:
 * thiếu icon thì cửa sổ mang logo mặc định, còn app vẫn phải chạy.
 */

/** Tên file icon trong `resources/`. Windows x64 only nên `.ico` là cố định. */
export const ICON_FILE_NAME = 'icon.ico';

export type ResolveIconOptions = {
  /** `process.resourcesPath` — chỉ có ở bản đóng gói */
  resourcesPath?: string | undefined;
  /** Gốc repo — chỉ có ý nghĩa lúc dev */
  repoRoot?: string | undefined;
  exists: PathExists;
};

export const resolveIconPath = (options: ResolveIconOptions): string | undefined => {
  const { resourcesPath, repoRoot, exists } = options;

  const candidates: string[] = [];

  // Bản đóng gói trước: khi cả hai cùng có (dev sau khi đã build thử), bản vừa
  // đóng gói mới là thứ đang muốn kiểm.
  if (resourcesPath !== undefined && resourcesPath !== '') {
    candidates.push(join(resourcesPath, ICON_FILE_NAME));
  }
  if (repoRoot !== undefined && repoRoot !== '') {
    candidates.push(join(repoRoot, 'resources', ICON_FILE_NAME));
  }

  return candidates.find((candidate) => exists(candidate));
};
