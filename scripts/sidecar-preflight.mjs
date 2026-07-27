/**
 * Kiểm `sidecar/dist/ln-sidecar/` đã sẵn sàng trước khi electron-builder chạy.
 *
 * **Vì sao cần script này.** `electron-builder.yml` khai `extraResources` lấy từ
 * `sidecar/dist/ln-sidecar`. Nếu thư mục đó chưa có, electron-builder **không**
 * coi là lỗi — nó chép được gì thì chép, rồi báo build thành công. Bản cài ra
 * mở lên vẫn đọc được sách, chỉ đến lúc user bấm generate mới lộ ra là không có
 * sidecar. Hỏng lặng lẽ, đúng loại lỗi tệ nhất (PROGRESS mục 8, nợ mức Cao).
 *
 * Script này **không** tự build. `build:win` gọi `build:sidecar` trước rồi mới
 * gọi tới đây, nên tới lúc này thiếu file nghĩa là bước build kia đã hỏng mà mã
 * thoát vẫn 0 — chính là thứ cần chặn.
 *
 * Ba thứ được kiểm, tương ứng ba cách hỏng đã gặp thật:
 *
 * 1. **Thiếu `.exe`** — chưa chạy `build:sidecar` lần nào, hoặc PyInstaller trả 0
 *    mà file cuối vẫn thiếu (xem `sidecar/build.py::verify`).
 * 2. **Thiếu `_internal/`** — onedir mà chỉ còn `.exe` thì chạy lên là chết ngay.
 * 3. **`.exe` cũ hơn mã nguồn Python** — sửa sidecar rồi quên build lại. Bản cài
 *    sẽ mang sidecar của lần trước, và không có gì báo. Đây là cách hỏng duy
 *    nhất mà mắt thường không thấy được.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sidecarDir = join(root, 'sidecar');
const outputDir = join(sidecarDir, 'dist', 'ln-sidecar');

// Phải khớp `SIDECAR_EXE_NAME` ở `apps/main/src/services/sidecar-paths.ts` và
// `EXE_NAME` ở `sidecar/build.py`. Ba chỗ, một cái tên — lệch thì bản đóng gói
// không tìm thấy sidecar trong khi mọi unit test vẫn xanh.
const EXE_NAME = 'ln-sidecar.exe';

const HOW_TO_BUILD = [
  'Dựng lại bằng:',
  '  pnpm build:sidecar',
  '',
  'Cần venv của sidecar trước đó:',
  '  cd sidecar',
  '  py -3.12 -m venv .venv',
  '  .venv/Scripts/python.exe -m pip install -r requirements-dev.txt',
].join('\n');

/** Báo lỗi rồi thoát khác 0 — chặn electron-builder chạy tiếp. */
const fail = (lines) => {
  console.error(['[preflight] LỖI:', ...lines, '', HOW_TO_BUILD].join('\n'));
  process.exit(1);
};

const exe = join(outputDir, EXE_NAME);
if (!existsSync(exe)) {
  fail([
    `Không thấy ${relative(root, exe)}.`,
    'Bản cài sẽ ra được nhưng KHÔNG generate được audio.',
  ]);
}

// PyInstaller onedir đặt DLL + dữ liệu (espeak-ng-data, onnxruntime) ở
// `_internal/`. Có `.exe` mà thiếu thư mục này thì tiến trình chết lúc khởi
// động, và lỗi chỉ hiện ở stderr của tiến trình con.
const internal = join(outputDir, '_internal');
if (!existsSync(internal)) {
  fail([
    `Có ${EXE_NAME} nhưng thiếu ${relative(root, internal)}.`,
    'Thư mục onedir không đầy đủ — sidecar sẽ chết lúc khởi động.',
  ]);
}

/** Thời điểm sửa gần nhất trong cây `.py`, bỏ qua venv và kết quả build. */
const latestSourceMtime = (dir) => {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.venv' || entry.name === 'dist' || entry.name === 'build') continue;
    if (entry.name === '__pycache__' || entry.name === 'tests') continue;

    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      newest = Math.max(newest, latestSourceMtime(full));
    } else if (entry.name.endsWith('.py')) {
      newest = Math.max(newest, statSync(full).mtimeMs);
    }
  }
  return newest;
};

const exeMtime = statSync(exe).mtimeMs;
const sourceMtime = latestSourceMtime(sidecarDir);

if (sourceMtime > exeMtime) {
  const ageMinutes = Math.round((sourceMtime - exeMtime) / 60_000);
  fail([
    `${EXE_NAME} cũ hơn mã nguồn Python (${ageMinutes} phút).`,
    'Bản cài sẽ mang sidecar của lần build trước, không phải mã hiện tại.',
  ]);
}

const totalBytes = (dir) => {
  let sum = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    sum += entry.isDirectory() ? totalBytes(full) : statSync(full).size;
  }
  return sum;
};

const sizeMb = (totalBytes(outputDir) / (1024 * 1024)).toFixed(1);
console.log(`[preflight] OK: ${EXE_NAME} mới hơn mã nguồn, thư mục ${sizeMb} MB`);
