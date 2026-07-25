import type { BookFormat } from '@ln/shared';
import type { Page } from '../cleaner/types.js';
import type { OutlineEntry } from '../chapter-detector/types.js';

/**
 * Interface chung cho mọi parser. Thêm format mới = thêm file implement
 * `DocumentParser`, không sửa core.
 */

/**
 * Tài liệu đã trích, chuẩn hoá về một model duy nhất để chapter detector và
 * cleaner dùng chung.
 *
 * `pages` với DOCX **không phải trang giấy** — DOCX không có khái niệm trang
 * cho tới khi render. Mỗi paragraph thành một `Page` một dòng, `pageNumber`
 * là chỉ số paragraph. Nhờ vậy detector dùng lại nguyên vẹn thay vì phải có
 * hai nhánh song song.
 */
export type ParsedDocument = {
  format: BookFormat;
  pages: Page[];
  /** Chỉ PDF mới có. DOCX luôn rỗng — mammoth không đọc bookmark */
  outline: OutlineEntry[];
  /**
   * Số trang thật (PDF) hoặc số paragraph (DOCX).
   * Dùng để dựng `pageEnd` cho chương cuối.
   */
  totalPages: number;
  /**
   * `false` khi tài liệu không có khái niệm trang giấy (DOCX). UI phải dựa
   * cờ này để biết có hiển thị "trang X–Y" hay không.
   */
  hasRealPages: boolean;
};

export type ParseOptions = {
  /** Giới hạn số trang/paragraph đọc — dùng cho preview nhanh khi import */
  maxPages?: number;
  /** Gọi sau mỗi trang để UI cập nhật tiến độ */
  onProgress?: (done: number, total: number) => void;
};

export type DocumentParser = {
  /** Định dạng parser này xử lý */
  readonly format: BookFormat;
  /** Đuôi file nhận (chữ thường, kèm dấu chấm) */
  readonly extensions: readonly string[];
  parse(filePath: string, options?: ParseOptions): Promise<ParsedDocument>;
};

/**
 * Lỗi parse có thông điệp đọc được cho user.
 *
 * Dùng `kind` thay vì so khớp chuỗi để UI hiển thị hướng dẫn phù hợp —
 * `scanned-pdf` cần chỉ dẫn khác hẳn `corrupt-file`.
 */
export type ParseErrorKind =
  | 'unsupported-format'
  | 'scanned-pdf'
  | 'corrupt-file'
  | 'empty-document';

export class ParseError extends Error {
  readonly kind: ParseErrorKind;

  constructor(kind: ParseErrorKind, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ParseError';
    this.kind = kind;
  }
}
