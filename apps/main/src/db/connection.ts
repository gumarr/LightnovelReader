import Database from 'better-sqlite3';
import type { Database as Db } from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { applyConnectionPragmas, migrate, type MigrationResult } from './migrator.js';

/**
 * Kết nối SQLite của app. Giữ một instance duy nhất trong main process —
 * better-sqlite3 chạy đồng bộ nên không cần pool.
 */

let instance: Db | null = null;

export type OpenDbResult = {
  db: Db;
  migration: MigrationResult;
};

/** Mở DB tại `file`, tạo thư mục cha nếu chưa có, rồi chạy migration */
export const openDatabase = (file: string): OpenDbResult => {
  mkdirSync(dirname(file), { recursive: true });

  const db = new Database(file);
  applyConnectionPragmas(db);
  const migration = migrate(db);

  return { db, migration };
};

/** Khởi tạo instance dùng chung. Gọi một lần lúc app khởi động. */
export const initDatabase = (file: string): OpenDbResult => {
  if (instance !== null) {
    throw new Error('Database đã được khởi tạo — không mở hai lần trong cùng process');
  }

  const result = openDatabase(file);
  instance = result.db;
  return result;
};

/** Lấy instance đã khởi tạo. Ném lỗi nếu gọi trước `initDatabase`. */
export const getDatabase = (): Db => {
  if (instance === null) {
    throw new Error('Database chưa khởi tạo — gọi initDatabase() trước');
  }
  return instance;
};

export const closeDatabase = (): void => {
  if (instance === null) return;
  // Dồn WAL về file chính để lần mở sau không phải replay
  instance.pragma('wal_checkpoint(TRUNCATE)');
  instance.close();
  instance = null;
};
