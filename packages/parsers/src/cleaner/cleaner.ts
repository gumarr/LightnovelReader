import { isTableOfContents, type TocOptions } from '../chapter-detector/signals/toc.js';
import { reorderColumns, type ColumnOptions } from './columns.js';
import { dehyphenate, type DehyphenateOptions } from './dehyphenate.js';
import { stripHeadersFooters, type HeaderFooterOptions } from './header-footer.js';
import { mergeLines, type MergeLinesOptions } from './merge-lines.js';
import type { Page } from './types.js';

/**
 * Ghép bốn bước làm sạch thành một pipeline.
 *
 * Thứ tự **bắt buộc**: bỏ header/footer → sắp lại cột → nối từ bị ngắt →
 * nối dòng. Đổi thứ tự sẽ sai:
 * - header/footer phải bỏ trước khi sắp cột, nếu không số trang nằm giữa
 *   trang sẽ bị coi là dòng thân và làm nhiễu thống kê rãnh;
 * - de-hyphenate phải chạy trước merge-lines vì nó cần thấy ký tự `\n`.
 */

export type CleanOptions = {
  headerFooter?: HeaderFooterOptions;
  columns?: ColumnOptions;
  dehyphenate?: DehyphenateOptions;
  mergeLines?: MergeLinesOptions;
  tableOfContents?: TocOptions;
  /** Bỏ nội dung trang mục lục. Mặc định bật. */
  skipTableOfContents?: boolean;
};

export type CleanedPage = {
  pageNumber: number;
  text: string;
  /** Trang bị nhận là mục lục — text để rỗng, xem `skipTableOfContents` */
  isTableOfContents?: boolean;
};

/** Ghép các dòng của một trang thành text thô, mỗi dòng một `\n` */
const pageToText = (page: Page): string => page.lines.map((line) => line.text.trim()).join('\n');

/**
 * Làm sạch text theo trang. Trả về text từng trang để chapter detector còn
 * ánh xạ được chương ↔ khoảng trang.
 */
export const cleanPages = (pages: readonly Page[], options: CleanOptions = {}): CleanedPage[] => {
  const skipToc = options.skipTableOfContents ?? true;
  const withoutRunningHeads = stripHeadersFooters(pages, options.headerFooter);

  return withoutRunningHeads.map((page) => {
    // Mục lục không phải nội dung để đọc — nếu giữ lại, TTS sẽ đọc to
    // "Bản quyền mười một, Lời tác giả mười bốn…". Vẫn trả về trang để
    // `pageNumber` không lệch với `pages` đầu vào.
    if (skipToc && isTableOfContents(page, options.tableOfContents)) {
      return { pageNumber: page.pageNumber, text: '', isTableOfContents: true };
    }

    const ordered = reorderColumns(page, options.columns);
    return {
      pageNumber: ordered.pageNumber,
      text: cleanText(pageToText(ordered), options),
    };
  });
};

/**
 * Làm sạch một khối text không có toạ độ (DOCX, hoặc trang PDF đã ghép dòng).
 * Chỉ chạy được de-hyphenate + merge dòng.
 */
export const cleanText = (text: string, options: CleanOptions = {}): string =>
  mergeLines(dehyphenate(text, options.dehyphenate), options.mergeLines);
