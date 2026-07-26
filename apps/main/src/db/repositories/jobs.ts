import type { Database } from 'better-sqlite3';
import type { Job, JobStatus, JobType } from '@ln/shared';
import { JOB_MAX_ATTEMPTS, JOB_PRIORITY_NORMAL } from '@ln/shared';

/**
 * Truy vấn bảng `jobs` — hàng đợi generate **persist trong SQLite**.
 *
 * Persist chứ không giữ trong RAM vì một vol có ~4800 segment: generate cả sách
 * mất hàng giờ, mà đóng app giữa chừng thì phải chạy tiếp được chứ không phải
 * làm lại từ đầu.
 *
 * Trạng thái job và trạng thái segment là **hai chuyện khác nhau**: job kể quá
 * trình (đang chờ / đang chạy / đã huỷ), segment kể kết quả (đã có audio chưa).
 * Worker cập nhật cả hai, xem `queue.ts`.
 */

type JobRow = {
  id: string;
  type: string;
  segment_id: string;
  priority: number;
  status: string;
  attempts: number;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  error_message: string | null;
};

const toJob = (row: JobRow): Job => ({
  id: row.id,
  type: row.type as JobType,
  segmentId: row.segment_id,
  priority: row.priority,
  status: row.status as JobStatus,
  attempts: row.attempts,
  createdAt: row.created_at,
  ...(row.started_at === null ? {} : { startedAt: row.started_at }),
  ...(row.finished_at === null ? {} : { finishedAt: row.finished_at }),
  ...(row.error_message === null ? {} : { errorMessage: row.error_message }),
});

export type EnqueueInput = {
  id: string;
  type: JobType;
  segmentId: string;
  priority?: number;
  createdAt: number;
};

/** Số job theo trạng thái, đủ để UI vẽ thanh tiến độ mà không phải tải cả danh sách */
export type QueueCounts = {
  queued: number;
  running: number;
  done: number;
  error: number;
  cancelled: number;
};

export type JobRepository = {
  /**
   * Thêm job, hoặc **nâng priority** nếu segment đã có job cùng loại đang chờ.
   *
   * Trả về job hiện hành. Không bao giờ tạo job trùng: schema có unique index
   * trên `(segment_id, type)` khi còn `queued`/`running`, và người dùng bấm
   * generate hai lần thì phải là một lượt chứ không phải hai.
   */
  enqueue(input: EnqueueInput): Job;
  enqueueMany(inputs: readonly EnqueueInput[]): number;
  /**
   * Lấy job ưu tiên cao nhất và đánh dấu `running` trong **một** transaction.
   *
   * Gộp làm một là bắt buộc: đọc rồi mới ghi ở hai bước tách rời thì hai worker
   * (hoặc một worker bị gọi lại trước khi lượt trước xong) cùng nhận một job.
   */
  claimNext(now: number): Job | undefined;
  markDone(id: string, finishedAt: number): void;
  /**
   * Job hỏng: tăng `attempts`. Còn lượt thì trả về hàng đợi, hết lượt thì
   * `error`. Trả về `true` khi còn thử lại được.
   */
  markError(id: string, message: string, finishedAt: number): boolean;
  /** Huỷ một job đang chờ hoặc đang chạy. `false` khi không có gì để huỷ. */
  cancel(id: string, now: number): boolean;
  /**
   * Huỷ mọi job còn chờ/chạy của một sách.
   *
   * Trả về **ID segment** đã bị ảnh hưởng chứ không phải số lượng: huỷ job xong
   * mà không đưa segment về `pending` thì chúng kẹt ở `queued` vĩnh viễn — UI
   * quay vòng cho một việc không còn ai làm, và enqueue lại cũng không cứu
   * được. Nơi gọi cần danh sách này để dọn.
   */
  cancelByBook(bookId: string, now: number): string[];
  cancelAll(now: number): string[];
  findById(id: string): Job | undefined;
  findActiveBySegment(segmentId: string, type: JobType): Job | undefined;
  counts(): QueueCounts;
  countsByBook(bookId: string): QueueCounts;
  /** Job đang chờ/chạy, ưu tiên cao trước — để UI hiện hàng đợi */
  listPending(limit: number): Job[];
  /**
   * Đưa job `running` mồ côi về `queued`. Gọi **một lần lúc khởi động**.
   *
   * Job đang chạy lúc app bị tắt đột ngột (mất điện, kill) sẽ mắc kẹt ở
   * `running` mãi mãi: worker mới không nhận nó (chỉ nhận `queued`), mà unique
   * index lại chặn tạo job mới cho segment đó — segment thành không bao giờ
   * generate được, và không có gì trong UI giải thích tại sao.
   *
   * **Không** reset `attempts`: job làm sidecar chết mỗi lần chạy sẽ bị thử lại
   * vô hạn nếu xoá bộ đếm, mỗi lần lại kéo sập app một lượt.
   */
  requeueOrphans(): number;
};

export const createJobRepository = (db: Database): JobRepository => {
  const insertStmt = db.prepare(`
    INSERT INTO jobs (id, type, segment_id, priority, status, attempts, created_at)
    VALUES (@id, @type, @segmentId, @priority, 'queued', 0, @createdAt)
  `);

  const activeBySegment = db.prepare(`
    SELECT * FROM jobs
    WHERE segment_id = ? AND type = ? AND status IN ('queued', 'running')
  `);

  // Chỉ nâng, không hạ: segment sắp phát được đẩy lên đầu hàng đợi, nhưng một
  // lượt prefetch đến sau không được kéo nó tụt xuống.
  const raisePriority = db.prepare(`
    UPDATE jobs SET priority = ? WHERE id = ? AND priority < ?
  `);

  const byId = db.prepare('SELECT * FROM jobs WHERE id = ?');

  const nextQueued = db.prepare(`
    SELECT * FROM jobs
    WHERE status = 'queued'
    ORDER BY priority DESC, created_at
    LIMIT 1
  `);

  const startJob = db.prepare(`
    UPDATE jobs
    SET status = 'running', started_at = ?, attempts = attempts + 1
    WHERE id = ? AND status = 'queued'
  `);

  const doneStmt = db.prepare(`
    UPDATE jobs SET status = 'done', finished_at = ?, error_message = NULL WHERE id = ?
  `);

  const failStmt = db.prepare(`
    UPDATE jobs SET status = 'error', finished_at = ?, error_message = ? WHERE id = ?
  `);

  const retryStmt = db.prepare(`
    UPDATE jobs
    SET status = 'queued', started_at = NULL, error_message = ?
    WHERE id = ?
  `);

  const cancelStmt = db.prepare(`
    UPDATE jobs
    SET status = 'cancelled', finished_at = ?
    WHERE id = ? AND status IN ('queued', 'running')
  `);

  // Job không giữ `book_id` — đi ngược qua segment → chapter mới ra sách. Đổi
  // lại là không có cột thừa để lệch khi sách bị xoá rồi nhập lại.
  const cancelByBookStmt = db.prepare(`
    UPDATE jobs
    SET status = 'cancelled', finished_at = ?
    WHERE status IN ('queued', 'running')
      AND segment_id IN (
        SELECT s.id FROM segments s
        JOIN chapters c ON c.id = s.chapter_id
        WHERE c.book_id = ?
      )
  `);

  const cancelAllStmt = db.prepare(`
    UPDATE jobs SET status = 'cancelled', finished_at = ? WHERE status IN ('queued', 'running')
  `);

  // Đọc segment bị ảnh hưởng TRƯỚC khi huỷ — sau khi UPDATE thì không còn
  // `queued`/`running` nào để lọc ra nữa.
  const activeSegmentsByBook = db.prepare(`
    SELECT DISTINCT j.segment_id AS segment_id
    FROM jobs j
    JOIN segments s ON s.id = j.segment_id
    JOIN chapters c ON c.id = s.chapter_id
    WHERE j.status IN ('queued', 'running') AND c.book_id = ?
  `);

  const activeSegmentsAll = db.prepare(`
    SELECT DISTINCT segment_id FROM jobs WHERE status IN ('queued', 'running')
  `);

  const cancelBookTx = db.transaction((bookId: string, at: number): string[] => {
    const ids = (activeSegmentsByBook.all(bookId) as { segment_id: string }[]).map(
      (row) => row.segment_id,
    );
    cancelByBookStmt.run(at, bookId);
    return ids;
  });

  const cancelAllTx = db.transaction((at: number): string[] => {
    const ids = (activeSegmentsAll.all() as { segment_id: string }[]).map((row) => row.segment_id);
    cancelAllStmt.run(at);
    return ids;
  });

  const countsStmt = db.prepare('SELECT status, COUNT(*) AS n FROM jobs GROUP BY status');

  const countsByBookStmt = db.prepare(`
    SELECT j.status AS status, COUNT(*) AS n
    FROM jobs j
    JOIN segments s ON s.id = j.segment_id
    JOIN chapters c ON c.id = s.chapter_id
    WHERE c.book_id = ?
    GROUP BY j.status
  `);

  const pendingStmt = db.prepare(`
    SELECT * FROM jobs
    WHERE status IN ('queued', 'running')
    ORDER BY status DESC, priority DESC, created_at
    LIMIT ?
  `);

  const orphanStmt = db.prepare(`
    UPDATE jobs
    SET status = 'queued', started_at = NULL
    WHERE status = 'running'
  `);

  const readCounts = (rows: { status: string; n: number }[]): QueueCounts => {
    const counts: QueueCounts = { queued: 0, running: 0, done: 0, error: 0, cancelled: 0 };
    for (const row of rows) {
      if (row.status in counts) counts[row.status as keyof QueueCounts] = row.n;
    }
    return counts;
  };

  const enqueueOne = db.transaction((input: EnqueueInput): Job => {
    const priority = input.priority ?? JOB_PRIORITY_NORMAL;
    const existing = activeBySegment.get(input.segmentId, input.type) as JobRow | undefined;

    if (existing !== undefined) {
      raisePriority.run(priority, existing.id, priority);
      return toJob(byId.get(existing.id) as JobRow);
    }

    insertStmt.run({
      id: input.id,
      type: input.type,
      segmentId: input.segmentId,
      priority,
      createdAt: input.createdAt,
    });
    return toJob(byId.get(input.id) as JobRow);
  });

  // Một transaction cho cả mẻ: "generate cả chương" là hàng trăm segment, mỗi
  // INSERT rời là một lần fsync.
  //
  // Đếm số job **mới tạo**, không phải số input: segment đã nằm trong hàng đợi
  // chỉ được nâng priority chứ không sinh job thứ hai, mà UI cần con số thật để
  // nói "đã thêm N segment vào hàng đợi".
  const enqueueBatch = db.transaction((inputs: readonly EnqueueInput[]): number => {
    let added = 0;
    for (const input of inputs) {
      const existing = activeBySegment.get(input.segmentId, input.type) as JobRow | undefined;
      enqueueOne(input);
      if (existing === undefined) added += 1;
    }
    return added;
  });

  const claim = db.transaction((now: number): Job | undefined => {
    const row = nextQueued.get() as JobRow | undefined;
    if (row === undefined) return undefined;

    const result = startJob.run(now, row.id);
    // Không đổi được dòng nào nghĩa là job vừa bị huỷ xen vào giữa — bỏ qua
    // lượt này chứ không trả về job đã chết.
    if (result.changes === 0) return undefined;

    return toJob(byId.get(row.id) as JobRow);
  });

  const fail = db.transaction((id: string, message: string, finishedAt: number): boolean => {
    const row = byId.get(id) as JobRow | undefined;
    if (row === undefined) return false;

    // `attempts` đã tăng lúc claim, nên nó là số lượt ĐÃ chạy.
    if (row.attempts < JOB_MAX_ATTEMPTS) {
      retryStmt.run(message, id);
      return true;
    }

    failStmt.run(finishedAt, message, id);
    return false;
  });

  return {
    enqueue(input) {
      return enqueueOne(input);
    },

    enqueueMany(inputs) {
      if (inputs.length === 0) return 0;
      return enqueueBatch(inputs);
    },

    claimNext(now) {
      return claim(now);
    },

    markDone(id, finishedAt) {
      doneStmt.run(finishedAt, id);
    },

    markError(id, message, finishedAt) {
      return fail(id, message, finishedAt);
    },

    cancel(id, now) {
      return cancelStmt.run(now, id).changes > 0;
    },

    cancelByBook(bookId, now) {
      return cancelBookTx(bookId, now);
    },

    cancelAll(now) {
      return cancelAllTx(now);
    },

    findById(id) {
      const row = byId.get(id) as JobRow | undefined;
      return row === undefined ? undefined : toJob(row);
    },

    findActiveBySegment(segmentId, type) {
      const row = activeBySegment.get(segmentId, type) as JobRow | undefined;
      return row === undefined ? undefined : toJob(row);
    },

    counts() {
      return readCounts(countsStmt.all() as { status: string; n: number }[]);
    },

    countsByBook(bookId) {
      return readCounts(countsByBookStmt.all(bookId) as { status: string; n: number }[]);
    },

    listPending(limit) {
      return (pendingStmt.all(limit) as JobRow[]).map(toJob);
    },

    requeueOrphans() {
      return orphanStmt.run().changes;
    },
  };
};
