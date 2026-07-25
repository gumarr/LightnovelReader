import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir } from 'node:fs/promises';
import { extname } from 'node:path';
import { buildChapterSegments } from '@ln/parsers';
import type { CleanedPage, Page } from '@ln/parsers';
import type { Book, BookLang, Chapter, ChapterDraft, Segment } from '@ln/shared';
import type { BookRepository } from '../db/repositories/books.js';
import type { ChapterRepository } from '../db/repositories/chapters.js';
import type { SegmentRepository } from '../db/repositories/segments.js';
import { bookFilePath, libraryDir } from './paths.js';

/**
 * Đưa một sách đã xác nhận cấu trúc vào thư viện: copy file, dựng segment,
 * lưu vào DB.
 *
 * Sách gốc được **copy** vào `libraryDir` chứ không tham chiếu tại chỗ: user
 * đổi tên hay xoá file nguồn thì thư viện vẫn đọc được, và audio đã generate
 * không thành rác trỏ vào hư không.
 */

export type SaveBookInput = {
  /** Đường dẫn file gốc user chọn */
  filePath: string;
  title: string;
  format: 'pdf' | 'docx';
  lang: BookLang;
  /** Chương user đã xác nhận, đã bỏ những chương bị loại trừ */
  chapters: readonly ChapterDraft[];
  cleaned: readonly CleanedPage[];
  /** Trang gốc kèm toạ độ, chỉ có với PDF */
  pages?: readonly Page[];
};

export type SaveBookResult = {
  book: Book;
  chapterCount: number;
  segmentCount: number;
  /** Sách đã có sẵn trong thư viện (trùng hash) — không lưu lại */
  duplicateOf?: Book;
};

export type LibraryService = {
  save(input: SaveBookInput): Promise<SaveBookResult>;
  /** SHA-256 của file, dùng để phát hiện import trùng */
  hashFile(filePath: string): Promise<string>;
};

export type LibraryDeps = {
  userData: string;
  books: BookRepository;
  chapters: ChapterRepository;
  segments: SegmentRepository;
  now?: () => number;
  /** Sinh ID. Tách ra để test khoá được kết quả. */
  newId?: () => string;
};

/**
 * Băm theo luồng thay vì đọc cả file vào RAM: sách PDF có thể vài trăm MB, mà
 * bước này chạy ngay lúc user bấm xác nhận nên không được làm nghẽn main.
 */
export const hashFileStream = async (filePath: string): Promise<string> => {
  const hash = createHash('sha256');
  const stream = createReadStream(filePath);

  for await (const chunk of stream) hash.update(chunk as Buffer);

  return hash.digest('hex');
};

export const createLibraryService = (deps: LibraryDeps): LibraryService => {
  const now = deps.now ?? Date.now;
  const newId = deps.newId ?? randomUUID;

  return {
    hashFile: hashFileStream,

    async save(input) {
      const fileHash = await hashFileStream(input.filePath);

      // Trùng hash = đúng file đó đã có. Trả về sách cũ thay vì tạo bản sao —
      // user thường import lại vì quên, không phải vì muốn hai bản.
      const existing = deps.books.findByHash(fileHash);
      if (existing !== undefined) {
        return {
          book: existing,
          duplicateOf: existing,
          chapterCount: deps.chapters.listByBook(existing.id).length,
          segmentCount: 0,
        };
      }

      const bookId = newId();
      const extension = extname(input.filePath) || `.${input.format}`;
      const target = bookFilePath(deps.userData, bookId, extension);

      await mkdir(libraryDir(deps.userData), { recursive: true });
      await copyFile(input.filePath, target);

      const book: Book = {
        id: bookId,
        title: input.title.trim(),
        format: input.format,
        filePath: target,
        fileHash,
        lang: input.lang,
        addedAt: now(),
      };

      const chapterRows: Chapter[] = [];
      const segmentRows: Segment[] = [];

      for (const [index, draft] of input.chapters.entries()) {
        const chapterId = newId();

        const built = buildChapterSegments({
          cleaned: input.cleaned,
          ...(input.pages === undefined ? {} : { pages: input.pages }),
          pageStart: draft.pageStart,
          pageEnd: draft.pageEnd,
          format: input.format,
        });

        for (const segment of built) {
          segmentRows.push({
            id: newId(),
            chapterId,
            index: segment.index,
            text: segment.text,
            anchor: segment.anchor,
            status: 'pending',
            alignStatus: 'none',
          });
        }

        chapterRows.push({
          id: chapterId,
          bookId,
          index,
          title: draft.title.trim(),
          pageStart: draft.pageStart,
          pageEnd: draft.pageEnd,
          segmentCount: built.length,
          audioBytes: 0,
          generateStatus: 'none',
        });
      }

      // Ghi DB sau khi đã dựng xong tất cả: nếu dựng segment ném giữa chừng
      // thì chưa có gì vào DB, không để lại sách nửa vời.
      deps.books.insert(book);
      deps.chapters.insertMany(chapterRows);
      deps.segments.insertMany(segmentRows);

      return { book, chapterCount: chapterRows.length, segmentCount: segmentRows.length };
    },
  };
};
