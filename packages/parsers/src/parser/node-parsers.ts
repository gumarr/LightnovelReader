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
 * Nạp pdfjs động.
 *
 * Dùng bản `legacy` vì bản mặc định yêu cầu API trình duyệt (`DOMMatrix`,
 * `Path2D`) mà Node và Electron main process không có.
 *
 * `import()` động thay vì import tĩnh: pdfjs là ESM nặng, không nên kéo vào
 * mỗi lần nạp module — chỉ trả giá khi thật sự mở file.
 */
export const nodePdfLoader: PdfLoader = async (filePath: string) => {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');

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
