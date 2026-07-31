import {
  addBookmarkSchema,
  BOOKMARK_LIST_LIMIT,
  bookIdSchema,
  bookmarkIdSchema,
  err,
  ok,
  updateBookmarkNoteSchema,
  type BookmarkEntry,
  type Result,
} from '@ln/shared';
import type { BookmarkRepository } from '../../db/repositories/bookmarks.js';
import type { SegmentRepository } from '../../db/repositories/segments.js';
import { InvalidInputError } from '../wrap.js';

/**
 * Handler nhóm `bookmarks:*` — dấu trang (P5.4).
 *
 * Bảng `bookmarks` có từ schema v1 mà tới đây mới có đường gọi. Lần thứ ba
 * trong dự án gặp kiểu "hạ tầng dựng sẵn rồi bỏ quên" — xem PROGRESS mục 4.71.
 *
 * **Dấu trang chỉ neo vào segment đang tồn tại.** Kiểm ở đây chứ không phó mặc
 * cho khoá ngoại: SQLite trả `FOREIGN KEY constraint failed`, một câu không
 * dịch được sang tiếng người, mà ca này xảy ra thật (renderer giữ danh sách cũ
 * sau khi sách được nhập lại).
 */

export type BookmarkHandlers = {
  list: (input: unknown) => Result<BookmarkEntry[]>;
  add: (input: unknown) => Result<BookmarkEntry>;
  updateNote: (input: unknown) => Result<BookmarkEntry>;
  remove: (input: unknown) => Result<void>;
};

export type BookmarkHandlerDeps = {
  bookmarks: BookmarkRepository;
  segments: SegmentRepository;
  /** Sinh id mục mới. Tách ra để test khoá được giá trị */
  newId: () => string;
  now: () => number;
};

export const createBookmarkHandlers = (deps: BookmarkHandlerDeps): BookmarkHandlers => {
  /**
   * Đọc lại mục vừa ghi để trả về.
   *
   * Không dựng `BookmarkEntry` bằng tay từ input: ngữ cảnh (tiêu đề chương,
   * trích đoạn) chỉ có trong DB, mà ghép tay thì hai đường dựng cùng một hình
   * dạng sẽ lệch nhau lúc nào không biết.
   */
  const readBack = (id: string): Result<BookmarkEntry> => {
    const entry = deps.bookmarks.findEntryById(id);
    if (entry === undefined) {
      return err('NOT_FOUND', 'Không đọc lại được dấu trang vừa lưu.', `id=${id}`);
    }
    return ok(entry);
  };

  return {
    list: (input) => {
      const parsed = bookIdSchema.safeParse(input);
      if (!parsed.success) throw new InvalidInputError('bookId không hợp lệ');

      // Sách không tồn tại và sách chưa có dấu trang nào đều cho danh sách rỗng.
      // Không phân biệt: user mở màn dấu trang của sách vừa xoá là ca không đáng
      // hiện lỗi, còn danh sách rỗng đã tự nói lên điều cần biết.
      return ok(deps.bookmarks.listByBook(parsed.data, BOOKMARK_LIST_LIMIT));
    },

    add: (input) => {
      const parsed = addBookmarkSchema.safeParse(input);
      if (!parsed.success) {
        throw new InvalidInputError(
          parsed.error.issues[0]?.message ?? 'Dữ liệu dấu trang không hợp lệ',
        );
      }

      const { bookId, segmentId, note } = parsed.data;

      const segment = deps.segments.findById(segmentId);
      if (segment === undefined) {
        return err('NOT_FOUND', 'Không tìm thấy đoạn để đánh dấu.', `segmentId=${segmentId}`);
      }

      // Segment phải thuộc đúng sách được khai. Lệch thì dấu trang hiện ở sách
      // này nhưng nhảy tới nội dung sách khác — sai lặng lẽ, khó lần ra nhất.
      const actualBookId = deps.segments.findBookId(segmentId);
      if (actualBookId !== bookId) {
        return err(
          'INVALID_INPUT',
          'Đoạn này không thuộc sách đang mở.',
          `bookId=${bookId} segmentId=${segmentId}`,
        );
      }

      const id = deps.bookmarks.upsert({
        id: deps.newId(),
        bookId,
        segmentId,
        // Zod đã `trim`; chuỗi rỗng sau khi trim nghĩa là user không ghi gì.
        ...(note === undefined || note === '' ? {} : { note }),
        createdAt: deps.now(),
      });

      return readBack(id);
    },

    updateNote: (input) => {
      const parsed = updateBookmarkNoteSchema.safeParse(input);
      if (!parsed.success) {
        throw new InvalidInputError(parsed.error.issues[0]?.message ?? 'Ghi chú không hợp lệ');
      }

      const { id, note } = parsed.data;
      if (!deps.bookmarks.updateNote(id, note)) {
        return err('NOT_FOUND', 'Dấu trang này đã bị xoá.', `id=${id}`);
      }

      return readBack(id);
    },

    remove: (input) => {
      const parsed = bookmarkIdSchema.safeParse(input);
      if (!parsed.success) throw new InvalidInputError('id không hợp lệ');

      // Xoá mục không tồn tại vẫn trả `ok` — user muốn "chỗ này đừng còn dấu
      // trang nữa", mà điều đó đã đúng sẵn. Cùng lối với `pronunciations:remove`.
      deps.bookmarks.remove(parsed.data);
      return ok(undefined);
    },
  };
};
