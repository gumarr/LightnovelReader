import {
  bookIdSchema,
  chapterIdSchema,
  enqueueChapterSchema,
  enqueueSegmentsSchema,
  err,
  estimateFromTotals,
  jobIdSchema,
  ok,
  type AudioBitrate,
  type EnqueueResult,
  type GenerateEstimateInfo,
  type Job,
  type QueueStatusInfo,
  type Result,
} from '@ln/shared';
import type { GenerateQueue, QueueStatus } from '../../services/queue.js';
import type { ChapterRepository } from '../../db/repositories/chapters.js';
import type { JobRepository } from '../../db/repositories/jobs.js';
import type { PendingStats, SegmentRepository } from '../../db/repositories/segments.js';
import { InvalidInputError } from '../wrap.js';

/**
 * Handler cho nhóm `queue:*` — hàng đợi generate audio.
 *
 * Handler ở đây **mỏng**: mọi quyết định nằm ở `services/queue.ts`. Việc của
 * lớp này chỉ là kiểm input từ renderer rồi dịch sang lời gọi service, đúng như
 * các nhóm handler khác.
 */

export type QueueHandlers = {
  enqueueSegments: (input: unknown) => Result<EnqueueResult>;
  enqueueChapter: (input: unknown) => Result<EnqueueResult>;
  enqueueBook: (input: unknown) => Result<EnqueueResult>;
  estimateChapter: (input: unknown) => Result<GenerateEstimateInfo>;
  estimateBook: (input: unknown) => Result<GenerateEstimateInfo>;
  getStatus: () => Result<QueueStatusInfo>;
  listPending: () => Result<Job[]>;
  pause: () => Result<QueueStatusInfo>;
  resume: () => Result<QueueStatusInfo>;
  cancelJob: (input: unknown) => Result<void>;
  cancelBook: (input: unknown) => Result<EnqueueResult>;
  cancelAll: () => Result<EnqueueResult>;
};

export type QueueHandlerDeps = {
  queue: GenerateQueue;
  jobs: JobRepository;
  segments: SegmentRepository;
  chapters: ChapterRepository;
  /** Bitrate hiện tại — ước lượng dung lượng phụ thuộc nó (16/24/32 chênh 2×) */
  getBitrate: () => AudioBitrate;
};

/** Số job tối đa trả về cho bảng hàng đợi — UI không hiện nổi hơn thế */
const PENDING_LIMIT = 200;

/** Đổi trạng thái nội bộ sang hình dạng phẳng mà renderer dùng */
export const toQueueStatusInfo = (status: QueueStatus): QueueStatusInfo => ({
  state: status.state,
  queued: status.counts.queued,
  running: status.counts.running,
  done: status.counts.done,
  error: status.counts.error,
  cancelled: status.counts.cancelled,
  ...(status.currentSegmentId === undefined
    ? {}
    : { currentSegmentId: status.currentSegmentId }),
});

/** Ghép số liệu DB với công thức ước lượng dùng chung ở `shared` */
const toEstimateInfo = (
  stats: PendingStats,
  existingBytes: number,
  bitrate: AudioBitrate,
): GenerateEstimateInfo => {
  const estimate = estimateFromTotals(stats.segmentCount, stats.totalChars, bitrate);
  return {
    segmentCount: estimate.segmentCount,
    totalChars: estimate.totalChars,
    audioDurationMs: estimate.audioDurationMs,
    audioBytes: estimate.audioBytes,
    processingMs: estimate.processingMs,
    existingBytes,
  };
};

export const createQueueHandlers = (deps: QueueHandlerDeps): QueueHandlers => {
  const { queue, jobs, segments, chapters, getBitrate } = deps;

  return {
    enqueueSegments: (input) => {
      const parsed = enqueueSegmentsSchema.safeParse(input);
      if (!parsed.success) throw new InvalidInputError('Danh sách segment không hợp lệ');

      const { segmentIds, priority } = parsed.data;
      const added = queue.enqueueSegments({
        segmentIds,
        ...(priority === undefined ? {} : { priority }),
      });
      // Bắt đầu ngay: user bấm generate là muốn nó chạy, không phải chờ thêm
      // một cú bấm nữa. Hàng đợi đang tạm dừng thì `start()` không đụng vào —
      // tôn trọng việc user đã chủ động dừng.
      if (queue.getStatus().state === 'idle') queue.start();

      return ok({ added });
    },

    enqueueChapter: (input) => {
      const parsed = enqueueChapterSchema.safeParse(input);
      if (!parsed.success) throw new InvalidInputError('chapterId không hợp lệ');

      const { chapterId, priority } = parsed.data;
      // Chỉ lấy segment CHƯA có audio: xếp lại cả chương đã generate xong là
      // tổng hợp lại hàng trăm segment không ai yêu cầu.
      const pending = segments.listPendingByChapter(chapterId);
      if (pending.length === 0) return ok({ added: 0 });

      const added = queue.enqueueSegments({
        segmentIds: pending.map((segment) => segment.id),
        ...(priority === undefined ? {} : { priority }),
      });
      if (queue.getStatus().state === 'idle') queue.start();

      return ok({ added });
    },

    enqueueBook: (input) => {
      const parsed = bookIdSchema.safeParse(input);
      if (!parsed.success) throw new InvalidInputError('bookId không hợp lệ');

      const pending = segments.listPendingByBook(parsed.data);
      if (pending.length === 0) return ok({ added: 0 });

      // Priority mặc định cho cả sách: đây là lượt chạy nền dài, segment user
      // sắp nghe tới vẫn phải chen lên trước được (`JOB_PRIORITY_URGENT`).
      const added = queue.enqueueSegments({ segmentIds: pending.map((segment) => segment.id) });
      if (queue.getStatus().state === 'idle') queue.start();

      return ok({ added });
    },

    estimateChapter: (input) => {
      const parsed = chapterIdSchema.safeParse(input);
      if (!parsed.success) throw new InvalidInputError('chapterId không hợp lệ');

      const chapter = chapters.findById(parsed.data);
      if (chapter === undefined) return err('NOT_FOUND', 'Không tìm thấy chương này.');

      return ok(
        toEstimateInfo(segments.pendingStatsByChapter(chapter.id), chapter.audioBytes, getBitrate()),
      );
    },

    estimateBook: (input) => {
      const parsed = bookIdSchema.safeParse(input);
      if (!parsed.success) throw new InvalidInputError('bookId không hợp lệ');

      const bookId = parsed.data;
      const stats = segments.pendingStatsByBook(bookId);
      const existingBytes = chapters.audioBytesByBook(bookId);

      // Sách không tồn tại và sách đã generate xong cho ra cùng con số 0. Chỉ
      // báo NOT_FOUND khi thật sự không có chương nào — nếu không thì sách vừa
      // generate xong lại hiện lỗi "không tìm thấy".
      if (stats.segmentCount === 0 && chapters.listByBook(bookId).length === 0) {
        return err('NOT_FOUND', 'Không tìm thấy sách này.');
      }

      return ok(toEstimateInfo(stats, existingBytes, getBitrate()));
    },

    getStatus: () => ok(toQueueStatusInfo(queue.getStatus())),

    listPending: () => ok(jobs.listPending(PENDING_LIMIT)),

    pause: () => {
      queue.pause();
      return ok(toQueueStatusInfo(queue.getStatus()));
    },

    resume: () => {
      queue.resume();
      return ok(toQueueStatusInfo(queue.getStatus()));
    },

    cancelJob: (input) => {
      const parsed = jobIdSchema.safeParse(input);
      if (!parsed.success) throw new InvalidInputError('jobId không hợp lệ');

      // Không tìm thấy job là lỗi thật sự đáng báo: UI vừa hiện nó ra để user
      // bấm huỷ, mà giờ không còn — danh sách đang hiển thị đã cũ.
      if (!queue.cancelJob(parsed.data)) {
        return err('NOT_FOUND', 'Job này đã xong hoặc đã bị huỷ trước đó.');
      }
      return ok(undefined);
    },

    cancelBook: (input) => {
      const parsed = bookIdSchema.safeParse(input);
      if (!parsed.success) throw new InvalidInputError('bookId không hợp lệ');

      return ok({ added: queue.cancelBook(parsed.data) });
    },

    cancelAll: () => ok({ added: queue.cancelAll() }),
  };
};
