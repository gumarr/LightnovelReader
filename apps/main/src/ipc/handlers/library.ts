import {
  err,
  ok,
  saveBookRequestSchema,
  type LibraryEntry,
  type Result,
  type SaveBookResponse,
} from '@ln/shared';
import type { BookRepository } from '../../db/repositories/books.js';
import type { ChapterRepository } from '../../db/repositories/chapters.js';
import type { LibraryService } from '../../services/library.js';
import type { ImportSessionStore } from '../../services/import-session.js';
import { InvalidInputError } from '../wrap.js';

/**
 * Handler cho nhóm `library:*` — lưu sách đã xác nhận và liệt kê thư viện.
 */

export type LibraryHandlers = {
  saveBook: (input: unknown) => Promise<Result<SaveBookResponse>>;
  list: () => Result<LibraryEntry[]>;
};

export type LibraryHandlerDeps = {
  library: LibraryService;
  sessions: ImportSessionStore;
  books: BookRepository;
  chapters: ChapterRepository;
  logError?: (message: string, detail: string) => void;
};

export const createLibraryHandlers = (deps: LibraryHandlerDeps): LibraryHandlers => ({
  saveBook: async (input) => {
    const parsed = saveBookRequestSchema.safeParse(input);
    if (!parsed.success) {
      throw new InvalidInputError(
        `Yêu cầu lưu sách không hợp lệ: ${parsed.error.issues[0]?.message}`,
      );
    }

    const request = parsed.data;
    const session = deps.sessions.get(request.importId);
    if (session === undefined) {
      return err(
        'NOT_FOUND',
        'Phiên nhập sách đã hết hạn. Hãy chọn lại file.',
        `importId=${request.importId}`,
      );
    }

    // Chương bị loại trừ không được lưu — user đã chủ động bỏ chúng
    const kept = request.chapters.filter((chapter) => !chapter.excluded);
    if (kept.length === 0) {
      return err('INVALID_INPUT', 'Phải giữ lại ít nhất một chương.');
    }

    const format = session.document.format;
    if (format === 'epub') {
      return err('UNSUPPORTED_FORMAT', 'Chưa hỗ trợ EPUB.');
    }

    const result = await deps.library.save({
      filePath: session.filePath,
      title: request.title,
      format,
      lang: request.lang,
      chapters: kept,
      cleaned: session.cleaned,
      // DOCX không có toạ độ thật nên không cần trang gốc
      ...(format === 'pdf' ? { pages: session.document.pages } : {}),
    });

    // Sách đã vào DB — phiên import không còn cần thiết, giải phóng ngay thay
    // vì chờ renderer nhớ gọi `import:cancel`.
    deps.sessions.discard(request.importId);

    return ok({
      bookId: result.book.id,
      chapterCount: result.chapterCount,
      segmentCount: result.segmentCount,
      duplicate: result.duplicateOf !== undefined,
    });
  },

  list: () => {
    const entries = deps.books.listRecent().map((book) => {
      const chapters = deps.chapters.listByBook(book.id);
      return {
        book,
        chapterCount: chapters.length,
        segmentCount: chapters.reduce((sum, chapter) => sum + chapter.segmentCount, 0),
      };
    });

    return ok(entries);
  },
});
