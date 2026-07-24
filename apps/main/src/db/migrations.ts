/**
 * Danh sách migration theo thứ tự tăng dần của `version`.
 *
 * Quy tắc: migration đã phát hành thì KHÔNG sửa nội dung — chỉ thêm migration
 * mới. Sửa migration cũ sẽ khiến DB của user đang chạy lệch schema so với DB
 * mới tạo mà không có cách nào phát hiện.
 */
export type Migration = {
  version: number;
  name: string;
  /** SQL chạy trong một transaction. Nhiều câu lệnh cách nhau bằng `;` */
  up: string;
};

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    up: `
      CREATE TABLE books (
        id             TEXT PRIMARY KEY,
        title          TEXT NOT NULL,
        author         TEXT,
        format         TEXT NOT NULL CHECK (format IN ('pdf', 'docx', 'epub')),
        file_path      TEXT NOT NULL,
        file_hash      TEXT NOT NULL UNIQUE,
        lang           TEXT NOT NULL CHECK (lang IN ('vi', 'en')),
        cover_path     TEXT,
        added_at       INTEGER NOT NULL,
        last_opened_at INTEGER,
        last_segment_id TEXT
      );

      CREATE TABLE chapters (
        id              TEXT PRIMARY KEY,
        book_id         TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
        idx             INTEGER NOT NULL,
        title           TEXT NOT NULL,
        page_start      INTEGER,
        page_end        INTEGER,
        segment_count   INTEGER NOT NULL DEFAULT 0,
        audio_bytes     INTEGER NOT NULL DEFAULT 0,
        generate_status TEXT NOT NULL DEFAULT 'none'
                        CHECK (generate_status IN ('none', 'partial', 'complete')),
        UNIQUE (book_id, idx)
      );

      CREATE INDEX idx_chapters_book ON chapters(book_id, idx);

      -- anchor lưu dạng JSON vì hình dạng khác nhau giữa pdf và docx
      CREATE TABLE segments (
        id            TEXT PRIMARY KEY,
        chapter_id    TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
        idx           INTEGER NOT NULL,
        text          TEXT NOT NULL,
        anchor        TEXT NOT NULL,
        audio_path    TEXT,
        duration_ms   INTEGER,
        audio_bytes   INTEGER,
        status        TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'queued', 'generating', 'ready', 'error')),
        align_status  TEXT NOT NULL DEFAULT 'none'
                      CHECK (align_status IN ('none', 'estimated', 'aligned')),
        error_message TEXT,
        UNIQUE (chapter_id, idx)
      );

      CREATE INDEX idx_segments_chapter ON segments(chapter_id, idx);
      CREATE INDEX idx_segments_status ON segments(status);

      -- Queue persist trong SQLite: đóng app mở lại phải tiếp tục được
      CREATE TABLE jobs (
        id            TEXT PRIMARY KEY,
        type          TEXT NOT NULL CHECK (type IN ('synthesize', 'align')),
        segment_id    TEXT NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
        priority      INTEGER NOT NULL DEFAULT 0,
        status        TEXT NOT NULL DEFAULT 'queued'
                      CHECK (status IN ('queued', 'running', 'done', 'error', 'cancelled')),
        attempts      INTEGER NOT NULL DEFAULT 0,
        created_at    INTEGER NOT NULL,
        started_at    INTEGER,
        finished_at   INTEGER,
        error_message TEXT
      );

      -- Job lấy ra theo priority giảm dần rồi created_at tăng dần
      CREATE INDEX idx_jobs_pickup ON jobs(status, priority DESC, created_at);
      -- Một segment chỉ có tối đa một job mỗi loại đang chờ/chạy
      CREATE UNIQUE INDEX idx_jobs_active ON jobs(segment_id, type)
        WHERE status IN ('queued', 'running');

      CREATE TABLE bookmarks (
        id         TEXT PRIMARY KEY,
        book_id    TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
        segment_id TEXT NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
        note       TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX idx_bookmarks_book ON bookmarks(book_id, created_at DESC);
    `,
  },
];
