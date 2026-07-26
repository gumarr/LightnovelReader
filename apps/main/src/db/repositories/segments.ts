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

  const applyReady = db.transaction((id: string, result: SegmentAudioResult) => {
    readyStmt.run({
      id,
      audioPath: result.audioPath,
      durationMs: result.durationMs,
      audioBytes: result.audioBytes,
      alignStatus: result.alignStatus,
    });

    const row = chapterOf.get(id) as { chapter_id: string } | undefined;
    if (row !== undefined) refreshChapter.run({ chapterId: row.chapter_id });
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
      errorStmt.run(message, id);
    },

    resetToPending(id) {
      pendingStmt.run(id);
    },

    findBookId(segmentId) {
      const row = bookOf.get(segmentId) as { book_id: string } | undefined;
      return row?.book_id;
    },

    listPendingByChapter(chapterId) {
      return (pendingByChapter.all(chapterId) as SegmentRow[]).map(toSegment);
    },
  };
};
