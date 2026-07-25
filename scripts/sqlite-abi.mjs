import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * better-sqlite3 là native module: file `.node` chỉ nạp được bởi runtime có
 * đúng ABI. Node 22 dùng ABI 127, Electron 33 dùng ABI 130 — một bản build
 * không phục vụ được cả hai.
 *
 * Script này giữ sẵn hai bản trong `.abi-cache/` và tráo bản đúng vào chỗ
 * better-sqlite3 nạp:
 *   node scripts/sqlite-abi.mjs node       # trước khi chạy test
 *   node scripts/sqlite-abi.mjs electron   # trước khi chạy app
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const target = process.argv[2];
if (target !== 'node' && target !== 'electron') {
  console.error('Dùng: node scripts/sqlite-abi.mjs <node|electron>');
  process.exit(1);
}

const sqliteDir = dirname(
  dirname(require.resolve('better-sqlite3', { paths: [join(root, 'apps/main')] })),
);
const binary = join(sqliteDir, 'build', 'Release', 'better_sqlite3.node');
const cacheDir = join(root, '.abi-cache');
const cached = join(cacheDir, `better_sqlite3-${target}.node`);

/**
 * Phiên bản Electron phải resolve động.
 *
 * Trước đây hardcode `node_modules/.pnpm/electron@33.4.11/...` — chỉ cần
 * pnpm cài bản patch khác (điều luôn xảy ra trên CI vì máy sạch) là script
 * ném `Cannot find module`.
 */
const electronVersion = require(
  require.resolve('electron/package.json', { paths: [root] }),
).version;

/** Tải bản prebuilt cho runtime yêu cầu */
const download = () => {
  const args =
    target === 'electron'
      ? ['prebuild-install', '--runtime', 'electron', '--target', electronVersion]
      : ['prebuild-install', '--runtime', 'node', '--target', process.versions.node];

  const result = spawnSync('npx', [...args, '--arch', 'x64', '--platform', 'win32'], {
    cwd: sqliteDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.status !== 0) {
    throw new Error(`Tải prebuild cho ${target} thất bại (mã ${result.status})`);
  }
};

mkdirSync(cacheDir, { recursive: true });

if (existsSync(cached)) {
  copyFileSync(cached, binary);
  console.log(`[sqlite-abi] Dùng bản ${target} từ cache`);
} else {
  download();
  copyFileSync(binary, cached);
  console.log(`[sqlite-abi] Đã tải và lưu cache bản ${target}`);
}
