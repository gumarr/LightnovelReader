import type { BookFormat } from '@ln/shared';
import type { Page, TextLine } from '../cleaner/types.js';
import type { OutlineEntry } from '../chapter-detector/types.js';
import { ParseError, type DocumentParser, type ParsedDocument, type ParseOptions } from './types.js';

/**
 * Parser PDF dựa trên `pdfjs-dist`.
 *
 * Không hỗ trợ PDF scan (ảnh, không có text layer) — phát hiện sớm và báo
 * lỗi rõ ràng thay vì trả về tài liệu rỗng khiến user tưởng app hỏng.
 */

/** Chiều cao hàng dùng để gom item thành dòng (point) */
const ROW_QUANTIZE = 3;

/**
 * Tỉ lệ trang phải có text thì mới coi là PDF có text layer.
 * PDF sách thật luôn có vài trang ảnh (bìa, minh hoạ) nên không đòi 100%.
 */
const MIN_TEXT_PAGE_RATIO = 0.2;

/** Số trang lấy mẫu để phát hiện PDF scan — không cần đọc cả sách */
const SCAN_PROBE_PAGES = 20;

/**
 * Kiểu tối thiểu của pdfjs mà parser cần. Khai báo tại chỗ để không phụ
 * thuộc kiểu nội bộ của thư viện (chúng đổi giữa các bản).
 */
type PdfTextItem = {
  str: string;
  width: number;
  height: number;
  transform: number[];
};

type PdfPage = {
  getViewport(params: { scale: number }): { width: number; height: number };
  getTextContent(): Promise<{ items: unknown[] }>;
};

type PdfDocument = {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPage>;
  getTextContent?: never;
  getOutline(): Promise<PdfOutlineItem[] | null>;
  getDestination(id: string): Promise<unknown[] | null>;
  getPageIndex(ref: unknown): Promise<number>;
};

type PdfOutlineItem = {
  title: string;
  dest: string | unknown[] | null;
  items?: PdfOutlineItem[];
};

/**
 * Hàm nạp tài liệu. Tách ra làm tham số để test được mà không cần file thật,
 * và để `apps/main` truyền bản pdfjs đã cấu hình riêng cho Electron.
 */
export type PdfLoader = (filePath: string) => Promise<PdfDocument>;

const isTextItem = (item: unknown): item is PdfTextItem => {
  if (typeof item !== 'object' || item === null) return false;
  const candidate = item as Record<string, unknown>;
  return (
    typeof candidate['str'] === 'string' &&
    typeof candidate['width'] === 'number' &&
    typeof candidate['height'] === 'number' &&
    Array.isArray(candidate['transform'])
  );
};

/**
 * Gom các item rời của pdfjs thành dòng.
 *
 * pdfjs trả text theo thứ tự vẽ với gốc toạ độ ở góc **dưới**-trái, trong
 * khi phần còn lại của codebase dùng góc trên-trái. Hàm này lo cả hai việc.
 */
export const groupItemsIntoLines = (
  items: readonly unknown[],
  viewportHeight: number,
): TextLine[] => {
  // Gom theo **khoảng cách thực tế** thay vì chia bucket cố định: hai item
  // lệch 1pt vẫn có thể rơi khác bucket nếu nằm sát ranh giới, khiến một
  // dòng chữ bị tách làm đôi.
  const positioned: { yTop: number; item: PdfTextItem }[] = [];

  for (const item of items) {
    if (!isTextItem(item)) continue;
    if (item.str.trim().length === 0) continue;

    const yBottom = item.transform[5];
    if (typeof yBottom !== 'number') continue;

    positioned.push({ yTop: viewportHeight - yBottom, item });
  }

  positioned.sort((a, b) => a.yTop - b.yTop);

  const rows: { yTop: number; items: PdfTextItem[] }[] = [];
  for (const { yTop, item } of positioned) {
    const current = rows.at(-1);
    if (current !== undefined && yTop - current.yTop <= ROW_QUANTIZE) {
      current.items.push(item);
      continue;
    }
    rows.push({ yTop, items: [item] });
  }

  return rows
    .map((row) => {
      const sorted = [...row.items].sort((a, b) => (a.transform[4] ?? 0) - (b.transform[4] ?? 0));
      const xs = sorted.map((i) => i.transform[4] ?? 0);
      const x = Math.min(...xs);
      const right = Math.max(...sorted.map((i, n) => (xs[n] ?? 0) + i.width));
      const height = Math.max(...sorted.map((i) => i.height));

      return {
        text: sorted
          .map((i) => i.str)
          .join('')
          .replace(/\s+/g, ' ')
          .trim(),
        x,
        y: row.yTop,
        width: right - x,
        height,
        // Cỡ chữ suy từ chiều cao glyph — chapter detector cần để so với thân bài
        fontSize: height,
      };
    })
    .filter((line) => line.text.length > 0);
};

/** Đọc outline, phân giải đích tới số trang */
export const readOutline = async (doc: PdfDocument): Promise<OutlineEntry[]> => {
  const raw = await doc.getOutline();
  if (raw === null || raw.length === 0) return [];

  const entries: OutlineEntry[] = [];

  // Outline lồng nhau: mục con cũng là chương thật, phải lấy hết
  const walk = async (items: readonly PdfOutlineItem[]): Promise<void> => {
    for (const item of items) {
      const pageNumber = await resolveDestination(doc, item.dest);
      entries.push(pageNumber === undefined ? { title: item.title } : { title: item.title, pageNumber });
      if (item.items !== undefined && item.items.length > 0) await walk(item.items);
    }
  };

  await walk(raw);
  return entries;
};

/**
 * Đích outline → số trang.
 *
 * PDF hỏng đích là chuyện thường; nuốt lỗi ở đây là đúng chỗ vì mục outline
 * hỏng không được phép làm hỏng cả lần import — mục đó chỉ bị bỏ qua.
 */
const resolveDestination = async (
  doc: PdfDocument,
  dest: string | unknown[] | null,
): Promise<number | undefined> => {
  if (dest === null) return undefined;

  try {
    const resolved = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
    const ref = Array.isArray(resolved) ? resolved[0] : undefined;
    if (ref === undefined || ref === null) return undefined;
    return (await doc.getPageIndex(ref)) + 1;
  } catch {
    return undefined;
  }
};

/**
 * PDF có text layer dùng được không.
 *
 * Lấy mẫu vài trang đầu thay vì đọc cả sách — file scan 300 trang mà đọc hết
 * mới báo lỗi thì user chờ vô ích.
 */
export const hasTextLayer = async (doc: PdfDocument, probePages = SCAN_PROBE_PAGES): Promise<boolean> => {
  const limit = Math.min(doc.numPages, probePages);
  if (limit === 0) return false;

  let withText = 0;
  for (let p = 1; p <= limit; p += 1) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const hasText = content.items.some((item) => isTextItem(item) && item.str.trim().length > 0);
    if (hasText) withText += 1;
  }

  return withText / limit >= MIN_TEXT_PAGE_RATIO;
};

export const createPdfParser = (load: PdfLoader): DocumentParser => ({
  format: 'pdf' satisfies BookFormat,
  extensions: ['.pdf'],

  async parse(filePath: string, options: ParseOptions = {}): Promise<ParsedDocument> {
    let doc: PdfDocument;
    try {
      doc = await load(filePath);
    } catch (cause) {
      throw new ParseError('corrupt-file', 'Không đọc được file PDF. File có thể đã hỏng.', {
        cause,
      });
    }

    if (doc.numPages === 0) {
      throw new ParseError('empty-document', 'File PDF không có trang nào.');
    }

    if (!(await hasTextLayer(doc))) {
      throw new ParseError(
        'scanned-pdf',
        'PDF này là bản scan (chỉ có ảnh, không có text). ' +
          'Ứng dụng cần text để tạo audio — hãy dùng bản PDF có text layer, ' +
          'hoặc chạy OCR trước khi import.',
      );
    }

    const limit = Math.min(doc.numPages, options.maxPages ?? doc.numPages);
    const pages: Page[] = [];

    for (let p = 1; p <= limit; p += 1) {
      const page = await doc.getPage(p);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();

      pages.push({
        pageNumber: p,
        width: viewport.width,
        height: viewport.height,
        lines: groupItemsIntoLines(content.items, viewport.height),
      });

      options.onProgress?.(p, limit);
    }

    return {
      format: 'pdf',
      pages,
      outline: await readOutline(doc),
      totalPages: doc.numPages,
      hasRealPages: true,
    };
  },
});
