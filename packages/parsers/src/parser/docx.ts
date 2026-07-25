import type { BookFormat } from '@ln/shared';
import type { Page } from '../cleaner/types.js';
import { ParseError, type DocumentParser, type ParsedDocument, type ParseOptions } from './types.js';

/**
 * Parser DOCX dựa trên `mammoth`.
 *
 * DOCX **không có khái niệm trang** — Word chỉ chia trang lúc render. Mỗi
 * paragraph thành một `Page` một dòng để chapter detector dùng lại nguyên
 * vẹn; `pageNumber` khi đó là chỉ số paragraph, và `hasRealPages` = false
 * để UI biết đừng hiển thị "trang X–Y".
 */

/** Một khối nội dung trích từ HTML của mammoth */
export type DocxBlock = {
  text: string;
  /** Mức heading 1–6; `undefined` nghĩa là paragraph thường */
  headingLevel?: number;
  /** Cả khối là chữ in đậm */
  bold: boolean;
};

/** Hàm chuyển DOCX → HTML. Tách ra để test được mà không cần file thật. */
export type DocxConverter = (filePath: string) => Promise<{ html: string }>;

/**
 * Cỡ chữ giả cho heading, để tín hiệu font-size của chapter detector dùng được.
 *
 * DOCX không cho biết cỡ chữ qua HTML của mammoth, nhưng heading **là** tín
 * hiệu mạnh tương đương chữ to trong PDF. Quy đổi: h1 lớn nhất, h6 nhỏ nhất,
 * paragraph thường bằng `BODY_FONT_SIZE`.
 */
const BODY_FONT_SIZE = 10;
const HEADING_FONT_SIZES: Record<number, number> = { 1: 20, 2: 18, 3: 16, 4: 14, 5: 13, 6: 12 };

/** Kích thước trang ảo — chỉ để các hàm dùng toạ độ không chia cho 0 */
const VIRTUAL_PAGE_WIDTH = 600;
const VIRTUAL_PAGE_HEIGHT = 800;
const LINE_HEIGHT = 14;

/** Gỡ thẻ HTML và giải mã entity thường gặp */
export const stripHtml = (html: string): string =>
  html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Tách HTML của mammoth thành các khối.
 *
 * Chỉ nhận `<h1>`–`<h6>` và `<p>` — đó là toàn bộ những gì mammoth sinh ra
 * cho văn bản (đo trên file thật: 386 `<p>` + 2 `<h1>`, không có gì khác).
 */
export const extractBlocks = (html: string): DocxBlock[] => {
  const blocks: DocxBlock[] = [];
  const blockRe = /<(h[1-6]|p)\b[^>]*>(.*?)<\/\1>/gis;

  for (const match of html.matchAll(blockRe)) {
    const tag = match[1]!.toLowerCase();
    const inner = match[2] ?? '';
    const text = stripHtml(inner);
    if (text.length === 0) continue;

    const headingLevel = tag.startsWith('h') ? Number(tag.slice(1)) : undefined;
    // Cả khối in đậm: bỏ thẻ <strong> đi thì không còn chữ nào khác
    const bold = /<strong>/i.test(inner) && stripHtml(inner.replace(/<strong>.*?<\/strong>/gis, '')).length === 0;

    blocks.push({
      text,
      ...(headingLevel === undefined ? {} : { headingLevel }),
      bold,
    });
  }

  return blocks;
};

/**
 * Khối → `Page` một dòng.
 *
 * Heading nhận cỡ chữ giả lớn hơn để tín hiệu font-size chấm điểm được; khối
 * in đậm cũng được nâng nhẹ vì đó là cách đánh dấu tiêu đề phổ biến khi tác
 * giả không dùng heading style.
 */
export const blocksToPages = (blocks: readonly DocxBlock[]): Page[] =>
  blocks.map((block, index) => {
    const fontSize =
      block.headingLevel === undefined
        ? block.bold
          ? BODY_FONT_SIZE * 1.2
          : BODY_FONT_SIZE
        : (HEADING_FONT_SIZES[block.headingLevel] ?? BODY_FONT_SIZE);

    return {
      pageNumber: index + 1,
      width: VIRTUAL_PAGE_WIDTH,
      height: VIRTUAL_PAGE_HEIGHT,
      lines: [
        {
          text: block.text,
          x: 0,
          y: 0,
          // Bề rộng ước lượng theo số ký tự — cleaner dùng để đoán bố cục cột,
          // với DOCX thì luôn một cột nên chỉ cần giá trị nhất quán
          width: Math.min(block.text.length * 6, VIRTUAL_PAGE_WIDTH),
          height: LINE_HEIGHT,
          fontSize,
        },
      ],
    };
  });

export const createDocxParser = (convert: DocxConverter): DocumentParser => ({
  format: 'docx' satisfies BookFormat,
  extensions: ['.docx'],

  async parse(filePath: string, options: ParseOptions = {}): Promise<ParsedDocument> {
    let html: string;
    try {
      ({ html } = await convert(filePath));
    } catch (cause) {
      throw new ParseError('corrupt-file', 'Không đọc được file DOCX. File có thể đã hỏng.', {
        cause,
      });
    }

    const blocks = extractBlocks(html);
    if (blocks.length === 0) {
      throw new ParseError('empty-document', 'File DOCX không có nội dung văn bản nào.');
    }

    const limited =
      options.maxPages === undefined ? blocks : blocks.slice(0, Math.max(options.maxPages, 1));
    const pages = blocksToPages(limited);

    options.onProgress?.(pages.length, pages.length);

    return {
      format: 'docx',
      pages,
      // mammoth không đọc bookmark/TOC field của Word
      outline: [],
      totalPages: blocks.length,
      hasRealPages: false,
    };
  },
});
