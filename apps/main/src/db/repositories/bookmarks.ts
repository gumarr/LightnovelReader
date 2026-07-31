import type { Database } from 'better-sqlite3';
import { BOOKMARK_EXCERPT_MAX, type Bookmark, type BookmarkEntry } from '@ln/shared';

/**
 * Truy vấn bảng `bookmarks` (P5.4).
 *
 * Bảng có từ schema v1 nhưng **không repository nào đọc tới** cho tới P5.4 —
 * bốn phase liền user không đánh dấu được chỗ nào dù DB đã sẵn sàng. Đây là lần
 * thứ ba trong dự án gặp kiểu "hạ tầng có sẵn mà không có đường gọi tới"
 * (`queue:listPending`, `pronunciations:*` là hai lần trước).
 *
 * **Không có UNIQUE(book_id, segment_id) ở schema v1**, và không thêm migration
 * chỉ để có nó: `upsert` dưới đây tự tra trước khi ghi. Đổi lại là hai lượt gọi
 * đồng thời trên cùng segment vẫn tạo được bản trùng — nhưng dấu trang đến từ
 * một cú bấm của người, không có đường nào chạy song song.
 */

type BookmarkRow = {
  id: string;
  book_id: string;
  segment_id: string;
  note: string | null;
  created_at: number;
};

/** Hàng đã ghép sẵn ngữ cảnh — kết quả của `listByBook` */
type BookmarkEntryRow = BookmarkRow & {
  chapter_title: string;
  chapter_idx: number;
  segment_idx: number;
  segment_text: string;
};

const toBookmark = (row: BookmarkRow): Bookmark => ({
  id: row.id,
  bookId: row.book_id,
  segmentId: row.segment_id,
  // Chuỗi rỗng và NULL cùng nghĩa "không có ghi chú" — quy về một cách biểu
  // diễn ở đây để UI không phải kiểm hai kiểu.
  ...(row.note === null || row.note === '' ? {} : { note: row.note }),
  createdAt: row.created_at,
});

/**
 * Cắt text segment thành trích đoạn nhận diện được.
 *
 * Cắt ở **ranh giới từ** gần nhất chứ không cắt cứng theo số ký tự: cắt giữa từ
 * cho ra `"…bước vào lớp h"`, đọc lướt danh sách thấy vướng mắt.
 */
export const toExcerpt = (text: string): string => {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= BOOKMARK_EXCERPT_MAX) return collapsed;

  const cut = collapsed.slice(0, BOOKMARK_EXCERPT_MAX);
  const lastSpace = cut.lastIndexOf(' ');
  // Không có khoảng trắng nào (một "từ" dài bất thường) thì đành cắt cứng.
  return `${lastSpace > 0 ? cut.slice(0, lastSpace) : cut}…`;
};

const toEntry = (row: BookmarkEntryRow): BookmarkEntry => ({
  bookmark: toBookmark(row),
  chapterTitle: row.chapter_title,
  chapterIndex: row.chapter_idx,
  segmentIndex: row.segment_idx,
  excerpt: toExcerpt(row.segment_text),
});

export type BookmarkRepository = {
  /**
   * Thêm mới, hoặc **cập nhật ghi chú** nếu segment đó đã được đánh dấu.
   *
   * Trả về id thật sự trong DB — khi đã tồn tại thì đó là id cũ chứ không phải
   * `entry.id` vừa sinh, và renderer dùng id đó cho nút xoá.
   */
  upsert(entry: Bookmark): string;
  findById(id: string): Bookmark | undefined;
  /** Dấu trang của một sách, kèm ngữ cảnh, xếp theo mạch đọc */
  listByBook(bookId: string, limit: number): BookmarkEntry[];
  /** Một mục kèm ngữ cảnh — dùng để trả về sau khi thêm/sửa */
  findEntryById(id: string): BookmarkEntry | undefined;
  updateNote(id: string, note: string): boolean;
  remove(id: string): void;
  countByBook(bookId: string): number;
};

/**
 * Ghép dấu trang với chương và segment chứa nó.
 *
 * `INNER JOIN` chứ không `LEFT`: `segment_id` có `ON DELETE CASCADE`, nên dấu
 * trang trỏ vào segment đã mất thì chính nó cũng đã bị xoá. Hàng không join
 * được là hàng không tồn tại, không phải hàng cần hiện với ô trống.
 */
const ENTRY_SELECT = `
  SELECT b.*,
         c.title AS chapter_title,
         c.idx   AS chapter_idx,
         s.idx   AS segment_idx,
         s.text  AS segment_text
  FROM bookmarks b
  JOIN segments s ON s.id = b.segment_id
  JOIN chapters c ON c.id = s.chapter_id
`;

export const createBookmarkRepository = (db: Database): BookmarkRepository => {
  const insertStmt = db.prepare(`
    INSERT INTO bookmarks (id, book_id, segment_id, note, created_at)
    VALUES (@id, @book_id, @segment_id, @note, @created_at)
  `);

  const findBySegmentStmt = db.prepare(
    'SELECT * FROM bookmarks WHERE book_id = ? AND segment_id = ?',
  );

  const byIdStmt = db.prepare('SELECT * FROM bookmarks WHERE id = ?');

  const updateNoteStmt = db.prepare('UPDATE bookmarks SET note = @note WHERE id = @id');

  const removeStmt = db.prepare('DELETE FROM bookmarks WHERE id = ?');

  // Xếp theo mạch đọc, KHÔNG theo `created_at` (dù index của bảng là theo đó):
  // user tìm dấu trang bằng cách nhớ nó nằm khoảng nào trong sách.
  const listStmt = db.prepare(`
    ${ENTRY_SELECT}
    WHERE b.book_id = ?
    ORDER BY c.idx, s.idx
    LIMIT ?
  `);

  const entryByIdStmt = db.prepare(`${ENTRY_SELECT} WHERE b.id = ?`);

  const countStmt = db.prepare('SELECT COUNT(*) AS n FROM bookmarks WHERE book_id = ?');

  /**
   * Ghi trong một transaction: giữa lượt tra và lượt ghi mà có lượt khác chen
   * vào thì bảng có hai dấu trang cùng chỗ — chính thứ `upsert` sinh ra để tránh.
   */
  const upsertTx = db.transaction((entry: Bookmark): string => {
    const existing = findBySegmentStmt.get(entry.bookId, entry.segmentId) as
      | BookmarkRow
      | undefined;

    if (existing !== undefined) {
      updateNoteStmt.run({ id: existing.id, note: entry.note ?? null });
      return existing.id;
    }

    insertStmt.run({
      id: entry.id,
      book_id: entry.bookId,
      segment_id: entry.segmentId,
      note: entry.note ?? null,
      created_at: entry.createdAt,
    });
    return entry.id;
  });

  return {
    upsert: (entry) => upsertTx(entry),

    findById: (id) => {
      const row = byIdStmt.get(id) as BookmarkRow | undefined;
      return row === undefined ? undefined : toBookmark(row);
    },

    listByBook: (bookId, limit) =>
      (listStmt.all(bookId, limit) as BookmarkEntryRow[]).map(toEntry),

    findEntryById: (id) => {
      const row = entryByIdStmt.get(id) as BookmarkEntryRow | undefined;
      return row === undefined ? undefined : toEntry(row);
    },

    updateNote: (id, note) => {
      // Chuỗi rỗng lưu thành NULL: đó là "xoá ghi chú", và để lẫn hai cách biểu
      // diễn thì `toBookmark` phải đoán.
      const info = updateNoteStmt.run({ id, note: note === '' ? null : note });
      return info.changes > 0;
    },

    remove: (id) => {
      removeStmt.run(id);
    },

    countByBook: (bookId) => (countStmt.get(bookId) as { n: number }).n,
  };
};
