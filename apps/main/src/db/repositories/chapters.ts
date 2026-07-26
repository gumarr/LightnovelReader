import type { Database } from 'better-sqlite3';
import type { Chapter, ChapterGenerateStatus } from '@ln/shared';

/** Truy vấn bảng `chapters`. Cột `idx` vì `index` là từ khoá SQL. */

type ChapterRow = {
  id: string;
  book_id: string;
  idx: number;
  title: string;
  page_start: number | null;
  page_end: number | null;
  segment_count: number;
  audio_bytes: number;
  generate_status: string;
};

const toChapter = (row: ChapterRow): Chapter => ({
  id: row.id,
  bookId: row.book_id,
  index: row.idx,
  title: row.title,
  ...(row.page_start === null ? {} : { pageStart: row.page_start }),
  ...(row.page_end === null ? {} : { pageEnd: row.page_end }),
  segmentCount: row.segment_count,
  audioBytes: row.audio_bytes,
  generateStatus: row.generate_status as ChapterGenerateStatus,
});

export type ChapterRepository = {
  insertMany(chapters: readonly Chapter[]): void;
  listByBook(bookId: string): Chapter[];
  findById(id: string): Chapter | undefined;
  /** Cập nhật số segment sau khi dựng xong — dùng cho UI và storage manager */
  setSegmentCount(id: string, count: number): void;
  /**
   * Tổng dung lượng audio đã sinh của cả sách.
   *
   * Cộng từ `chapters.audio_bytes` chứ không quét lại `segments`: cột đó đã được
   * `markReady` tính lại từ segment con trong cùng transaction, nên đây vẫn là
   * cùng một nguồn sự thật mà không phải đọc hàng nghìn hàng.
   */
  audioBytesByBook(bookId: string): number;
};

export const createChapterRepository = (db: Database): ChapterRepository => {
  const insertStmt = db.prepare(`
    INSERT INTO chapters (
      id, book_id, idx, title, page_start, page_end,
      segment_count, audio_bytes, generate_status
    ) VALUES (
      @id, @bookId, @idx, @title, @pageStart, @pageEnd,
      @segmentCount, @audioBytes, @generateStatus
    )
  `);

  // Một transaction cho cả danh sách: chương của một sách phải vào trọn vẹn
  // hoặc không vào gì, nếu không sách sẽ có cấu trúc dở dang không sửa được.
  const insertAll = db.transaction((chapters: readonly Chapter[]) => {
    for (const chapter of chapters) {
      insertStmt.run({
        id: chapter.id,
        bookId: chapter.bookId,
        idx: chapter.index,
        title: chapter.title,
        pageStart: chapter.pageStart ?? null,
        pageEnd: chapter.pageEnd ?? null,
        segmentCount: chapter.segmentCount,
        audioBytes: chapter.audioBytes,
        generateStatus: chapter.generateStatus,
      });
    }
  });

  const byBook = db.prepare('SELECT * FROM chapters WHERE book_id = ? ORDER BY idx');
  const byId = db.prepare('SELECT * FROM chapters WHERE id = ?');
  const setCount = db.prepare('UPDATE chapters SET segment_count = ? WHERE id = ?');
  const bytesOfBook = db.prepare(
    'SELECT COALESCE(SUM(audio_bytes), 0) AS bytes FROM chapters WHERE book_id = ?',
  );

  return {
    insertMany(chapters) {
      if (chapters.length === 0) return;
      insertAll(chapters);
    },

    listByBook(bookId) {
      return (byBook.all(bookId) as ChapterRow[]).map(toChapter);
    },

    findById(id) {
      const row = byId.get(id) as ChapterRow | undefined;
      return row === undefined ? undefined : toChapter(row);
    },

    setSegmentCount(id, count) {
      setCount.run(count, id);
    },

    audioBytesByBook(bookId) {
      return (bytesOfBook.get(bookId) as { bytes: number }).bytes;
    },
  };
};
