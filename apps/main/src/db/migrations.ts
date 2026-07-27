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
  {
    version: 2,
    name: 'chapter_error_count',
    /**
     * Số segment tổng hợp lỗi của từng chương.
     *
     * Lưu thành cột thay vì đếm lúc cần: màn chi tiết sách hiện 10–30 chương
     * cùng lúc, mà `COUNT(*) WHERE status='error'` cho từng chương là N+1 truy
     * vấn trên bảng 5000 hàng mỗi lần mở sách. Cột này được tính LẠI (không cộng
     * dồn) từ chính segment con trong cùng transaction với `markReady`, đúng
     * cách `audio_bytes` đang làm — xem `refreshChapter` ở `segments.ts`.
     *
     * `DEFAULT 0` rồi `UPDATE` một lượt: DB của user đang chạy đã có segment
     * `error` từ P2.6, để nguyên 0 thì con số sai cho tới lần generate kế tiếp.
     */
    up: `
      ALTER TABLE chapters ADD COLUMN error_count INTEGER NOT NULL DEFAULT 0;

      UPDATE chapters SET error_count = (
        SELECT COUNT(*) FROM segments
        WHERE segments.chapter_id = chapters.id AND segments.status = 'error'
      );
    `,
  },
  {
    version: 3,
    name: 'pronunciation_overrides',
    /**
     * Bảng phiên âm do user tự sửa, theo từng sách (P3.5, plan.md mục 8.1).
     *
     * Đây là **tầng 3** — van an toàn, không phải nghĩa vụ. Tầng 1 (từ điển
     * ship sẵn) và tầng 2 (luật romaji) đã lo phần lớn; bảng này chỉ để user
     * sửa chỗ nào nghe chướng tai mà không phải chờ bản cập nhật app.
     *
     * `book_id NULL` = áp cho **mọi** sách. Cho phép vì tên nhân vật của một
     * bộ LN thường trải dài nhiều tập, mà mỗi tập là một `book` riêng — bắt
     * user nhập lại từng tập là đúng thứ họ không muốn bận tâm.
     *
     * `term` lưu **chữ thường** để tra cứu khỏi phải `LOWER()` mỗi lần; ràng
     * buộc `CHECK` chặn ngay lúc ghi thay vì tin nơi gọi nhớ hạ chữ.
     */
    up: `
      CREATE TABLE pronunciation_overrides (
        id          TEXT PRIMARY KEY,
        book_id     TEXT REFERENCES books(id) ON DELETE CASCADE,
        term        TEXT NOT NULL CHECK (term = LOWER(term) AND LENGTH(term) > 0),
        replacement TEXT NOT NULL CHECK (LENGTH(replacement) > 0),
        created_at  INTEGER NOT NULL
      );

      -- Một term chỉ có một cách đọc trong phạm vi một sách.
      CREATE UNIQUE INDEX idx_pron_book_term
        ON pronunciation_overrides(book_id, term)
        WHERE book_id IS NOT NULL;

      -- Và một cách đọc toàn cục.
      CREATE UNIQUE INDEX idx_pron_global_term
        ON pronunciation_overrides(term)
        WHERE book_id IS NULL;
    `,
  },
];
