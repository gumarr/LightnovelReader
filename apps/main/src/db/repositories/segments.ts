import type { Database } from 'better-sqlite3';
import type { AlignStatus, Segment, SegmentAnchor, SegmentStatus } from '@ln/shared';

/**
 * Truy vấn bảng `segments`.
 *
 * `anchor` lưu dạng JSON vì hình dạng khác nhau giữa pdf và docx — SQLite
 * không có kiểu union, mà tách thành hai bảng thì mọi truy vấn đều phải join.
 */

type SegmentRow = {
  id: string;
  chapter_id: string;
  idx: number;
  text: string;
  anchor: string;
  audio_path: string | null;
  duration_ms: number | null;
  audio_bytes: number | null;
  status: string;
  align_status: string;
  error_message: string | null;
};

/**
 * Đọc `anchor` từ JSON.
 *
 * Không nuốt lỗi: anchor hỏng nghĩa là DB đã sai, và trả về neo giả sẽ khiến
 * viewer cuộn tới chỗ vô nghĩa mà không ai biết tại sao.
 */
const parseAnchor = (raw: string, segmentId: string): SegmentAnchor => {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null || !('kind' in parsed)) {
    throw new Error(`Segment ${segmentId} có anchor không hợp lệ: ${raw.slice(0, 80)}`);
  }
  return parsed as SegmentAnchor;
};

const toSegment = (row: SegmentRow): Segment => ({
  id: row.id,
  chapterId: row.chapter_id,
  index: row.idx,
  text: row.text,
  anchor: parseAnchor(row.anchor, row.id),
  ...(row.audio_path === null ? {} : { audioPath: row.audio_path }),
  ...(row.duration_ms === null ? {} : { durationMs: row.duration_ms }),
  ...(row.audio_bytes === null ? {} : { audioBytes: row.audio_bytes }),
  status: row.status as SegmentStatus,
  alignStatus: row.align_status as AlignStatus,
  ...(row.error_message === null ? {} : { errorMessage: row.error_message }),
});

/**
 * Số liệu để ước lượng trước khi generate.
 *
 * Trả **tổng số ký tự** chứ không phải danh sách text: một vol cho ~4800 segment,
 * kéo hết text lên chỉ để cộng độ dài là vài MB đi qua IPC cho một con số.
 * `estimateGenerate` bên `shared` nhận mảng text, nên phần cộng làm ngay trong
 * SQL rồi mới đưa vào công thức.
 */
export type PendingStats = {
  /** Số segment CHƯA có audio — đúng những segment sẽ được xếp vào hàng đợi */
  segmentCount: number;
  totalChars: number;
};

/**
 * Số liệu tổng của cả sách cho màn thống kê đọc (P5.4).
 *
 * Gộp bốn phép đếm vào **một** truy vấn: màn thống kê hiện chúng cùng lúc, mà
 * gọi bốn lượt trên bảng ~5000 hàng là bốn lần quét cho một màn hình.
 */
export type BookSegmentStats = {
  segmentCount: number;
  /** Segment đã có audio (`status = 'ready'`) */
  readyCount: number;
  /** Tổng thời lượng audio đã sinh. `0` khi chưa generate gì */
  totalDurationMs: number;
  totalAudioBytes: number;
};

/** Kết quả một lượt generate, ghi lại sau khi sidecar trả về */
export type SegmentAudioResult = {
  audioPath: string;
  durationMs: number;
  audioBytes: number;
  /**
   * Timing từ phoneme lẫn ước lượng đều là `'estimated'` — chỉ CTC forced
   * alignment ở Phase 4 mới được lên `'aligned'`.
   */
  alignStatus: AlignStatus;
};

export type SegmentRepository = {
  insertMany(segments: readonly Segment[]): void;
  listByChapter(chapterId: string): Segment[];
  findById(id: string): Segment | undefined;
  countByChapter(chapterId: string): number;
  /** Segment đã vào hàng đợi nhưng chưa tới lượt */
  markQueued(id: string): void;
  markGenerating(id: string): void;
  /**
   * Ghi kết quả generate và cập nhật `audio_bytes` + `generate_status` của
   * chương trong **cùng một transaction**.
   *
   * Gộp làm một vì hai con số này phải khớp nhau: tách ra thì app tắt đúng giữa
   * hai câu lệnh sẽ để lại chương báo dung lượng khác tổng segment con, và
   * storage manager hiện số sai mà không có cách nào tự phát hiện.
   */
  markReady(id: string, result: SegmentAudioResult): void;
  markError(id: string, message: string): void;
  /** Đưa segment về `pending` khi job bị huỷ — không có audio thì không phải `ready` */
  resetToPending(id: string): void;
  /** ID sách chứa segment, đi ngược qua chapter. `undefined` khi segment không còn */
  findBookId(segmentId: string): string | undefined;
  /** Segment chưa có audio của một chương, theo thứ tự đọc — nguồn để enqueue */
  listPendingByChapter(chapterId: string): Segment[];
  /** Segment chưa có audio của cả sách, theo thứ tự chương rồi thứ tự đọc */
  listPendingByBook(bookId: string): Segment[];
  /** Số liệu ước lượng cho một chương — chỉ tính segment chưa có audio */
  pendingStatsByChapter(chapterId: string): PendingStats;
  pendingStatsByBook(bookId: string): PendingStats;
  /** Tổng của cả sách cho màn thống kê đọc — ngược với `pendingStats*` */
  bookStats(bookId: string): BookSegmentStats;
  /**
   * Số segment nằm **trước** một segment, tính xuyên chương theo mạch đọc.
   *
   * Cơ sở của thanh phần trăm ở màn thống kê. Đếm bằng SQL chứ không nạp cả
   * danh sách về rồi tìm chỉ số: một sách là ~5000 segment, mà con số này chỉ
   * cần cho một dòng chữ.
   */
  countBefore(segmentId: string): number;
  /** Segment ĐÃ có audio của một chương — nguồn để xoá file. Ngược với `listPending*` */
  listReadyByChapter(chapterId: string): Segment[];
  listReadyByBook(bookId: string): Segment[];
  /**
   * Xoá dấu vết audio của cả một chương: đưa segment về `pending` và bỏ
   * `audio_path`/`duration_ms`/`audio_bytes`, rồi tính lại dung lượng chương.
   *
   * Khác `resetToPending` ở hai điểm quan trọng: hàm kia chỉ nhận
   * `queued`/`generating` (dùng khi huỷ job, segment chưa từng có file), còn
   * hàm này nhắm đúng vào `ready` — segment có file trên đĩa vừa bị xoá. Để
   * nguyên `status = 'ready'` thì reader vẫn hiện nút phát cho file không còn.
   *
   * **Không** đụng `books.last_segment_id`: xoá audio giữ nguyên tiến độ đọc.
   */
  clearAudioByChapter(chapterId: string): number;
  clearAudioByBook(bookId: string): number;
};

export const createSegmentRepository = (db: Database): SegmentRepository => {
  const insertStmt = db.prepare(`
    INSERT INTO segments (
      id, chapter_id, idx, text, anchor, audio_path,
      duration_ms, audio_bytes, status, align_status, error_message
    ) VALUES (
      @id, @chapterId, @idx, @text, @anchor, @audioPath,
      @durationMs, @audioBytes, @status, @alignStatus, @errorMessage
    )
  `);

  // Sách 270 trang cho ~5000 segment. Không bọc transaction thì mỗi INSERT là
  // một lần fsync — chậm hơn hàng trăm lần và có thể dừng giữa chừng.
  const insertAll = db.transaction((segments: readonly Segment[]) => {
    for (const segment of segments) {
      insertStmt.run({
        id: segment.id,
        chapterId: segment.chapterId,
        idx: segment.index,
        text: segment.text,
        anchor: JSON.stringify(segment.anchor),
        audioPath: segment.audioPath ?? null,
        durationMs: segment.durationMs ?? null,
        audioBytes: segment.audioBytes ?? null,
        status: segment.status,
        alignStatus: segment.alignStatus,
        errorMessage: segment.errorMessage ?? null,
      });
    }
  });

  const byChapter = db.prepare('SELECT * FROM segments WHERE chapter_id = ? ORDER BY idx');
  const byId = db.prepare('SELECT * FROM segments WHERE id = ?');
  const countStmt = db.prepare('SELECT COUNT(*) AS n FROM segments WHERE chapter_id = ?');

  const setStatus = db.prepare('UPDATE segments SET status = ? WHERE id = ?');

  const readyStmt = db.prepare(`
    UPDATE segments
    SET status = 'ready', audio_path = @audioPath, duration_ms = @durationMs,
        audio_bytes = @audioBytes, align_status = @alignStatus, error_message = NULL
    WHERE id = @id
  `);

  const errorStmt = db.prepare(`
    UPDATE segments SET status = 'error', error_message = ? WHERE id = ?
  `);

  const pendingStmt = db.prepare(`
    UPDATE segments
    SET status = 'pending', error_message = NULL
    WHERE id = ? AND status IN ('queued', 'generating')
  `);

  const chapterOf = db.prepare('SELECT chapter_id FROM segments WHERE id = ?');

  const bookOf = db.prepare(`
    SELECT c.book_id AS book_id
    FROM segments s JOIN chapters c ON c.id = s.chapter_id
    WHERE s.id = ?
  `);

  const pendingByChapter = db.prepare(`
    SELECT * FROM segments
    WHERE chapter_id = ? AND status != 'ready'
    ORDER BY idx
  `);

  // Thứ tự chương rồi thứ tự đọc: hàng đợi chạy tuần tự nên segment sinh trước
  // cũng là segment user gặp trước — generate cả sách thì chương 1 nghe được
  // ngay trong khi chương cuối còn đang chờ.
  const pendingByBook = db.prepare(`
    SELECT s.* FROM segments s
    JOIN chapters c ON c.id = s.chapter_id
    WHERE c.book_id = ? AND s.status != 'ready'
    ORDER BY c.idx, s.idx
  `);

  const statsByChapter = db.prepare(`
    SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(text)), 0) AS chars
    FROM segments
    WHERE chapter_id = ? AND status != 'ready'
  `);

  const statsByBook = db.prepare(`
    SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(s.text)), 0) AS chars
    FROM segments s
    JOIN chapters c ON c.id = s.chapter_id
    WHERE c.book_id = ? AND s.status != 'ready'
  `);

  // `duration_ms`/`audio_bytes` chỉ có giá trị ở segment `ready`, nên không cần
  // lọc thêm — nhưng vẫn `COALESCE` vì sách chưa generate gì cho `SUM` = NULL.
  const bookStatsStmt = db.prepare(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN s.status = 'ready' THEN 1 ELSE 0 END) AS ready,
           COALESCE(SUM(s.duration_ms), 0) AS duration,
           COALESCE(SUM(s.audio_bytes), 0) AS bytes
    FROM segments s
    JOIN chapters c ON c.id = s.chapter_id
    WHERE c.book_id = ?
  `);

  /**
   * Đếm segment đứng trước, so theo cặp `(chương, thứ tự trong chương)`.
   *
   * So `s.idx < current.idx` không đủ: chỉ số segment đếm lại từ 0 ở mỗi
   * chương, nên đoạn 0 của chương 5 sẽ ra "0 đoạn đứng trước". Phải so chương
   * trước đã, cùng chương mới xét tới thứ tự đoạn.
   */
  const countBeforeStmt = db.prepare(`
    SELECT COUNT(*) AS n
    FROM segments s
    JOIN chapters c ON c.id = s.chapter_id
    JOIN (
      SELECT s2.idx AS seg_idx, c2.idx AS chap_idx, c2.book_id AS book_id
      FROM segments s2
      JOIN chapters c2 ON c2.id = s2.chapter_id
      WHERE s2.id = ?
    ) cur
    WHERE c.book_id = cur.book_id
      AND (c.idx < cur.chap_idx OR (c.idx = cur.chap_idx AND s.idx < cur.seg_idx))
  `);

  /**
   * Tính lại dung lượng và tiến độ của chương từ chính các segment con.
   *
   * Cộng dồn (`audio_bytes = audio_bytes + ?`) sẽ đếm trùng khi một segment
   * được generate lại — mà generate lại là chuyện thường (đổi bitrate, đổi
   * giọng). Tính lại từ tổng thì không có đường nào lệch.
   */
  const refreshChapter = db.prepare(`
    UPDATE chapters SET
      audio_bytes = (
        SELECT COALESCE(SUM(audio_bytes), 0) FROM segments WHERE chapter_id = @chapterId
      ),
      error_count = (
        SELECT COUNT(*) FROM segments
        WHERE chapter_id = @chapterId AND status = 'error'
      ),
      generate_status = (
        SELECT CASE
          WHEN COUNT(*) = 0 THEN 'none'
          WHEN SUM(CASE WHEN status = 'ready' THEN 1 ELSE 0 END) = 0 THEN 'none'
          WHEN SUM(CASE WHEN status = 'ready' THEN 1 ELSE 0 END) = COUNT(*) THEN 'complete'
          ELSE 'partial'
        END
        FROM segments WHERE chapter_id = @chapterId
      )
    WHERE id = @chapterId
  `);

  const readyByChapter = db.prepare(`
    SELECT * FROM segments
    WHERE chapter_id = ? AND status = 'ready'
    ORDER BY idx
  `);

  const readyByBook = db.prepare(`
    SELECT s.* FROM segments s
    JOIN chapters c ON c.id = s.chapter_id
    WHERE c.book_id = ? AND s.status = 'ready'
    ORDER BY c.idx, s.idx
  `);

  // Chỉ nhắm `ready`: segment đang `generating` có job chạy dở, đưa nó về
  // `pending` ở đây sẽ đụng nhau với `markReady` của job đó ngay sau.
  const clearAudioStmt = db.prepare(`
    UPDATE segments
    SET status = 'pending', audio_path = NULL, duration_ms = NULL,
        audio_bytes = NULL, align_status = 'none', error_message = NULL
    WHERE chapter_id = ? AND status = 'ready'
  `);

  const chaptersOfBook = db.prepare('SELECT id FROM chapters WHERE book_id = ?');

  const applyClearChapter = db.transaction((chapterId: string): number => {
    const changes = clearAudioStmt.run(chapterId).changes;
    refreshChapter.run({ chapterId });
    return changes;
  });

  // Một transaction cho cả sách: dừng giữa chừng sẽ để lại vài chương báo có
  // audio mà file đã xoá, đúng loại lệch mà `markReady` cố tránh.
  const applyClearBook = db.transaction((bookId: string): number => {
    let changes = 0;
    for (const row of chaptersOfBook.all(bookId) as { id: string }[]) {
      changes += clearAudioStmt.run(row.id).changes;
      refreshChapter.run({ chapterId: row.id });
    }
    return changes;
  });

  /** Tính lại số liệu chương chứa segment này. Không tìm được chương thì bỏ qua. */
  const refreshChapterOf = (segmentId: string): void => {
    const row = chapterOf.get(segmentId) as { chapter_id: string } | undefined;
    if (row !== undefined) refreshChapter.run({ chapterId: row.chapter_id });
  };

  const applyReady = db.transaction((id: string, result: SegmentAudioResult) => {
    readyStmt.run({
      id,
      audioPath: result.audioPath,
      durationMs: result.durationMs,
      audioBytes: result.audioBytes,
      alignStatus: result.alignStatus,
    });

    refreshChapterOf(id);
  });

  // `error_count` của chương phải đổi theo cả hai chiều trong cùng transaction
  // với chính segment: tách ra thì app tắt giữa hai câu lệnh sẽ để lại chương
  // báo số lỗi khác thực tế, mà không có cách nào tự phát hiện.
  const applyError = db.transaction((id: string, message: string) => {
    errorStmt.run(message, id);
    refreshChapterOf(id);
  });

  // Về `pending` là hết lỗi — generate lại được. Không tính lại thì chương giữ
  // mãi con số cũ và UI báo lỗi cho segment đã bình thường.
  const applyPending = db.transaction((id: string) => {
    pendingStmt.run(id);
    refreshChapterOf(id);
  });

  return {
    insertMany(segments) {
      if (segments.length === 0) return;
      insertAll(segments);
    },

    listByChapter(chapterId) {
      return (byChapter.all(chapterId) as SegmentRow[]).map(toSegment);
    },

    findById(id) {
      const row = byId.get(id) as SegmentRow | undefined;
      return row === undefined ? undefined : toSegment(row);
    },

    countByChapter(chapterId) {
      return (countStmt.get(chapterId) as { n: number }).n;
    },

    markQueued(id) {
      setStatus.run('queued', id);
    },

    markGenerating(id) {
      setStatus.run('generating', id);
    },

    markReady(id, result) {
      applyReady(id, result);
    },

    markError(id, message) {
      applyError(id, message);
    },

    resetToPending(id) {
      applyPending(id);
    },

    findBookId(segmentId) {
      const row = bookOf.get(segmentId) as { book_id: string } | undefined;
      return row?.book_id;
    },

    listPendingByChapter(chapterId) {
      return (pendingByChapter.all(chapterId) as SegmentRow[]).map(toSegment);
    },

    listPendingByBook(bookId) {
      return (pendingByBook.all(bookId) as SegmentRow[]).map(toSegment);
    },

    pendingStatsByChapter(chapterId) {
      const row = statsByChapter.get(chapterId) as { n: number; chars: number };
      return { segmentCount: row.n, totalChars: row.chars };
    },

    pendingStatsByBook(bookId) {
      const row = statsByBook.get(bookId) as { n: number; chars: number };
      return { segmentCount: row.n, totalChars: row.chars };
    },

    bookStats(bookId) {
      const row = bookStatsStmt.get(bookId) as {
        total: number;
        // `SUM` trên bảng rỗng trả NULL — sách chưa có segment nào rơi vào đây
        ready: number | null;
        duration: number;
        bytes: number;
      };
      return {
        segmentCount: row.total,
        readyCount: row.ready ?? 0,
        totalDurationMs: row.duration,
        totalAudioBytes: row.bytes,
      };
    },

    countBefore(segmentId) {
      // Segment không tồn tại thì mệnh đề JOIN không có hàng nào → COUNT = 0.
      return (countBeforeStmt.get(segmentId) as { n: number }).n;
    },

    listReadyByChapter(chapterId) {
      return (readyByChapter.all(chapterId) as SegmentRow[]).map(toSegment);
    },

    listReadyByBook(bookId) {
      return (readyByBook.all(bookId) as SegmentRow[]).map(toSegment);
    },

    clearAudioByChapter(chapterId) {
      return applyClearChapter(chapterId);
    },

    clearAudioByBook(bookId) {
      return applyClearBook(bookId);
    },
  };
};
