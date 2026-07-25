import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Chép `pdf.worker.mjs` vào `apps/main/dist/`.
 *
 * Bản đóng gói chỉ mang theo `apps/main/dist/**` (xem `electron-builder.yml`)
 * — **không** có `node_modules`. Vite bundle được phần code của pdfjs, nhưng
 * worker thì nó nạp bằng `import()` lúc chạy nên phải là file thật nằm cạnh
 * bundle. Thiếu file này thì mọi lần mở PDF đều chết với "Setting up fake
 * worker failed", và lỗi chỉ lộ ra ở bản đã đóng gói.
 *
 * `node-parsers.ts` tìm worker cạnh bundle trước, rồi mới tới `node_modules`.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'packages/parsers/package.json'));

const packageJson = require.resolve('pdfjs-dist/package.json');
const source = join(dirname(packageJson), 'legacy', 'build', 'pdf.worker.mjs');

const outDir = join(root, 'apps', 'main', 'dist');
mkdirSync(outDir, { recursive: true });

const target = join(outDir, 'pdf.worker.mjs');
copyFileSync(source, target);

console.log(`pdf.worker.mjs → ${target}`);
