import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDatabase, getDatabase, initDatabase, openDatabase } from './connection.js';
import { getSchemaVersion } from './migrator.js';
import { MIGRATIONS } from './migrations.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ln-conn-'));
});

afterEach(() => {
  closeDatabase();
  rmSync(dir, { recursive: true, force: true });
});

describe('openDatabase', () => {
  it('tạo thư mục cha nếu chưa tồn tại', () => {
    const file = join(dir, 'nested', 'deep', 'ln.db');
    const { db } = openDatabase(file);
    expect(existsSync(file)).toBe(true);
    db.close();
  });

  it('chạy migration ngay khi mở DB mới', () => {
    const { db, migration } = openDatabase(join(dir, 'ln.db'));
    expect(migration.from).toBe(0);
    expect(migration.to).toBe(MIGRATIONS.at(-1)?.version);
    expect(migration.applied.length).toBeGreaterThan(0);
    db.close();
  });

  it('mở lại DB đã migrate thì không áp dụng thêm', () => {
    const file = join(dir, 'ln.db');
    const first = openDatabase(file);
    first.db.close();

    const second = openDatabase(file);
    expect(second.migration.applied).toEqual([]);
    expect(getSchemaVersion(second.db)).toBe(MIGRATIONS.at(-1)?.version);
    second.db.close();
  });

  it('dữ liệu ghi ở lần mở trước còn nguyên sau khi mở lại', () => {
    const file = join(dir, 'ln.db');
    const first = openDatabase(file);
    first.db
      .prepare(
        `INSERT INTO books (id, title, format, file_path, file_hash, lang, added_at)
         VALUES ('b1', 'Sách', 'pdf', 'p', 'h', 'vi', 1)`,
      )
      .run();
    first.db.close();

    const second = openDatabase(file);
    const row = second.db.prepare('SELECT title FROM books WHERE id = ?').get('b1');
    expect(row).toEqual({ title: 'Sách' });
    second.db.close();
  });
});

describe('instance dùng chung', () => {
  it('getDatabase ném lỗi nếu chưa init — không trả về null im lặng', () => {
    expect(() => getDatabase()).toThrow(/chưa khởi tạo/);
  });

  it('initDatabase hai lần thì ném lỗi', () => {
    initDatabase(join(dir, 'ln.db'));
    expect(() => initDatabase(join(dir, 'other.db'))).toThrow(/hai lần/);
  });

  it('getDatabase trả về đúng instance đã init', () => {
    const { db } = initDatabase(join(dir, 'ln.db'));
    expect(getDatabase()).toBe(db);
  });

  it('closeDatabase cho phép init lại', () => {
    initDatabase(join(dir, 'ln.db'));
    closeDatabase();
    expect(() => initDatabase(join(dir, 'ln.db'))).not.toThrow();
  });

  it('closeDatabase gọi khi chưa init thì không ném lỗi', () => {
    expect(() => closeDatabase()).not.toThrow();
  });
});
