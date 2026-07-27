import type { Database } from 'better-sqlite3';
import type { PronunciationOverride } from '@ln/shared';

/**
 * Truy vấn bảng `pronunciation_overrides` — tầng 3 của phiên âm tên riêng Nhật
 * (P3.5, plan.md mục 8.1).
 *
 * `book_id NULL` nghĩa là áp cho mọi sách. SQLite coi `NULL` là khác mọi giá
 * trị kể cả `NULL` khác, nên mọi truy vấn theo `book_id` đều phải viết `IS`
 * chứ không phải `=` — sai chỗ này thì mục toàn cục không bao giờ khớp.
 */

type PronunciationRow = {
  id: string;
  book_id: string | null;
  term: string;
  replacement: string;
  created_at: number;
};

const toOverride = (row: PronunciationRow): PronunciationOverride => ({
  id: row.id,
  ...(row.book_id === null ? {} : { bookId: row.book_id }),
  term: row.term,
  replacement: row.replacement,
  createdAt: row.created_at,
});

export type PronunciationRepository = {
  /**
   * Thêm hoặc ghi đè một mục.
   *
   * Ghi đè thay vì báo lỗi trùng: user sửa lại cách đọc của cùng một từ là
   * thao tác thường xuyên nhất ở màn này, bắt họ xoá rồi thêm lại là thừa.
   */
  upsert(entry: PronunciationOverride): void;
  remove(id: string): void;
  listByBook(bookId: string): PronunciationOverride[];
  listGlobal(): PronunciationOverride[];
  /**
   * Bảng tra để gửi sang sidecar: `term` → `replacement`.
   *
   * Gộp mục toàn cục với mục của sách, **mục của sách thắng** khi trùng `term`.
   * Trả `Record` chứ không phải `Map` vì nó đi thẳng vào JSON body của
   * `/synthesize`.
   */
  lookupTable(bookId: string): Record<string, string>;
};

export const createPronunciationRepository = (db: Database): PronunciationRepository => {
  const upsertStmt = db.prepare(`
    INSERT INTO pronunciation_overrides (id, book_id, term, replacement, created_at)
    VALUES (@id, @book_id, @term, @replacement, @created_at)
    ON CONFLICT (book_id, term) WHERE book_id IS NOT NULL
      DO UPDATE SET replacement = excluded.replacement
    ON CONFLICT (term) WHERE book_id IS NULL
      DO UPDATE SET replacement = excluded.replacement
  `);

  const removeStmt = db.prepare('DELETE FROM pronunciation_overrides WHERE id = ?');

  const listByBookStmt = db.prepare(`
    SELECT * FROM pronunciation_overrides
    WHERE book_id IS ?
    ORDER BY term
  `);

  const listGlobalStmt = db.prepare(`
    SELECT * FROM pronunciation_overrides
    WHERE book_id IS NULL
    ORDER BY term
  `);

  // Mục của sách đứng SAU mục toàn cục để ghi đè khi dựng bảng tra.
  const lookupStmt = db.prepare(`
    SELECT term, replacement FROM pronunciation_overrides
    WHERE book_id IS NULL OR book_id = ?
    ORDER BY (book_id IS NOT NULL)
  `);

  return {
    upsert: (entry) => {
      upsertStmt.run({
        id: entry.id,
        book_id: entry.bookId ?? null,
        // Hạ chữ ở đây chứ không tin nơi gọi: cột có CHECK chặn chữ hoa, để
        // lọt thì lỗi nổ ra ở tầng SQL với thông báo khó lần.
        term: entry.term.toLowerCase(),
        replacement: entry.replacement,
        created_at: entry.createdAt,
      });
    },

    remove: (id) => {
      removeStmt.run(id);
    },

    listByBook: (bookId) => (listByBookStmt.all(bookId) as PronunciationRow[]).map(toOverride),

    listGlobal: () => (listGlobalStmt.all() as PronunciationRow[]).map(toOverride),

    lookupTable: (bookId) => {
      const rows = lookupStmt.all(bookId) as { term: string; replacement: string }[];
      const table: Record<string, string> = {};
      for (const row of rows) {
        table[row.term] = row.replacement;
      }
      return table;
    },
  };
};
