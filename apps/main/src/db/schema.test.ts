import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as Db } from 'better-sqlite3';
import { applyConnectionPragmas, migrate } from './migrator.js';

/**
 * Kiểm chứng ràng buộc trong schema thực sự có hiệu lực — CHECK, UNIQUE,
 * FOREIGN KEY và partial index của job queue.
 */

let db: Db;

const insertBook = (id = 'book-1', hash = 'hash-1'): void => {
  db.prepare(
    `INSERT INTO books (id, title, format, file_path, file_hash, lang, added_at)
     VALUES (?, ?, 'pdf', 'D:\\lib\\a.pdf', ?, 'vi', 1000)`,
  ).run(id, 'Sách thử', hash);
};

const insertChapter = (id = 'chap-1', bookId = 'book-1', idx = 0): void => {
  db.prepare(`INSERT INTO chapters (id, book_id, idx, title) VALUES (?, ?, ?, ?)`).run(
    id,
    bookId,
    idx,
    'Chương 1',
  );
};

const insertSegment = (id = 'seg-1', chapterId = 'chap-1', idx = 0): void => {
  db.prepare(`INSERT INTO segments (id, chapter_id, idx, text, anchor) VALUES (?, ?, ?, ?, ?)`).run(
    id,
    chapterId,
    idx,
    'Xin chào.',
    JSON.stringify({ kind: 'pdf', page: 1, rects: [] }),
  );
};

beforeEach(() => {
  db = new Database(':memory:');
  applyConnectionPragmas(db);
  migrate(db);
});

afterEach(() => {
  db.close();
});

describe('books', () => {
  it('file_hash là UNIQUE — chặn import trùng file', () => {
    insertBook('book-1', 'same-hash');
    expect(() => insertBook('book-2', 'same-hash')).toThrow(/UNIQUE/i);
  });

  it('từ chối format ngoài pdf/docx/epub', () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO books (id, title, format, file_path, file_hash, lang, added_at)
           VALUES ('b', 't', 'txt', 'p', 'h', 'vi', 1)`,
        )
        .run(),
    ).toThrow(/CHECK/i);
  });

  it('từ chối lang ngoài vi/en', () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO books (id, title, format, file_path, file_hash, lang, added_at)
           VALUES ('b', 't', 'pdf', 'p', 'h', 'jp', 1)`,
        )
        .run(),
    ).toThrow(/CHECK/i);
  });
});

describe('chapters', () => {
  beforeEach(() => insertBook());

  it('(book_id, idx) là UNIQUE', () => {
    insertChapter('chap-1', 'book-1', 0);
    expect(() => insertChapter('chap-2', 'book-1', 0)).toThrow(/UNIQUE/i);
  });

  it('cho phép cùng idx ở sách khác nhau', () => {
    insertBook('book-2', 'hash-2');
    insertChapter('chap-1', 'book-1', 0);
    expect(() => insertChapter('chap-2', 'book-2', 0)).not.toThrow();
  });

  it('từ chối book_id không tồn tại', () => {
    expect(() => insertChapter('chap-1', 'khong-co', 0)).toThrow(/FOREIGN KEY/i);
  });

  it('xoá sách thì xoá chương theo (CASCADE)', () => {
    insertChapter();
    db.prepare('DELETE FROM books WHERE id = ?').run('book-1');
    const count = db.prepare('SELECT COUNT(*) AS n FROM chapters').get() as { n: number };
    expect(count.n).toBe(0);
  });

  it('generate_status mặc định none', () => {
    insertChapter();
    const row = db.prepare('SELECT generate_status AS s FROM chapters WHERE id = ?').get('chap-1');
    expect(row).toEqual({ s: 'none' });
  });
});

describe('segments', () => {
  beforeEach(() => {
    insertBook();
    insertChapter();
  });

  it('mặc định status=pending, align_status=none', () => {
    insertSegment();
    const row = db
      .prepare('SELECT status, align_status FROM segments WHERE id = ?')
      .get('seg-1');
    expect(row).toEqual({ status: 'pending', align_status: 'none' });
  });

  it('từ chối align_status lạ', () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO segments (id, chapter_id, idx, text, anchor, align_status)
           VALUES ('s', 'chap-1', 0, 't', '{}', 'perfect')`,
        )
        .run(),
    ).toThrow(/CHECK/i);
  });

  it('xoá chương thì xoá segment theo', () => {
    insertSegment();
    db.prepare('DELETE FROM chapters WHERE id = ?').run('chap-1');
    const count = db.prepare('SELECT COUNT(*) AS n FROM segments').get() as { n: number };
    expect(count.n).toBe(0);
  });

  it('không có cột audio_path ở tầng chapter — audio chỉ thuộc segment', () => {
    const cols = db.prepare('PRAGMA table_info(chapters)').all() as { name: string }[];
    expect(cols.map((c) => c.name)).not.toContain('audio_path');
    const segCols = db.prepare('PRAGMA table_info(segments)').all() as { name: string }[];
    expect(segCols.map((c) => c.name)).toContain('audio_path');
  });
});

describe('jobs', () => {
  beforeEach(() => {
    insertBook();
    insertChapter();
    insertSegment();
  });

  const insertJob = (id: string, type = 'synthesize', status = 'queued'): void => {
    db.prepare(
      `INSERT INTO jobs (id, type, segment_id, status, created_at) VALUES (?, ?, 'seg-1', ?, 1)`,
    ).run(id, type, status);
  };

  it('chặn hai job cùng loại đang chờ cho một segment', () => {
    insertJob('job-1');
    expect(() => insertJob('job-2')).toThrow(/UNIQUE/i);
  });

  it('cho phép job synthesize và align song song trên cùng segment', () => {
    insertJob('job-1', 'synthesize');
    expect(() => insertJob('job-2', 'align')).not.toThrow();
  });

  it('cho phép job mới sau khi job cũ đã done — partial index chỉ tính queued/running', () => {
    insertJob('job-1', 'synthesize', 'done');
    expect(() => insertJob('job-2', 'synthesize', 'queued')).not.toThrow();
  });

  it('lấy job theo priority giảm dần rồi created_at tăng dần', () => {
    db.prepare(
      `INSERT INTO jobs (id, type, segment_id, priority, created_at) VALUES
       ('low', 'synthesize', 'seg-1', 0, 100)`,
    ).run();
    insertSegment('seg-2', 'chap-1', 1);
    insertSegment('seg-3', 'chap-1', 2);
    db.prepare(
      `INSERT INTO jobs (id, type, segment_id, priority, created_at) VALUES
       ('urgent', 'synthesize', 'seg-2', 100, 200),
       ('old-low', 'synthesize', 'seg-3', 0, 50)`,
    ).run();

    const rows = db
      .prepare(
        `SELECT id FROM jobs WHERE status = 'queued' ORDER BY priority DESC, created_at ASC`,
      )
      .all() as { id: string }[];
    expect(rows.map((r) => r.id)).toEqual(['urgent', 'old-low', 'low']);
  });

  it('xoá segment thì xoá job theo — queue không còn job mồ côi', () => {
    insertJob('job-1');
    db.prepare('DELETE FROM segments WHERE id = ?').run('seg-1');
    const count = db.prepare('SELECT COUNT(*) AS n FROM jobs').get() as { n: number };
    expect(count.n).toBe(0);
  });
});
