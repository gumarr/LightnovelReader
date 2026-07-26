/**
 * Đóng gói sidecar thành `.exe` từ gốc workspace.
 *
 * Khác `sidecar-test.mjs`: thiếu venv ở đây là **lỗi thật**, không bỏ qua.
 * `pnpm build:win` mà thiếu sidecar thì bản cài ra vẫn chạy được app nhưng
 * không generate được audio — hỏng lặng lẽ, đúng loại lỗi tệ nhất.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sidecar = join(root, 'sidecar');
const python = join(sidecar, '.venv', 'Scripts', 'python.exe');

if (!existsSync(python)) {
  console.error(
    [
      'Không tìm thấy venv của sidecar — không đóng gói được.',
      'Dựng bằng:',
      '  cd sidecar',
      '  py -3.12 -m venv .venv',
      '  .venv/Scripts/python.exe -m pip install -r requirements-dev.txt',
    ].join('\n'),
  );
  process.exit(1);
}

const result = spawnSync(python, ['-X', 'utf8', 'build.py'], {
  cwd: sidecar,
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
