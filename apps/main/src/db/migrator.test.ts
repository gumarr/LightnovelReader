import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as Db } from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyConnectionPragmas,
  assertMigrationsValid,
  getSchemaVersion,
  migrate,
} from './migrator.js';
import { MIGRATIONS, type Migration } from './migrations.js';

let db: Db;

beforeEach(() => {
  db = new Database(':memory:');
  applyConnectionPragmas(db);
});

afterEach(() => {
  db.close();
});

describe('assertMigrationsValid', () => {
  it('chấp nhận danh sách migration thật của app', () => {
    expect(() => assertMigrationsValid(MIGRATIONS)).not.toThrow();
  });

  it('chấp nhận danh sách rỗng', () => {
    expect(() => assertMigrationsValid([])).not.toThrow();
  });

  it('từ chối version trùng', () => {
    const bad: Migration[] = [
      { version: 1, name: 'a', up: 'CREATE TABLE a (x INT);' },
      { version: 1, name: 'b', up: 'CREATE TABLE b (x INT);' },
    ];
    expect(() => assertMigrationsValid(bad)).toThrow(/trùng/);
  });

  it('từ chối version không tăng dần', () => {
    const bad: Migration[] = [
      { version: 2, name: 'b', up: 'CREATE TABLE b (x INT);' },
      { version: 1, name: 'a', up: 'CREATE TABLE a (x INT);' },
    ];
    expect(() => assertMigrationsValid(bad)).toThrow(/tăng dần/);
  });

  it('từ chối version 0 hoặc âm — user_version mặc định là 0', () => {
    expect(() =>
      assertMigrationsValid([{ version: 0, name: 'a', up: 'SELECT 1;' }]),
    ).toThrow(/không hợp lệ/);
    expect(() =>
      assertMigrationsValid([{ version: -1, name: 'a', up: 'SELECT 1;' }]),
    ).toThrow(/không hợp lệ/);
  });

  it('từ chối version không phải số nguyên', () => {
    expect(() =>
      assertMigrationsValid([{ version: 1.5, name: 'a', up: 'SELECT 1;' }]),
    ).toThrow(/không hợp lệ/);
  });
});

describe('migrate', () => {
  it('DB mới bắt đầu ở version 0', () => {
    expect(getSchemaVersion(db)).toBe(0);
  });

  it('chạy hết migration và cập nhật user_version', () => {
    const result = migrate(db);
    const latest = MIGRATIONS.at(-1)?.version ?? 0;
    expect(result.from).toBe(0);
    expect(result.to).toBe(latest);
    expect(result.applied).toHaveLength(MIGRATIONS.length);
    expect(getSchemaVersion(db)).toBe(latest);
  });

  it('idempotent — chạy lần hai không áp dụng gì thêm', () => {
    migrate(db);
    const second = migrate(db);
    expect(second.applied).toEqual([]);
    expect(second.from).toBe(second.to);
  });

  it('chỉ chạy migration mới hơn version hiện tại', () => {
    const migrations: Migration[] = [
      { version: 1, name: 'one', up: 'CREATE TABLE t1 (x INT);' },
      { version: 2, name: 'two', up: 'CREATE TABLE t2 (x INT);' },
    ];
    const first = migrations[0];
    if (first === undefined) expect.unreachable('migrations phải có phần tử');

    migrate(db, [first]);
    const result = migrate(db, migrations);

    expect(result.from).toBe(1);
    expect(result.applied).toEqual(['two']);
  });

  it('rollback migration lỗi, giữ nguyên version cũ', () => {
    const migrations: Migration[] = [
      { version: 1, name: 'ok', up: 'CREATE TABLE ok (x INT);' },
      { version: 2, name: 'broken', up: 'CREATE TABLE good (x INT); NOT VALID SQL;' },
    ];

    expect(() => migrate(db, migrations)).toThrow();
    // migration 1 đã commit, migration 2 rollback hoàn toàn
    expect(getSchemaVersion(db)).toBe(1);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[];
    expect(tables.map((t) => t.name)).toContain('ok');
    expect(tables.map((t) => t.name)).not.toContain('good');
  });

  it('từ chối DB có schema mới hơn app — tránh làm hỏng dữ liệu khi downgrade', () => {
    migrate(db);
    db.pragma('user_version = 999');
    expect(() => migrate(db)).toThrow(/mới hơn/);
  });
});

describe('applyConnectionPragmas', () => {
  it('bật foreign_keys — nếu tắt thì ON DELETE CASCADE không chạy', () => {
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('foreign_keys vẫn bật sau khi migrate', () => {
    migrate(db);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('bật WAL trên DB file — cho phép đọc song song lúc queue đang ghi', () => {
    // WAL chỉ áp dụng được với DB file, in-memory luôn ở chế độ 'memory'
    const dir = mkdtempSync(join(tmpdir(), 'ln-db-'));
    const file = new Database(join(dir, 'test.db'));
    try {
      applyConnectionPragmas(file);
      expect(file.pragma('journal_mode', { simple: true })).toBe('wal');
    } finally {
      file.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('migration v2 — chapter_error_count', () => {
  /** Chỉ chạy tới v1, để mô phỏng DB của user đã dùng app từ trước */
  const migrateToV1 = (): void => {
    const v1 = MIGRATIONS.filter((m) => m.version === 1);
    migrate(db, v1);
  };

  it('thêm cột error_count vào bảng chapters', () => {
    migrate(db);
    const columns = (db.pragma('table_info(chapters)') as { name: string }[]).map((c) => c.name);

    expect(columns).toContain('error_count');
  });

  it('nâng cấp từ v1 đếm LẠI số segment lỗi đang có', () => {
    // DB của user đã chạy P2.6 có sẵn segment `error`. Để nguyên DEFAULT 0 thì
    // con số sai cho tới lần generate kế tiếp — mà chương đã xong thì không bao
    // giờ generate lại nữa.
    migrateToV1();

    db.prepare(
      `INSERT INTO books (id, title, format, file_path, file_hash, lang, added_at)
       VALUES ('b1', 'Sách', 'pdf', 'D:/a.pdf', 'h1', 'vi', 1000)`,
    ).run();
    db.prepare(
      `INSERT INTO chapters (id, book_id, idx, title) VALUES ('c1', 'b1', 0, 'Chương 1')`,
    ).run();
    const rows: readonly [string, string][] = [
      ['s1', 'error'],
      ['s2', 'error'],
      ['s3', 'ready'],
    ];
    for (const [index, [id, status]] of rows.entries()) {
      db.prepare(
        `INSERT INTO segments (id, chapter_id, idx, text, anchor, status)
         VALUES (?, 'c1', ?, 'x', '{"kind":"pdf","page":1,"rects":[]}', ?)`,
      ).run(id, index, status);
    }

    migrate(db);

    const row = db.prepare('SELECT error_count FROM chapters WHERE id = ?').get('c1') as {
      error_count: number;
    };
    expect(row.error_count).toBe(2);
  });

  it('chương không có segment lỗi vẫn về 0, không NULL', () => {
    migrateToV1();
    db.prepare(
      `INSERT INTO books (id, title, format, file_path, file_hash, lang, added_at)
       VALUES ('b1', 'Sách', 'pdf', 'D:/a.pdf', 'h1', 'vi', 1000)`,
    ).run();
    db.prepare(
      `INSERT INTO chapters (id, book_id, idx, title) VALUES ('c1', 'b1', 0, 'Chương 1')`,
    ).run();

    migrate(db);

    const row = db.prepare('SELECT error_count FROM chapters WHERE id = ?').get('c1') as {
      error_count: number;
    };
    expect(row.error_count).toBe(0);
  });

  it('nâng cấp không mất dữ liệu cũ', () => {
    migrateToV1();
    db.prepare(
      `INSERT INTO books (id, title, format, file_path, file_hash, lang, added_at, last_segment_id)
       VALUES ('b1', 'Sách cũ', 'pdf', 'D:/a.pdf', 'h1', 'vi', 1000, 'seg-42')`,
    ).run();
    db.prepare(
      `INSERT INTO chapters (id, book_id, idx, title, audio_bytes, generate_status)
       VALUES ('c1', 'b1', 0, 'Chương giữ nguyên', 12345, 'complete')`,
    ).run();

    migrate(db);

    const chapter = db.prepare('SELECT * FROM chapters WHERE id = ?').get('c1') as {
      title: string;
      audio_bytes: number;
      generate_status: string;
    };
    expect(chapter.title).toBe('Chương giữ nguyên');
    expect(chapter.audio_bytes).toBe(12345);
    expect(chapter.generate_status).toBe('complete');

    const book = db.prepare('SELECT last_segment_id FROM books WHERE id = ?').get('b1') as {
      last_segment_id: string;
    };
    // Tiến độ đọc phải sống qua mọi lần nâng cấp schema
    expect(book.last_segment_id).toBe('seg-42');
  });

  it('chạy migrate hai lần không ném — v2 đã áp dụng thì bỏ qua', () => {
    migrate(db);
    expect(() => migrate(db)).not.toThrow();
    expect(getSchemaVersion(db)).toBe(2);
  });
});
