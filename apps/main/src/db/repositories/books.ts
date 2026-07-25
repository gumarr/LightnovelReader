import type { Database } from 'better-sqlite3';
import type { Book, BookFormat, BookLang } from '@ln/shared';

/**
 * Truy vấn bảng `books`. Mọi SQL của sách nằm ở đây — handler không viết SQL.
 *
 * DB dùng snake_case, domain model dùng camelCase. Chuyển đổi tập trung ở
 * `toBook` để một chỗ sai không lan ra mọi truy vấn.
 */

/** Hàng thô từ SQLite, trước khi đổi sang domain model */
type BookRow = {
  id: string;
  title: string;
  author: string | null;
  format: string;
  file_path: string;
  file_hash: string;
  lang: string;
  cover_path: string | null;
  added_at: number;
  last_opened_at: number | null;
  last_segment_id: string | null;
};

/**
 * `exactOptionalPropertyTypes` không cho gán `undefined` tường minh vào field
 * optional, nên field NULL phải được **bỏ hẳn** thay vì gán undefined.
 */
const toBook = (row: BookRow): Book => ({
  id: row.id,
  title: row.title,
  ...(row.author === null ? {} : { author: row.author }),
  format: row.format as BookFormat,
  filePath: row.file_path,
  fileHash: row.file_hash,
  lang: row.lang as BookLang,
  ...(row.cover_path === null ? {} : { coverPath: row.cover_path }),
  addedAt: row.added_at,
  ...(row.last_opened_at === null ? {} : { lastOpenedAt: row.last_opened_at }),
  ...(row.last_segment_id === null ? {} : { lastSegmentId: row.last_segment_id }),
});

export type BookRepository = {
  insert(book: Book): void;
  findById(id: string): Book | undefined;
  /** Tìm theo hash nội dung file — dùng để phát hiện import trùng */
  findByHash(fileHash: string): Book | undefined;
  /** Sách mới đọc trước, sách chưa mở bao giờ xếp theo lúc thêm vào */
  listRecent(limit?: number): Book[];
  /** Ghi lại vị trí đọc dở để lần mở sau resume được */
  markOpened(id: string, at: number, lastSegmentId?: string): void;
  remove(id: string): boolean;
  count(): number;
};

export const createBookRepository = (db: Database): BookRepository => {
  const insertStmt = db.prepare(`
    INSERT INTO books (
      id, title, author, format, file_path, file_hash, lang,
      cover_path, added_at, last_opened_at, last_segment_id
    ) VALUES (
      @id, @title, @author, @format, @filePath, @fileHash, @lang,
      @coverPath, @addedAt, @lastOpenedAt, @lastSegmentId
    )
  `);

  const byId = db.prepare('SELECT * FROM books WHERE id = ?');
  const byHash = db.prepare('SELECT * FROM books WHERE file_hash = ?');

  // Sách đã mở xếp trước theo lần mở gần nhất; chưa mở thì theo lúc thêm vào
  const recent = db.prepare(`
    SELECT * FROM books
    ORDER BY COALESCE(last_opened_at, added_at) DESC
    LIMIT ?
  `);

  const opened = db.prepare(`
    UPDATE books
    SET last_opened_at = @at,
        -- Giữ nguyên vị trí cũ khi lần mở này chưa biết đọc tới đâu
        last_segment_id = COALESCE(@lastSegmentId, last_segment_id)
    WHERE id = @id
  `);

  const del = db.prepare('DELETE FROM books WHERE id = ?');
  const countStmt = db.prepare('SELECT COUNT(*) AS n FROM books');

  return {
    insert(book) {
      insertStmt.run({
        id: book.id,
        title: book.title,
        author: book.author ?? null,
        format: book.format,
        filePath: book.filePath,
        fileHash: book.fileHash,
        lang: book.lang,
        coverPath: book.coverPath ?? null,
        addedAt: book.addedAt,
        lastOpenedAt: book.lastOpenedAt ?? null,
        lastSegmentId: book.lastSegmentId ?? null,
      });
    },

    findById(id) {
      const row = byId.get(id) as BookRow | undefined;
      return row === undefined ? undefined : toBook(row);
    },

    findByHash(fileHash) {
      const row = byHash.get(fileHash) as BookRow | undefined;
      return row === undefined ? undefined : toBook(row);
    },

    listRecent(limit = 100) {
      return (recent.all(limit) as BookRow[]).map(toBook);
    },

    markOpened(id, at, lastSegmentId) {
      opened.run({ id, at, lastSegmentId: lastSegmentId ?? null });
    },

    remove(id) {
      return del.run(id).changes > 0;
    },

    count() {
      return (countStmt.get() as { n: number }).n;
    },
  };
};
