import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import mammoth from 'mammoth';
import { createDocxParser, type DocxConverter } from './docx.js';
import { createPdfParser, type PdfLoader } from './pdf.js';
import { createRegistry, type ParserRegistry } from './registry.js';

/**
 * Nối parser với thư viện thật.
 *
 * Tách khỏi `pdf.ts`/`docx.ts` để phần logic vẫn test được bằng fake, còn
 * file này là chỗ duy nhất chạm vào `pdfjs-dist` và `mammoth`.
 */

/**
 * Bù `DOMMatrix` trước khi nạp pdfjs.
 *
 * Bản `legacy` tự polyfill, **nhưng chỉ khi** nó nhận ra đang chạy dưới Node.
 * Trong Electron main thì `process.type === 'browser'` nên pdfjs tưởng mình ở
 * trình duyệt và bỏ qua bước polyfill — trong khi Electron main lại KHÔNG có
 * `DOMMatrix` thật. Module pdfjs có `const SCALE_MATRIX = new DOMMatrix()` ở
 * cấp cao nhất, nên thiếu nó là ném `ReferenceError` ngay lúc import, trước
 * khi chạm tới bất kỳ file PDF nào.
 *
 * Chỉ cần đủ để `new DOMMatrix()` không ném: parser chỉ trích text, không bao
 * giờ gọi `getViewport().transform` hay render canvas. Cố tình KHÔNG cài
 * `@napi-rs/canvas` (thêm ~40 MB native chỉ để dựng một ma trận không dùng).
 *
 * Lỗi này chỉ lộ ra khi chạy trong Electron thật — dưới vitest, `isNodeJS`
 * đúng nên pdfjs tự xoay xở được và mọi thứ có vẻ ổn.
 */
const ensureDomMatrix = (): void => {
  const target = globalThis as { DOMMatrix?: unknown };
  if (target.DOMMatrix !== undefined) return;

  // Ma trận đơn vị 2D theo thứ tự pdfjs dùng: [a, b, c, d, e, f]
  class MinimalDOMMatrix {
    a = 1;
    b = 0;
    c = 0;
    d = 1;
    e = 0;
    f = 0;

    constructor(init?: number[] | string) {
      if (!Array.isArray(init)) return;
      const [a, b, c, d, e, f] = init;
      if (a !== undefined) this.a = a;
      if (b !== undefined) this.b = b;
      if (c !== undefined) this.c = c;
      if (d !== undefined) this.d = d;
      if (e !== undefined) this.e = e;
      if (f !== undefined) this.f = f;
    }
  }

  target.DOMMatrix = MinimalDOMMatrix;
};

/** Tên file worker của pdfjs. `scripts/copy-pdf-worker.mjs` dùng cùng tên này. */
export const WORKER_FILE_NAME = 'pdf.worker.mjs';

/**
 * Gốc để phân giải file. Chạy ở hai dạng: ESM (vitest resolve thẳng source
 * TS) và CJS (sau khi vite bundle cho main process). `__filename` chỉ có ở
 * dạng sau, `import.meta.url` chỉ có ở dạng trước.
 */
const selfPath = (): string =>
  typeof __filename === 'string' ? __filename : fileURLToPath(import.meta.url);

export type WorkerLookup = {
  /** Thư mục chứa file đang chạy (bundle hoặc source) */
  selfDir: string;
  fileExists: (path: string) => boolean;
  /** Phân giải `pdfjs-dist/package.json` qua node_modules */
  resolvePackageJson: () => string;
};

/**
 * Đường dẫn tới `pdf.worker.mjs`, tìm theo hai bước — **thứ tự quan trọng**:
 *
 * 1. Cạnh chính file bundle. Bản đóng gói chỉ mang theo `apps/main/dist/**`
 *    (xem `electron-builder.yml`) — KHÔNG có `node_modules`, nên đây là chỗ
 *    duy nhất tìm được. `scripts/copy-pdf-worker.mjs` chép file vào lúc build.
 * 2. Qua `node_modules`. Dùng khi chạy test/dev, lúc chưa chạy bước chép.
 *
 * Trả về `file://` URL: pdfjs `import()` giá trị này, mà đường dẫn Windows
 * dạng `D:\...` bị hiểu nhầm thành URL scheme `d:`.
 */
export const findWorkerSrc = (lookup: WorkerLookup): string => {
  const beside = join(lookup.selfDir, WORKER_FILE_NAME);
  if (lookup.fileExists(beside)) return pathToFileURL(beside).href;

  const packageDir = dirname(lookup.resolvePackageJson());
  return pathToFileURL(join(packageDir, 'legacy', 'build', WORKER_FILE_NAME)).href;
};

const resolveWorkerSrc = (): string =>
  findWorkerSrc({
    selfDir: dirname(selfPath()),
    fileExists: existsSync,
    resolvePackageJson: () => createRequire(selfPath()).resolve('pdfjs-dist/package.json'),
  });

/**
 * Nạp pdfjs động.
 *
 * Dùng bản `legacy` vì bản mặc định yêu cầu API trình duyệt (`DOMMatrix`,
 * `Path2D`) mà Node và Electron main process không có.
 *
 * `import()` động thay vì import tĩnh: pdfjs là ESM nặng, không nên kéo vào
 * mỗi lần nạp module — chỉ trả giá khi thật sự mở file.
 */
export const nodePdfLoader: PdfLoader = async (filePath: string) => {
  ensureDomMatrix();
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { getDocument, GlobalWorkerOptions } = pdfjs;

  // pdfjs tự đặt `workerSrc = "./pdf.worker.mjs"` ngay lúc import — tương đối
  // với **file bundle**, nơi không hề có worker sau khi vite gộp mọi thứ lại.
  // Không sửa thì mọi lần mở PDF đều chết với "Setting up fake worker failed".
  //
  // Phải gán đè (không dùng `||=`): giá trị mặc định kia đã là chuỗi không
  // rỗng nên `||=` sẽ bỏ qua, và lỗi vẫn còn nguyên.
  //
  // Trỏ thẳng vào file thật trong package. Worker này chạy cùng luồng (pdfjs
  // gọi là "fake worker") — chấp nhận được vì parse chỉ diễn ra lúc import.
  GlobalWorkerOptions.workerSrc = resolveWorkerSrc();

  // Chỉ đặt tuỳ chọn có thật trong pdfjs v6. Bản cũ có `disableWorker` và
  // `isEvalSupported`, v6 đã bỏ — thêm vào sẽ lỗi typecheck chứ không im lặng.
  const task = getDocument({
    url: filePath,
    // Không có font nhúng thì lấy font hệ thống, tránh text rỗng
    useSystemFonts: true,
  });

  return (await task.promise) as never;
};

export const nodeDocxConverter: DocxConverter = async (filePath: string) => {
  const { value } = await mammoth.convertToHtml({ path: filePath });
  return { html: value };
};

/** Registry dùng trong main process, đã nối thư viện thật */
export const createNodeParserRegistry = (): ParserRegistry =>
  createRegistry([createPdfParser(nodePdfLoader), createDocxParser(nodeDocxConverter)]);
