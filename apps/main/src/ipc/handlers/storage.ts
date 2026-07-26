import {
  bookIdSchema,
  chapterIdSchema,
  err,
  ok,
  type ChapterUsageInfo,
  type DeleteAudioResultInfo,
  type Result,
  type StorageUsageInfo,
} from '@ln/shared';
import type { BookRepository } from '../../db/repositories/books.js';
import type { ChapterRepository } from '../../db/repositories/chapters.js';
import type { StorageService } from '../../services/storage.js';
import type { GenerateQueue } from '../../services/queue.js';
import { InvalidInputError } from '../wrap.js';

/**
 * Handler cho nhóm `storage:*` — Storage Manager.
 *
 * **Huỷ job trước khi xoá file.** Đây là ràng buộc riêng của nhóm này: xoá audio
 * của một sách đang generate mà không huỷ job trước thì worker ghi lại đúng
 * những file vừa xoá ngay sau đó, và `clearAudioByBook` đã chạy rồi nên DB sẽ
 * nói `pending` cho file thật sự đang tồn tại. User bấm "xoá" rồi thấy dung
 * lượng không giảm, không hiểu vì sao.
 */

export type StorageHandlers = {
  getUsage: () => Promise<Result<StorageUsageInfo>>;
  getChapterUsage: (input: unknown) => Result<ChapterUsageInfo[]>;
  deleteChapterAudio: (input: unknown) => Promise<Result<DeleteAudioResultInfo>>;
  deleteBookAudio: (input: unknown) => Promise<Result<DeleteAudioResultInfo>>;
  deleteReadAudio: (input: unknown) => Promise<Result<DeleteAudioResultInfo>>;
  deleteOrphans: () => Promise<Result<DeleteAudioResultInfo>>;
};

export type StorageHandlerDeps = {
  storage: StorageService;
  books: BookRepository;
  chapters: ChapterRepository;
  queue: GenerateQueue;
  /** Đọc lúc gọi chứ không chốt sẵn — user đổi thư mục audio được */
  getAudioDir: () => string;
  getWarnBytes: () => number;
};

export const createStorageHandlers = (deps: StorageHandlerDeps): StorageHandlers => {
  const { storage, books, chapters, queue, getAudioDir, getWarnBytes } = deps;

  return {
    getUsage: async () =>
      ok(await storage.usage({ audioDir: getAudioDir(), warnBytes: getWarnBytes() })),

    getChapterUsage: (input) => {
      const parsed = bookIdSchema.safeParse(input);
      if (!parsed.success) throw new InvalidInputError('bookId không hợp lệ');

      if (books.findById(parsed.data) === undefined) {
        return err('NOT_FOUND', 'Không tìm thấy sách này trong thư viện.');
      }

      return ok(storage.chapterUsage(parsed.data));
    },

    deleteChapterAudio: async (input) => {
      const parsed = chapterIdSchema.safeParse(input);
      if (!parsed.success) throw new InvalidInputError('chapterId không hợp lệ');

      const chapter = chapters.findById(parsed.data);
      if (chapter === undefined) return err('NOT_FOUND', 'Không tìm thấy chương này.');

      // Huỷ theo sách chứ không theo chương: hàng đợi không có `cancelByChapter`,
      // và giữ lại job của chương khác trong khi xoá chương này vẫn an toàn —
      // chúng ghi vào file khác. Nhưng job của **chương này** thì phải đi.
      // Dùng cancelBook là quá tay một chút, đổi lại là không có đường nào để
      // một job sót lại ghi ngược file vừa xoá.
      queue.cancelBook(chapter.bookId);

      return ok(await storage.deleteChapterAudio({ audioDir: getAudioDir(), chapterId: chapter.id }));
    },

    deleteBookAudio: async (input) => {
      const parsed = bookIdSchema.safeParse(input);
      if (!parsed.success) throw new InvalidInputError('bookId không hợp lệ');

      const bookId = parsed.data;
      if (books.findById(bookId) === undefined) {
        return err('NOT_FOUND', 'Không tìm thấy sách này trong thư viện.');
      }

      queue.cancelBook(bookId);

      return ok(await storage.deleteBookAudio({ audioDir: getAudioDir(), bookId }));
    },

    deleteReadAudio: async (input) => {
      const parsed = bookIdSchema.safeParse(input);
      if (!parsed.success) throw new InvalidInputError('bookId không hợp lệ');

      const bookId = parsed.data;
      if (books.findById(bookId) === undefined) {
        return err('NOT_FOUND', 'Không tìm thấy sách này trong thư viện.');
      }

      queue.cancelBook(bookId);

      return ok(await storage.deleteReadAudio({ audioDir: getAudioDir(), bookId }));
    },

    deleteOrphans: async () => {
      const result = await storage.deleteOrphans({ audioDir: getAudioDir() });
      // File mồ côi không thuộc segment nào còn trong DB, nên không có segment
      // nào để đưa về `pending` — `segments: 0` là đúng, không phải thiếu sót.
      return ok({ segments: 0, freedBytes: result.bytes, filesDeleted: result.files });
    },
  };
};
