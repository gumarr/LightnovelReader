import { readdir, rm, rmdir, stat, unlink } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { Book } from '@ln/shared';
import type { BookRepository } from '../db/repositories/books.js';
import type { ChapterRepository } from '../db/repositories/chapters.js';
import type { SegmentRepository } from '../db/repositories/segments.js';
import { bookAudioDir, segmentAudioPath, segmentTimingsPath } from './paths.js';

/**
 * Storage Manager: xoá audio, đo dung lượng thật trên đĩa, dọn file mồ côi.
 *
 * **Đây là chỗ DUY NHẤT trong app xoá file của user.** Import chỉ copy vào, hàng
 * đợi chỉ ghi ra; mọi đường xoá đều đi qua đây để một chỗ duy nhất chịu trách
 * nhiệm về việc "file nào được phép xoá".
 *
 * **Ba ràng buộc của CLAUDE.md mà lớp này phải giữ:**
 *
 * 1. Xoá audio **không** được xoá tiến độ đọc, bookmark hay cấu trúc chương.
 *    Nên ở đây chỉ đụng `segments.audio_*` (qua `clearAudioByChapter/Book`) và
 *    file trên đĩa — không hàm nào chạm `books.last_segment_id`.
 * 2. Xoá hàng loạt **không** được block main thread. Mỗi segment là một
 *    `unlink` riêng và một vol có ~4800 segment; xoá tuần tự 9600 file (ogg +
 *    json) làm cửa sổ đứng vài giây. Xem `removeInBatches`.
 * 3. Đường dẫn **chỉ** lấy từ `services/paths.ts`.
 */

/** Dung lượng của một chương — đủ để dựng bảng "xem theo chương" */
export type ChapterUsage = {
  chapterId: string;
  title: string;
  index: number;
  segmentCount: number;
  /** Số segment đã có audio. `0` nghĩa là chương chưa generate gì */
  readySegments: number;
  audioBytes: number;
  /** Số segment tổng hợp lỗi — vì sao chương này không bao giờ lên `complete` */
  errorCount: number;
};

export type BookUsage = {
  bookId: string;
  title: string;
  /** Dung lượng bản copy của sách gốc trong `libraryDir`. `0` khi file đã mất */
  bookFileBytes: number;
  audioBytes: number;
  chapterCount: number;
  /** Số chương đã có đủ audio — hiện "3/12 chương" mà không cần tải cả bảng */
  completeChapters: number;
};

/**
 * Toàn cảnh dung lượng.
 *
 * `audioBytesOnDisk` đo bằng cách quét thư mục, `audioBytes` cộng từ DB. Hai số
 * này **nên** bằng nhau; lệch nghĩa là có file mồ côi (sách bị xoá lúc app
 * không chạy) hoặc file bị xoá tay bên ngoài. Hiện cả hai để user thấy được
 * điều đó thay vì im lặng tin vào DB.
 */
export type StorageUsage = {
  audioDir: string;
  audioBytes: number;
  audioBytesOnDisk: number;
  /** File `.ogg`/`.json` trong `audioDir` không thuộc segment nào còn trong DB */
  orphanBytes: number;
  orphanFiles: number;
  /** Ngưỡng user đặt. Vượt thì UI cảnh báo */
  warnBytes: number;
  books: BookUsage[];
};

export type DeleteAudioResult = {
  /** Số segment được đưa về `pending` */
  segments: number;
  /** Số byte theo DB trước khi xoá — dùng để báo "đã giải phóng X" */
  freedBytes: number;
  /** File thật đã unlink (ogg + json) */
  filesDeleted: number;
};

export type StorageService = {
  usage(input: { audioDir: string; warnBytes: number }): Promise<StorageUsage>;
  chapterUsage(bookId: string): ChapterUsage[];
  deleteChapterAudio(input: { audioDir: string; chapterId: string }): Promise<DeleteAudioResult>;
  deleteBookAudio(input: { audioDir: string; bookId: string }): Promise<DeleteAudioResult>;
  /**
   * Xoá audio những chương user đã đọc qua — nút "dọn chương đã đọc xong" của
   * plan.md. "Đã đọc" = chương nằm **trước** chương chứa `lastSegmentId`.
   */
  deleteReadAudio(input: { audioDir: string; bookId: string }): Promise<DeleteAudioResult>;
  /** Xoá file mồ côi. Không đụng DB vì chúng vốn không còn bản ghi nào */
  deleteOrphans(input: { audioDir: string }): Promise<{ files: number; bytes: number }>;
  /**
   * Xoá bản copy sách gốc trong `libraryDir` + audio + thư mục sách.
   *
   * Gọi sau khi `books.remove()` đã xoá bản ghi (chương/segment theo CASCADE) —
   * nhận `book` chứ không phải `bookId` vì lúc này DB đã không tra được nữa.
   */
  removeBookFiles(input: { audioDir: string; book: Book }): Promise<void>;
};

export type StorageDeps = {
  books: BookRepository;
  chapters: ChapterRepository;
  segments: SegmentRepository;
  logger?: {
    warn: (message: string, detail?: string) => void;
  };
};

const isNotFound = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as NodeJS.ErrnoException).code === 'ENOENT';

/** Đuôi file do app sinh ra trong `audioDir` — thứ được phép xoá khi dọn rác */
const MANAGED_EXTENSIONS = new Set(['.ogg', '.json', '.part']);

/**
 * Số file xoá mỗi lượt trước khi nhả main thread.
 *
 * 64 là chỗ dung hoà: đủ lớn để `unlink` chạy song song có lợi, đủ nhỏ để mỗi
 * lượt chỉ chiếm main thread vài chục ms. Xoá cả vol (~9600 file) thành ~150
 * lượt — cửa sổ vẫn vẽ được giữa các lượt.
 */
const DELETE_BATCH = 64;

/**
 * Xoá nhiều file mà không giữ main thread.
 *
 * `Promise.allSettled` chứ không `all`: một file bị khoá (đang phát) không được
 * làm hỏng cả lượt dọn. File không xoá được sẽ hiện lại ở `orphanBytes` lần
 * sau, nên nó không mất tích âm thầm.
 */
const removeInBatches = async (
  paths: readonly string[],
  onFailure: (path: string, error: unknown) => void,
): Promise<number> => {
  let deleted = 0;

  for (let i = 0; i < paths.length; i += DELETE_BATCH) {
    const batch = paths.slice(i, i + DELETE_BATCH);
    const results = await Promise.allSettled(batch.map((path) => unlink(path)));

    for (const [index, result] of results.entries()) {
      if (result.status === 'fulfilled') {
        deleted += 1;
        continue;
      }
      // Không có file = đã xoá từ trước, đúng kết quả mong muốn.
      if (isNotFound(result.reason)) continue;
      onFailure(batch[index] ?? '', result.reason);
    }

    // Nhả một nhịp event loop để IPC và vẽ lại cửa sổ chen vào được
    await new Promise((resolve) => setImmediate(resolve));
  }

  return deleted;
};

const fileSize = async (path: string): Promise<number> => {
  try {
    return (await stat(path)).size;
  } catch (error) {
    if (isNotFound(error)) return 0;
    throw error;
  }
};

export const createStorageService = (deps: StorageDeps): StorageService => {
  const { books, chapters, segments, logger } = deps;

  const warnFailure = (path: string, error: unknown): void => {
    logger?.warn('Không xoá được file audio', `${path}: ${String(error)}`);
  };

  /**
   * Xoá file của một danh sách segment rồi cập nhật DB.
   *
   * Thứ tự cố ý: **xoá file trước, cập nhật DB sau**. Ngược lại thì mất điện
   * giữa hai bước sẽ để lại DB nói "chưa có audio" trong khi file vẫn nằm đó —
   * generate lại sẽ ghi đè, không ai phát hiện, và dung lượng báo thiếu mãi.
   * Còn theo thứ tự này thì trường hợp xấu nhất là DB vẫn nói `ready` cho file
   * đã mất, mà đó chính là thứ `orphanBytes` và lượt xoá kế tiếp dọn được.
   */
  const deleteSegmentFiles = async (
    audioDir: string,
    bookId: string,
    segmentIds: readonly string[],
    clearDb: () => number,
    freedBytes: number,
  ): Promise<DeleteAudioResult> => {
    const paths = segmentIds.flatMap((segmentId) => [
      segmentAudioPath(audioDir, bookId, segmentId),
      segmentTimingsPath(audioDir, bookId, segmentId),
    ]);

    const filesDeleted = await removeInBatches(paths, warnFailure);
    const segmentCount = clearDb();

    return { segments: segmentCount, freedBytes, filesDeleted };
  };

  return {
    async usage({ audioDir, warnBytes }) {
      const bytesPerBook = chapters.audioBytesPerBook();
      const known = books.listRecent(Number.MAX_SAFE_INTEGER);

      const list: BookUsage[] = [];
      for (const book of known) {
        const chapterList = chapters.listByBook(book.id);
        list.push({
          bookId: book.id,
          title: book.title,
          bookFileBytes: await fileSize(book.filePath),
          audioBytes: bytesPerBook.get(book.id) ?? 0,
          chapterCount: chapterList.length,
          completeChapters: chapterList.filter((c) => c.generateStatus === 'complete').length,
        });
      }

      // Quét đĩa để so với DB. Thư mục con là `{bookId}`; ID không còn trong DB
      // nghĩa là cả thư mục đó mồ côi.
      const liveIds = new Set(known.map((book) => book.id));
      let onDisk = 0;
      let orphanBytes = 0;
      let orphanFiles = 0;

      let entries: string[];
      try {
        entries = await readdir(audioDir);
      } catch (error) {
        // Chưa generate lần nào thì `audioDir` chưa tồn tại — không phải lỗi.
        if (!isNotFound(error)) throw error;
        entries = [];
      }

      for (const entry of entries) {
        const dir = join(audioDir, entry);
        let files: string[];
        try {
          files = await readdir(dir);
        } catch {
          // File lạ nằm ngay trong `audioDir` (không phải thư mục sách) —
          // không phải của app, không tính và cũng không xoá.
          continue;
        }

        const bookAlive = liveIds.has(entry);
        for (const name of files) {
          if (!MANAGED_EXTENSIONS.has(extname(name).toLowerCase())) continue;

          const size = await fileSize(join(dir, name));
          onDisk += size;

          if (bookAlive) continue;
          orphanBytes += size;
          orphanFiles += 1;
        }
      }

      return {
        audioDir,
        audioBytes: chapters.audioBytesTotal(),
        audioBytesOnDisk: onDisk,
        orphanBytes,
        orphanFiles,
        warnBytes,
        books: list,
      };
    },

    chapterUsage(bookId) {
      return chapters.listByBook(bookId).map((chapter) => ({
        chapterId: chapter.id,
        title: chapter.title,
        index: chapter.index,
        segmentCount: chapter.segmentCount,
        readySegments: segments.listReadyByChapter(chapter.id).length,
        audioBytes: chapter.audioBytes,
        errorCount: chapter.errorCount,
      }));
    },

    async deleteChapterAudio({ audioDir, chapterId }) {
      const chapter = chapters.findById(chapterId);
      if (chapter === undefined) {
        return { segments: 0, freedBytes: 0, filesDeleted: 0 };
      }

      const ready = segments.listReadyByChapter(chapterId);
      return deleteSegmentFiles(
        audioDir,
        chapter.bookId,
        ready.map((segment) => segment.id),
        () => segments.clearAudioByChapter(chapterId),
        chapter.audioBytes,
      );
    },

    async deleteBookAudio({ audioDir, bookId }) {
      const ready = segments.listReadyByBook(bookId);
      const freedBytes = chapters.audioBytesByBook(bookId);

      const result = await deleteSegmentFiles(
        audioDir,
        bookId,
        ready.map((segment) => segment.id),
        () => segments.clearAudioByBook(bookId),
        freedBytes,
      );

      // Thư mục rỗng thì bỏ luôn. `rmdir` chứ không `rm`: `rm` không kèm
      // `recursive` từ chối mọi thư mục (ERR_FS_EISDIR), còn kèm `recursive`
      // thì xoá cả file lạ của user. `rmdir` xoá đúng khi rỗng và ném
      // ENOTEMPTY khi còn gì — chính là hành vi cần.
      try {
        await rmdir(bookAudioDir(audioDir, bookId));
      } catch {
        // Thư mục còn file khác hoặc vốn không tồn tại — cả hai đều không sao
      }

      return result;
    },

    async deleteReadAudio({ audioDir, bookId }) {
      const book = books.findById(bookId);
      const chapterList = chapters.listByBook(bookId);

      // Chưa đọc tới đâu thì không có chương nào "đã đọc xong" — không xoá gì.
      // Trả 0 chứ không xoá tất: nhầm ở đây là mất hàng giờ generate.
      if (book?.lastSegmentId === undefined) {
        return { segments: 0, freedBytes: 0, filesDeleted: 0 };
      }

      const current = segments.findById(book.lastSegmentId);
      if (current === undefined) return { segments: 0, freedBytes: 0, filesDeleted: 0 };

      const currentChapter = chapters.findById(current.chapterId);
      if (currentChapter === undefined) return { segments: 0, freedBytes: 0, filesDeleted: 0 };

      // **Trước** chương đang đọc, không gồm chính nó: user còn đang ở đó.
      const done = chapterList.filter((chapter) => chapter.index < currentChapter.index);

      const ids: string[] = [];
      let freedBytes = 0;
      for (const chapter of done) {
        freedBytes += chapter.audioBytes;
        for (const segment of segments.listReadyByChapter(chapter.id)) ids.push(segment.id);
      }

      return deleteSegmentFiles(
        audioDir,
        bookId,
        ids,
        () => done.reduce((sum, chapter) => sum + segments.clearAudioByChapter(chapter.id), 0),
        freedBytes,
      );
    },

    async deleteOrphans({ audioDir }) {
      const liveIds = new Set(books.listRecent(Number.MAX_SAFE_INTEGER).map((book) => book.id));

      let entries: string[];
      try {
        entries = await readdir(audioDir);
      } catch (error) {
        if (!isNotFound(error)) throw error;
        return { files: 0, bytes: 0 };
      }

      const paths: string[] = [];
      let bytes = 0;

      for (const entry of entries) {
        // Chỉ xoá trong thư mục của sách KHÔNG còn trong DB. Thư mục của sách
        // còn sống có thể đang chứa file mà job đang ghi dở.
        if (liveIds.has(entry)) continue;

        const dir = join(audioDir, entry);
        let files: string[];
        try {
          files = await readdir(dir);
        } catch {
          continue;
        }

        for (const name of files) {
          if (!MANAGED_EXTENSIONS.has(extname(name).toLowerCase())) continue;
          const path = join(dir, name);
          bytes += await fileSize(path);
          paths.push(path);
        }
      }

      const files = await removeInBatches(paths, warnFailure);

      // Dọn nốt thư mục đã rỗng để lần quét sau không phải mở lại chúng
      for (const entry of entries) {
        if (liveIds.has(entry)) continue;
        try {
          await rmdir(join(audioDir, entry));
        } catch {
          // Còn file không xoá được — giữ lại, lần sau thử tiếp
        }
      }

      return { files, bytes };
    },

    async removeBookFiles({ audioDir, book }) {
      // Bản copy trong `libraryDir`. Dùng `book.filePath` từ DB chứ không dựng
      // lại từ `bookFilePath()`: đuôi file phụ thuộc file gốc user chọn, và
      // đường dẫn đã lưu là thứ thật sự đang nằm trên đĩa.
      try {
        await unlink(book.filePath);
      } catch (error) {
        if (!isNotFound(error)) {
          logger?.warn('Không xoá được file sách đã copy', `${book.filePath}: ${String(error)}`);
        }
      }

      // Cả thư mục audio của sách: bản ghi segment đã bị CASCADE xoá nên không
      // còn danh sách ID nào để đi từng file. `force` vì thư mục có thể chưa
      // từng được tạo (sách chưa generate lần nào).
      try {
        await rm(bookAudioDir(audioDir, book.id), { recursive: true, force: true });
      } catch (error) {
        logger?.warn('Không xoá được thư mục audio của sách', String(error));
      }
    },
  };
};
