/**
 * Chạy pytest của sidecar từ gốc workspace.
 *
 * Không gộp vào `pnpm test`: pytest cần venv Python mà máy CI/dev có thể chưa
 * dựng. Thiếu venv thì script báo cách dựng rồi thoát 0 — để `pnpm test` của
 * người chỉ đụng phần TypeScript không đỏ oan.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sidecar = join(root, 'sidecar');
const python = join(sidecar, '.venv', 'Scripts', 'python.exe');

if (!existsSync(python)) {
  console.log(
    [
      'Chưa có venv cho sidecar — bỏ qua pytest.',
      'Dựng bằng:',
      '  cd sidecar',
      '  py -3.12 -m venv .venv',
      '  .venv/Scripts/python.exe -m pip install -r requirements-dev.txt',
    ].join('\n'),
  );
  process.exit(0);
}

const result = spawnSync(python, ['-X', 'utf8', '-m', 'pytest', 'tests/'], {
  cwd: sidecar,
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
