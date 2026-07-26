import {
  bookIdSchema,
  enqueueChapterSchema,
  enqueueSegmentsSchema,
  err,
  jobIdSchema,
  ok,
  type EnqueueResult,
  type Job,
  type QueueStatusInfo,
  type Result,
} from '@ln/shared';
import type { GenerateQueue, QueueStatus } from '../../services/queue.js';
import type { JobRepository } from '../../db/repositories/jobs.js';
import type { SegmentRepository } from '../../db/repositories/segments.js';
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

export const createQueueHandlers = (deps: QueueHandlerDeps): QueueHandlers => {
  const { queue, jobs, segments } = deps;

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
