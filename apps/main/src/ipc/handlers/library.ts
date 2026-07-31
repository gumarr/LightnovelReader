import {
  bookIdSchema,
  err,
  ok,
  readingProgressSchema,
  saveBookRequestSchema,
  type Book,
  type BookDetail,
  type LibraryEntry,
  type ReadingStats,
  type Result,
  type SaveBookResponse,
} from '@ln/shared';
import type { BookRepository } from '../../db/repositories/books.js';
import type { BookmarkRepository } from '../../db/repositories/bookmarks.js';
import type { ChapterRepository } from '../../db/repositories/chapters.js';
import type { SegmentRepository } from '../../db/repositories/segments.js';
import type { LibraryService } from '../../services/library.js';
import type { ImportSessionStore } from '../../services/import-session.js';
import { InvalidInputError } from '../wrap.js';

/**
 * Handler cho nhóm `library:*` — lưu sách đã xác nhận và liệt kê thư viện.
 */

export type LibraryHandlers = {
  saveBook: (input: unknown) => Promise<Result<SaveBookResponse>>;
  list: () => Result<LibraryEntry[]>;
  openBook: (input: unknown) => Result<BookDetail>;
  setProgress: (input: unknown) => Result<void>;
  removeBook: (input: unknown) => Promise<Result<void>>;
  getStats: (input: unknown) => Result<ReadingStats>;
};

export type LibraryHandlerDeps = {
  library: LibraryService;
  sessions: ImportSessionStore;
  books: BookRepository;
  bookmarks: BookmarkRepository;
  chapters: ChapterRepository;
  segments: SegmentRepository;
  /**
   * Dọn file của sách bị xoá: bản copy trong `libraryDir` + thư mục audio.
   *
   * Tiêm vào chứ không gọi thẳng `StorageService` để handler này không phụ
   * thuộc vào `audioDir` — nó không biết và không cần biết thư mục audio ở đâu.
   */
  removeFiles: (book: Book) => Promise<void>;
  now?: () => number;
  logError?: (message: string, detail: string) => void;
};

export const createLibraryHandlers = (deps: LibraryHandlerDeps): LibraryHandlers => ({
  openBook: (input) => {
    const parsed = bookIdSchema.safeParse(input);
    if (!parsed.success) throw new InvalidInputError('bookId không hợp lệ');

    const bookId = parsed.data;
    const book = deps.books.findById(bookId);
    if (book === undefined) {
      return err('NOT_FOUND', 'Không tìm thấy sách này trong thư viện.', `bookId=${bookId}`);
    }

    const now = deps.now ?? Date.now;
    // Ghi thời điểm mở nhưng KHÔNG đụng `lastSegmentId` — mở sách không có
    // nghĩa là đã đọc tới đâu; vị trí cũ phải giữ nguyên để resume đúng.
    deps.books.markOpened(bookId, now());

    const chapters = deps.chapters.listByBook(bookId);

    // Segment đọc dở thuộc chương nào. Segment có thể không còn (sách nhập
    // lại sinh ID mới) — khi đó bỏ qua, user đọc từ đầu chứ không phải lỗi.
    const lastSegment =
      book.lastSegmentId === undefined
        ? undefined
        : deps.segments.findById(book.lastSegmentId);

    return ok({
      book: { ...book, lastOpenedAt: now() },
      chapters,
      ...(lastSegment === undefined ? {} : { resumeChapterId: lastSegment.chapterId }),
    });
  },

  setProgress: (input) => {
    const parsed = readingProgressSchema.safeParse(input);
    if (!parsed.success) {
      throw new InvalidInputError(`Tiến độ đọc không hợp lệ: ${parsed.error.issues[0]?.message}`);
    }

    const { bookId, segmentId } = parsed.data;
    if (deps.books.findById(bookId) === undefined) {
      return err('NOT_FOUND', 'Không tìm thấy sách này trong thư viện.', `bookId=${bookId}`);
    }

    // Segment phải có thật, nếu không lần resume sau sẽ trỏ vào hư không
    if (deps.segments.findById(segmentId) === undefined) {
      return err('NOT_FOUND', 'Không tìm thấy đoạn đọc dở.', `segmentId=${segmentId}`);
    }

    deps.books.markOpened(bookId, (deps.now ?? Date.now)(), segmentId);
    return ok(undefined);
  },

  /**
   * Thống kê đọc của một sách (P5.4).
   *
   * **Không có bảng theo dõi hành vi.** Mọi con số suy từ thứ DB đã lưu vì công
   * việc khác: `last_segment_id` cho vị trí đọc, `segments.status` cho tiến độ
   * generate. Muốn biết "đọc bao lâu mỗi ngày" thì phải ghi mốc từng phiên —
   * đó là telemetry cục bộ, mà CLAUDE.md cấm thu thập. Xem `ReadingStats`.
   */
  getStats: (input) => {
    const parsed = bookIdSchema.safeParse(input);
    if (!parsed.success) throw new InvalidInputError('bookId không hợp lệ');

    const bookId = parsed.data;
    const book = deps.books.findById(bookId);
    if (book === undefined) {
      return err('NOT_FOUND', 'Không tìm thấy sách này trong thư viện.', `bookId=${bookId}`);
    }

    const chapters = deps.chapters.listByBook(bookId);
    const segmentStats = deps.segments.bookStats(bookId);

    // Vị trí đọc dở có thể trỏ vào segment đã mất (sách nhập lại sinh ID mới).
    // Khi đó coi như chưa đọc: thà báo 0% còn hơn hiện con số suy từ dữ liệu rác.
    const lastSegment =
      book.lastSegmentId === undefined ? undefined : deps.segments.findById(book.lastSegmentId);
    const currentChapter =
      lastSegment === undefined ? undefined : deps.chapters.findById(lastSegment.chapterId);

    return ok({
      bookId,
      chapterCount: chapters.length,
      // Chương **trước** chương đang đọc mới tính là đọc xong — user còn đang ở
      // giữa chương hiện tại. Cùng định nghĩa với `storage.deleteReadAudio`,
      // nên hai chỗ không nói hai con số khác nhau về cùng một thứ.
      chaptersRead: currentChapter === undefined ? 0 : currentChapter.index,
      segmentCount: segmentStats.segmentCount,
      segmentsRead:
        book.lastSegmentId === undefined || lastSegment === undefined
          ? 0
          : deps.segments.countBefore(book.lastSegmentId),
      segmentsWithAudio: segmentStats.readyCount,
      audioDurationMs: segmentStats.totalDurationMs,
      audioBytes: segmentStats.totalAudioBytes,
      ...(currentChapter === undefined ? {} : { currentChapterTitle: currentChapter.title }),
      ...(book.lastOpenedAt === undefined ? {} : { lastOpenedAt: book.lastOpenedAt }),
      bookmarkCount: deps.bookmarks.countByBook(bookId),
    });
  },

  removeBook: async (input) => {
    const parsed = bookIdSchema.safeParse(input);
    if (!parsed.success) throw new InvalidInputError('bookId không hợp lệ');

    // Đọc bản ghi TRƯỚC khi xoá: `filePath` chỉ có trong DB, mà sau `remove()`
    // thì không tra lại được nữa.
    const book = deps.books.findById(parsed.data);
    if (book === undefined) {
      return err('NOT_FOUND', 'Không tìm thấy sách này trong thư viện.');
    }

    // Chương và segment tự đi theo nhờ ON DELETE CASCADE.
    if (!deps.books.remove(parsed.data)) {
      return err('NOT_FOUND', 'Không tìm thấy sách này trong thư viện.');
    }

    // Xoá DB trước, file sau: ngược lại thì xoá file xong mà DB lỗi sẽ để lại
    // sách trong thư viện trỏ vào file không còn — mở lên là lỗi không cứu được.
    // Theo thứ tự này, xấu nhất là file mồ côi, mà Storage Manager dọn được.
    // Lỗi xoá file **không** làm hỏng lượt xoá sách: bản ghi đã đi rồi.
    await deps.removeFiles(book);

    return ok(undefined);
  },

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
