import {
  bookIdSchema,
  err,
  ok,
  type BookFileBytes,
  type BookHtml,
  type Result,
  type Segment,
} from '@ln/shared';
import type { BookRepository } from '../../db/repositories/books.js';
import type { ChapterRepository } from '../../db/repositories/chapters.js';
import type { SegmentRepository } from '../../db/repositories/segments.js';
import { prepareDocxHtml } from '../../services/docx-html.js';
import { InvalidInputError } from '../wrap.js';

/**
 * Handler cho nhóm `reader:*` — cấp nội dung sách cho viewer.
 *
 * Renderer chỉ gửi `bookId`; đường dẫn file do main tra từ DB. Renderer **không
 * bao giờ** truyền path, nên không có cách nào bảo main đọc file tuỳ ý — đây là
 * điểm khác biệt cố ý so với `import:parseFile` (xem nợ kỹ thuật mục 8).
 */

export type ReaderHandlers = {
  getBookFile: (input: unknown) => Promise<Result<BookFileBytes>>;
  getBookHtml: (input: unknown) => Promise<Result<BookHtml>>;
  listSegments: (input: unknown) => Result<Segment[]>;
};

/** Đọc file thành bytes. Tách ra để test không cần file thật. */
export type FileReader = (filePath: string) => Promise<Uint8Array>;

/** Chuyển DOCX thành HTML thô. Cùng kiểu với `DocxConverter` bên parsers. */
export type HtmlConverter = (filePath: string) => Promise<string>;

export type ReaderHandlerDeps = {
  books: BookRepository;
  chapters: ChapterRepository;
  segments: SegmentRepository;
  readFile: FileReader;
  convertDocx: HtmlConverter;
};

export const createReaderHandlers = (deps: ReaderHandlerDeps): ReaderHandlers => {
  /**
   * Cache HTML theo `bookId`. Convert lại tốn ~200ms và user lật qua lại giữa
   * thư viện với trình đọc liên tục — nhưng chỉ giữ **một** sách: mở sách khác
   * là thay chỗ, để một thư viện lớn không dồn hết vào RAM.
   */
  let htmlCache: { bookId: string; value: BookHtml } | undefined;

  const requireBook = (input: unknown) => {
    const parsed = bookIdSchema.safeParse(input);
    if (!parsed.success) throw new InvalidInputError('bookId không hợp lệ');

    const book = deps.books.findById(parsed.data);
    if (book === undefined) {
      return {
        error: err('NOT_FOUND', 'Không tìm thấy sách này trong thư viện.', `bookId=${parsed.data}`),
      } as const;
    }
    return { book } as const;
  };

  return {
    getBookFile: async (input) => {
      const found = requireBook(input);
      if ('error' in found) return found.error;

      const { book } = found;
      if (book.format !== 'pdf') {
        // DOCX đi đường `getBookHtml`; trả bytes .docx cho renderer là vô dụng
        // vì renderer không có mammoth.
        return err(
          'INVALID_INPUT',
          'Chỉ sách PDF mới đọc được bằng kênh này.',
          `format=${book.format}`,
        );
      }

      const bytes = await deps.readFile(book.filePath);

      // Cắt đúng vùng của Buffer: `Buffer` do Node cấp phát thường là lát của
      // một pool lớn hơn, gửi thẳng `.buffer` là kèm theo dữ liệu file khác.
      const copy = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(copy).set(bytes);

      return ok({ bookId: book.id, format: book.format, bytes: copy });
    },

    getBookHtml: async (input) => {
      const found = requireBook(input);
      if ('error' in found) return found.error;

      const { book } = found;
      if (book.format !== 'docx') {
        return err(
          'INVALID_INPUT',
          'Chỉ sách DOCX mới đọc được bằng kênh này.',
          `format=${book.format}`,
        );
      }

      if (htmlCache?.bookId === book.id) return ok(htmlCache.value);

      const raw = await deps.convertDocx(book.filePath);
      const { html, blockCount } = prepareDocxHtml(raw);
      const value: BookHtml = { bookId: book.id, html, blockCount };

      htmlCache = { bookId: book.id, value };
      return ok(value);
    },

    listSegments: (input) => {
      const parsed = bookIdSchema.safeParse(input);
      if (!parsed.success) throw new InvalidInputError('chapterId không hợp lệ');

      const chapterId = parsed.data;
      if (deps.chapters.findById(chapterId) === undefined) {
        return err('NOT_FOUND', 'Không tìm thấy chương này.', `chapterId=${chapterId}`);
      }

      return ok(deps.segments.listByChapter(chapterId));
    },
  };
};
