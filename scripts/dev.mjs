import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import electron from 'electron';

/**
 * Chạy dev: Vite dev server cho renderer + build watch main/preload + Electron.
 *
 * Electron chỉ khởi động sau khi dev server sẵn sàng và preload đã build xong,
 * nếu không cửa sổ sẽ mở ra với `window.api` chưa tồn tại.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const children = [];
let electronProcess = null;
let shuttingDown = false;

const run = (command, args, cwd, label) => {
  const child = spawn(command, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  child.on('exit', (code) => {
    if (shuttingDown || code === 0 || code === null) return;
    console.error(`[dev] ${label} thoát với mã ${code}`);
    shutdown(code);
  });

  children.push(child);
  return child;
};

const shutdown = (code = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;

  electronProcess?.kill();
  for (const child of children) child.kill();
  process.exit(code);
};

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

/** Chờ tới khi file tồn tại, tránh mở Electron trước lúc build xong */
const waitForFile = async (file, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(file)) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Chờ quá lâu mà không thấy ${file}`);
};

const main = async () => {
  // 1. Renderer dev server
  // `root` phải trỏ vào apps/renderer, nếu không Vite tìm react ở root
  // workspace (nơi không có) và báo lỗi resolve dependency.
  const server = await createServer({
    root: join(root, 'apps/renderer'),
    configFile: join(root, 'apps/renderer/vite.config.ts'),
  });
  await server.listen();

  const address = server.resolvedUrls?.local?.[0];
  if (address === undefined) {
    throw new Error('Vite dev server không trả về địa chỉ local');
  }
  console.log(`[dev] Renderer: ${address}`);

  // 2. Build preload trước, Electron cần file này lúc tạo cửa sổ
  await new Promise((resolve, reject) => {
    const build = spawn('npx', ['vite', 'build'], {
      cwd: join(root, 'apps/preload'),
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    build.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`Build preload lỗi, mã ${code}`)),
    );
  });

  // 3. Watch main + preload
  run('npx', ['vite', 'build', '--watch'], join(root, 'apps/main'), 'main');
  run('npx', ['vite', 'build', '--watch'], join(root, 'apps/preload'), 'preload');

  // 4. Đợi main build xong lần đầu rồi mở Electron.
  //    Chờ file thật xuất hiện thay vì hẹn giờ cố định — máy chậm vẫn chạy đúng.
  await waitForFile(join(root, 'apps/main/dist/index.cjs'), 60_000);

  electronProcess = spawn(electron, [join(root, 'apps/main')], {
    stdio: 'inherit',
    env: { ...process.env, VITE_DEV_SERVER_URL: address, NODE_ENV: 'development' },
  });

  electronProcess.on('exit', () => shutdown(0));
};

main().catch((error) => {
  console.error('[dev] Lỗi khởi động:', error);
  shutdown(1);
});
