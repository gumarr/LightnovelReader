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

export type SegmentRepository = {
  insertMany(segments: readonly Segment[]): void;
  listByChapter(chapterId: string): Segment[];
  findById(id: string): Segment | undefined;
  countByChapter(chapterId: string): number;
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
  };
};
