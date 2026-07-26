import { describe, expect, it, vi } from 'vitest';
import type { Job, Segment } from '@ln/shared';
import { JOB_PRIORITY_URGENT } from '@ln/shared';
import { createQueueHandlers, toQueueStatusInfo } from './queue.js';
import type { GenerateQueue, QueueStatus } from '../../services/queue.js';
import type { JobRepository } from '../../db/repositories/jobs.js';
import type { SegmentRepository } from '../../db/repositories/segments.js';
import { InvalidInputError } from '../wrap.js';

/**
 * Test handler `queue:*`.
 *
 * Trọng tâm là thứ **không** lộ ra ở `services/queue.ts`: kiểm input từ
 * renderer, và quyết định "xếp hàng xong thì có tự chạy không".
 */

const status = (overrides: Partial<QueueStatus> = {}): QueueStatus => ({
  state: 'idle',
  counts: { queued: 0, running: 0, done: 0, error: 0, cancelled: 0 },
  ...overrides,
});

const segment = (id: string): Segment => ({
  id,
  chapterId: 'chap-1',
  index: 0,
  text: 'Câu.',
  anchor: { kind: 'pdf', page: 1, rects: [] },
  status: 'pending',
  alignStatus: 'none',
});

const setup = (
  overrides: {
    queue?: Partial<GenerateQueue>;
    pending?: Segment[];
    jobs?: Job[];
  } = {},
) => {
  let current = status();
  const enqueueSegments = vi.fn((input: { segmentIds: readonly string[] }) => {
    current = status({ state: 'idle' });
    return input.segmentIds.length;
  });

  const queue: GenerateQueue = {
    enqueueSegments,
    start: vi.fn(() => {
      current = status({ state: 'running' });
    }),
    pause: vi.fn(() => {
      current = status({ state: 'paused' });
    }),
    resume: vi.fn(() => {
      current = status({ state: 'running' });
    }),
    cancelJob: vi.fn(() => true),
    cancelBook: vi.fn(() => 2),
    cancelAll: vi.fn(() => 3),
    getStatus: vi.fn(() => current),
    recover: vi.fn(() => 0),
    ...overrides.queue,
  };

  const jobs = {
    listPending: vi.fn(() => overrides.jobs ?? []),
  } as unknown as JobRepository;

  const segments = {
    listPendingByChapter: vi.fn(() => overrides.pending ?? []),
  } as unknown as SegmentRepository;

  return { handlers: createQueueHandlers({ queue, jobs, segments }), queue, jobs, segments };
};

describe('queue:enqueueSegments', () => {
  it('xếp hàng và trả về số job mới', () => {
    const { handlers } = setup();

    const result = handlers.enqueueSegments({ segmentIds: ['seg-1', 'seg-2'] });

    expect(result).toEqual({ ok: true, data: { added: 2 } });
  });

  it('tự chạy luôn — user bấm generate là muốn nó chạy', () => {
    const { handlers, queue } = setup();

    handlers.enqueueSegments({ segmentIds: ['seg-1'] });

    expect(queue.start).toHaveBeenCalled();
  });

  it('KHÔNG tự chạy khi user đang chủ động tạm dừng', () => {
    const { handlers, queue } = setup({
      queue: { getStatus: vi.fn(() => status({ state: 'paused' })) },
    });

    handlers.enqueueSegments({ segmentIds: ['seg-1'] });

    expect(queue.start).not.toHaveBeenCalled();
  });

  it('truyền priority xuống để segment sắp phát chen lên đầu', () => {
    const { handlers, queue } = setup();

    handlers.enqueueSegments({ segmentIds: ['seg-1'], priority: JOB_PRIORITY_URGENT });

    expect(queue.enqueueSegments).toHaveBeenCalledWith({
      segmentIds: ['seg-1'],
      priority: JOB_PRIORITY_URGENT,
    });
  });

  it('danh sách rỗng bị từ chối', () => {
    const { handlers } = setup();

    expect(() => handlers.enqueueSegments({ segmentIds: [] })).toThrow(InvalidInputError);
  });

  it('renderer hỏng không ép main dựng hàng đợi vô hạn', () => {
    const { handlers } = setup();
    const tooMany = Array.from({ length: 5001 }, (_, i) => `seg-${String(i)}`);

    expect(() => handlers.enqueueSegments({ segmentIds: tooMany })).toThrow(InvalidInputError);
  });

  it('input sai kiểu bị từ chối', () => {
    const { handlers } = setup();

    expect(() => handlers.enqueueSegments({ segmentIds: 'seg-1' })).toThrow(InvalidInputError);
    expect(() => handlers.enqueueSegments(null)).toThrow(InvalidInputError);
  });
});

describe('queue:enqueueChapter', () => {
  it('chỉ xếp segment CHƯA có audio', () => {
    // Xếp lại cả chương đã xong là tổng hợp lại hàng trăm segment không ai yêu cầu.
    const { handlers, queue } = setup({ pending: [segment('seg-2'), segment('seg-3')] });

    const result = handlers.enqueueChapter({ chapterId: 'chap-1' });

    expect(queue.enqueueSegments).toHaveBeenCalledWith({ segmentIds: ['seg-2', 'seg-3'] });
    expect(result).toEqual({ ok: true, data: { added: 2 } });
  });

  it('chương đã generate xong hết thì không làm gì', () => {
    const { handlers, queue } = setup({ pending: [] });

    expect(handlers.enqueueChapter({ chapterId: 'chap-1' })).toEqual({
      ok: true,
      data: { added: 0 },
    });
    expect(queue.enqueueSegments).not.toHaveBeenCalled();
  });

  it('chapterId sai bị từ chối', () => {
    const { handlers } = setup();

    expect(() => handlers.enqueueChapter({ chapterId: '' })).toThrow(InvalidInputError);
  });
});

describe('queue:getStatus', () => {
  it('làm phẳng số đếm cho renderer', () => {
    const { handlers } = setup({
      queue: {
        getStatus: vi.fn(() =>
          status({
            state: 'running',
            counts: { queued: 5, running: 1, done: 10, error: 2, cancelled: 0 },
            currentSegmentId: 'seg-7',
          }),
        ),
      },
    });

    expect(handlers.getStatus()).toEqual({
      ok: true,
      data: {
        state: 'running',
        queued: 5,
        running: 1,
        done: 10,
        error: 2,
        cancelled: 0,
        currentSegmentId: 'seg-7',
      },
    });
  });

  it('rỗi thì KHÔNG có currentSegmentId undefined lẫn vào', () => {
    // `exactOptionalPropertyTypes` bật — field optional phải vắng mặt hẳn.
    const info = toQueueStatusInfo(status());
    expect(info).not.toHaveProperty('currentSegmentId');
  });
});

describe('queue:listPending', () => {
  it('trả danh sách job đang chờ', () => {
    const job: Job = {
      id: 'job-1',
      type: 'synthesize',
      segmentId: 'seg-1',
      priority: 0,
      status: 'queued',
      attempts: 0,
      createdAt: 1000,
    };
    const { handlers } = setup({ jobs: [job] });

    expect(handlers.listPending()).toEqual({ ok: true, data: [job] });
  });

  it('có trần số lượng — generate cả sách là ~4800 job', () => {
    const { handlers, jobs } = setup();
    handlers.listPending();

    expect(jobs.listPending).toHaveBeenCalledWith(200);
  });
});

describe('queue:pause / resume', () => {
  it('pause trả về trạng thái đã đổi', () => {
    const { handlers } = setup();

    expect(handlers.pause()).toMatchObject({ ok: true, data: { state: 'paused' } });
  });

  it('resume chạy tiếp', () => {
    const { handlers, queue } = setup();
    handlers.resume();

    expect(queue.resume).toHaveBeenCalled();
  });
});

describe('queue:cancel', () => {
  it('huỷ được job đang chờ', () => {
    const { handlers } = setup();

    expect(handlers.cancelJob('job-1')).toEqual({ ok: true, data: undefined });
  });

  it('job không còn thì báo lỗi rõ ràng chứ không im lặng', () => {
    // UI vừa hiện job đó ra để user bấm — không còn nghĩa là danh sách đã cũ.
    const { handlers } = setup({ queue: { cancelJob: vi.fn(() => false) } });

    const result = handlers.cancelJob('job-1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
  });

  it('jobId sai bị từ chối', () => {
    const { handlers } = setup();

    expect(() => handlers.cancelJob('')).toThrow(InvalidInputError);
    expect(() => handlers.cancelJob(123)).toThrow(InvalidInputError);
  });

  it('huỷ theo sách trả về số job đã huỷ', () => {
    const { handlers } = setup();

    expect(handlers.cancelBook('book-1')).toEqual({ ok: true, data: { added: 2 } });
  });

  it('bookId sai bị từ chối', () => {
    const { handlers } = setup();

    expect(() => handlers.cancelBook('')).toThrow(InvalidInputError);
  });

  it('huỷ tất cả', () => {
    const { handlers } = setup();

    expect(handlers.cancelAll()).toEqual({ ok: true, data: { added: 3 } });
  });
});
