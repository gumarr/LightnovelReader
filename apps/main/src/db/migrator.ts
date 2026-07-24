import type { Database } from 'better-sqlite3';
import { MIGRATIONS, type Migration } from './migrations.js';

/**
 * Migration runner dựa trên `PRAGMA user_version`.
 *
 * Không nhận đường dẫn file — nhận sẵn `Database` để test chạy được trên
 * DB in-memory mà không cần Electron.
 */

export type MigrationResult = {
  from: number;
  to: number;
  applied: readonly string[];
};

export const getSchemaVersion = (db: Database): number => {
  const row = db.pragma('user_version', { simple: true });
  if (typeof row !== 'number') {
    throw new Error(`PRAGMA user_version trả về kiểu không mong đợi: ${typeof row}`);
  }
  return row;
};

/** Kiểm tra danh sách migration hợp lệ trước khi chạy bất cứ thứ gì */
export const assertMigrationsValid = (migrations: readonly Migration[]): void => {
  const seen = new Set<number>();

  for (const [i, migration] of migrations.entries()) {
    if (!Number.isInteger(migration.version) || migration.version < 1) {
      throw new Error(`Migration "${migration.name}" có version không hợp lệ: ${migration.version}`);
    }
    if (seen.has(migration.version)) {
      throw new Error(`Migration version ${migration.version} bị trùng`);
    }
    seen.add(migration.version);

    const prev = migrations[i - 1];
    if (prev !== undefined && prev.version >= migration.version) {
      throw new Error(
        `Migration phải sắp xếp tăng dần: ${prev.version} (${prev.name}) đứng trước ` +
          `${migration.version} (${migration.name})`,
      );
    }
  }
};

/**
 * Chạy các migration có version lớn hơn version hiện tại của DB.
 * Mỗi migration chạy trong transaction riêng — lỗi giữa chừng thì migration
 * đó rollback hoàn toàn, những migration trước đó vẫn giữ nguyên.
 */
export const migrate = (
  db: Database,
  migrations: readonly Migration[] = MIGRATIONS,
): MigrationResult => {
  assertMigrationsValid(migrations);

  const from = getSchemaVersion(db);
  const latest = migrations.at(-1)?.version ?? 0;

  if (from > latest) {
    throw new Error(
      `DB có schema version ${from}, mới hơn version ${latest} mà app này hỗ trợ. ` +
        `Hãy cập nhật ứng dụng.`,
    );
  }

  const applied: string[] = [];

  for (const migration of migrations) {
    if (migration.version <= from) continue;

    const runOne = db.transaction(() => {
      db.exec(migration.up);
      // pragma không nhận tham số bind nên phải nội suy — version đã được
      // assertMigrationsValid xác nhận là số nguyên, không có nguy cơ injection
      db.pragma(`user_version = ${migration.version}`);
    });

    runOne();
    applied.push(migration.name);
  }

  return { from, to: getSchemaVersion(db), applied };
};

/**
 * PRAGMA bắt buộc cho mọi kết nối.
 *
 * `foreign_keys` có hiệu lực theo từng connection, không lưu trong file DB.
 * better-sqlite3 bật sẵn nhưng vẫn khai báo tường minh: ON DELETE CASCADE của
 * schema phụ thuộc vào nó, không nên dựa vào mặc định của thư viện.
 *
 * WAL cho phép renderer đọc trong lúc job queue đang ghi (DB file; DB
 * in-memory sẽ bỏ qua và giữ journal_mode = 'memory').
 */
export const applyConnectionPragmas = (db: Database): void => {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
};
