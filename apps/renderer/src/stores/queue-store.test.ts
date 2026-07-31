import { beforeEach, describe, expect, it } from 'vitest';
import { err, JOB_PRIORITY_PREFETCH } from '@ln/shared';
import { installFakeApi, type FakeApi } from '@/test/fake-api';
import { isBusyOf, pendingCountOf, useQueueStore } from './queue-store';

/**
 * Test store hàng đợi generate.
 *
 * Trọng tâm: mọi lời gọi IPC bắt được rejection (PROGRESS 4.3), và prefetch
 * không xếp trùng một chương hai lần.
 */

let fake: FakeApi;

const reset = (): void => {
  useQueueStore.setState({
    status: null,
    pending: [],
    pendingLoaded: false,
    error: null,
    prefetched: [],
  });
};

beforeEach(() => {
  fake = installFakeApi();
  reset();
});

describe('loadStatus', () => {
  it('nạp trạng thái từ main', async () => {
    await useQueueStore.getState().loadStatus();

    expect(useQueueStore.getState().status?.state).toBe('idle');
    expect(useQueueStore.getState().error).toBeNull();
  });

  it('lỗi từ main hiện ra cho user', async () => {
    fake.api.queue.getStatus.mockResolvedValueOnce(err('UNKNOWN', 'Hàng đợi lỗi.'));

    await useQueueStore.getState().loadStatus();

    expect(useQueueStore.getState().error).toContain('Hàng đợi lỗi');
  });

  it('IPC reject cũng bắt được, không để promise nổ ra ngoài', async () => {
    fake.api.queue.getStatus.mockRejectedValueOnce(new Error('main đã chết'));

    await useQueueStore.getState().loadStatus();

    expect(useQueueStore.getState().error).not.toBeNull();
    expect(useQueueStore.getState().status).toBeNull();
  });
});

describe('applyStatus', () => {
  it('nhận trạng thái main đẩy xuống mà không gọi IPC', () => {
    useQueueStore.getState().applyStatus({
      state: 'running',
      queued: 4,
      running: 1,
      done: 2,
      error: 0,
      cancelled: 0,
    });

    expect(useQueueStore.getState().status?.queued).toBe(4);
    expect(fake.api.queue.getStatus).not.toHaveBeenCalled();
  });
});

describe('enqueueChapter', () => {
  it('trả số job mới và nạp lại trạng thái', async () => {
    const added = await useQueueStore.getState().enqueueChapter('chap-1');

    expect(added).toBe(3);
    expect(fake.api.queue.enqueueChapter).toHaveBeenCalledWith({ chapterId: 'chap-1' });
    // Nạp lại để UI đúng cả khi event bị bỏ lỡ
    expect(fake.api.queue.getStatus).toHaveBeenCalled();
  });

  it('hỏng thì trả 0 chứ không throw', async () => {
    fake.api.queue.enqueueChapter.mockResolvedValueOnce(
      err('SIDECAR_UNAVAILABLE', 'Dịch vụ TTS chưa chạy.'),
    );

    const added = await useQueueStore.getState().enqueueChapter('chap-1');

    expect(added).toBe(0);
    // Lượt nạp lại trạng thái ngay sau đó thành công, nhưng KHÔNG được xoá lỗi
    // của việc user vừa yêu cầu — nếu không thông báo biến mất trước khi đọc được.
    expect(useQueueStore.getState().error).toContain('chưa chạy');
  });

  it('lỗi vẫn còn dù lượt nạp lại trạng thái thành công', async () => {
    fake.api.queue.enqueueBook.mockResolvedValueOnce(err('UNKNOWN', 'ổ đĩa đầy'));

    await useQueueStore.getState().enqueueBook('book-1');

    expect(fake.api.queue.getStatus).toHaveBeenCalled();
    expect(useQueueStore.getState().error).toContain('ổ đĩa đầy');
  });
});

describe('enqueueBook', () => {
  it('xếp cả sách', async () => {
    const added = await useQueueStore.getState().enqueueBook('book-1');

    expect(added).toBe(10);
    expect(fake.api.queue.enqueueBook).toHaveBeenCalledWith('book-1');
  });
});

describe('prefetchChapter', () => {
  it('xếp chương kế với priority prefetch', async () => {
    await useQueueStore.getState().prefetchChapter('chap-2');

    expect(fake.api.queue.enqueueChapter).toHaveBeenCalledWith({
      chapterId: 'chap-2',
      priority: JOB_PRIORITY_PREFETCH,
    });
  });

  it('gọi lại cùng chương KHÔNG xếp lần thứ hai', async () => {
    // Cuộn qua lại quanh mốc 80% sẽ gọi hàm này liên tục
    await useQueueStore.getState().prefetchChapter('chap-2');
    await useQueueStore.getState().prefetchChapter('chap-2');
    await useQueueStore.getState().prefetchChapter('chap-2');

    expect(fake.api.queue.enqueueChapter).toHaveBeenCalledTimes(1);
  });

  it('hai lời gọi chồng nhau cũng chỉ xếp một lần', async () => {
    // `await` cho phép lượt thứ hai chen vào giữa nếu không ghi dấu trước khi gọi
    await Promise.all([
      useQueueStore.getState().prefetchChapter('chap-2'),
      useQueueStore.getState().prefetchChapter('chap-2'),
    ]);

    expect(fake.api.queue.enqueueChapter).toHaveBeenCalledTimes(1);
  });

  it('chương khác vẫn prefetch được', async () => {
    await useQueueStore.getState().prefetchChapter('chap-2');
    await useQueueStore.getState().prefetchChapter('chap-3');

    expect(fake.api.queue.enqueueChapter).toHaveBeenCalledTimes(2);
  });

  it('prefetch hỏng thì bỏ dấu để lần sau thử lại', async () => {
    // Việc chạy ngầm user không yêu cầu — một lần lỗi không đáng chặn vĩnh viễn
    fake.api.queue.enqueueChapter.mockResolvedValueOnce(err('UNKNOWN', 'lỗi tạm'));

    await useQueueStore.getState().prefetchChapter('chap-2');
    expect(useQueueStore.getState().prefetched).not.toContain('chap-2');

    await useQueueStore.getState().prefetchChapter('chap-2');
    expect(fake.api.queue.enqueueChapter).toHaveBeenCalledTimes(2);
  });

  it('IPC reject cũng bỏ dấu', async () => {
    fake.api.queue.enqueueChapter.mockRejectedValueOnce(new Error('main chết'));

    await useQueueStore.getState().prefetchChapter('chap-2');

    expect(useQueueStore.getState().prefetched).not.toContain('chap-2');
  });
});

describe('estimate', () => {
  it('trả ước lượng cho chương', async () => {
    const estimate = await useQueueStore.getState().estimateChapter('chap-1');

    expect(estimate?.segmentCount).toBe(3);
  });

  it('hỏng thì trả null để UI không mở hộp rỗng', async () => {
    fake.api.queue.estimateBook.mockResolvedValueOnce(err('NOT_FOUND', 'Không có sách.'));

    const estimate = await useQueueStore.getState().estimateBook('book-1');

    expect(estimate).toBeNull();
    expect(useQueueStore.getState().error).toContain('Không có sách');
  });

  it('IPC reject trả null, không throw ra component', async () => {
    fake.api.queue.estimateBook.mockRejectedValueOnce(new Error('main chết'));

    await expect(useQueueStore.getState().estimateBook('book-1')).resolves.toBeNull();
  });
});

describe('pause / resume / cancel', () => {
  it('tạm dừng ghi ngay trạng thái trả về', async () => {
    await useQueueStore.getState().pause();

    expect(useQueueStore.getState().status?.state).toBe('paused');
  });

  it('tiếp tục đổi lại thành running', async () => {
    await useQueueStore.getState().pause();
    await useQueueStore.getState().resume();

    expect(useQueueStore.getState().status?.state).toBe('running');
  });

  it('huỷ hết rồi nạp lại trạng thái', async () => {
    fake.emitQueueStatus({
      state: 'running',
      queued: 5,
      running: 1,
      done: 0,
      error: 0,
      cancelled: 0,
    });

    await useQueueStore.getState().cancelAll();

    const status = useQueueStore.getState().status;
    expect(status?.queued).toBe(0);
    expect(status?.running).toBe(0);
  });

  it('huỷ theo sách', async () => {
    await useQueueStore.getState().cancelBook('book-1');

    expect(fake.api.queue.cancelBook).toHaveBeenCalledWith('book-1');
  });

  it('lỗi khi tạm dừng vẫn hiện ra', async () => {
    fake.api.queue.pause.mockResolvedValueOnce(err('UNKNOWN', 'không dừng được'));

    await useQueueStore.getState().pause();

    expect(useQueueStore.getState().error).toContain('không dừng được');
  });
});

describe('clearError', () => {
  it('đóng thông báo lỗi', async () => {
    fake.api.queue.getStatus.mockResolvedValueOnce(err('UNKNOWN', 'lỗi'));
    await useQueueStore.getState().loadStatus();

    useQueueStore.getState().clearError();

    expect(useQueueStore.getState().error).toBeNull();
  });

  it('lượt gọi thành công tự xoá lỗi cũ', async () => {
    fake.api.queue.getStatus.mockResolvedValueOnce(err('UNKNOWN', 'lỗi'));
    await useQueueStore.getState().loadStatus();

    await useQueueStore.getState().loadStatus();

    expect(useQueueStore.getState().error).toBeNull();
  });
});

describe('pendingCountOf / isBusyOf', () => {
  it('chưa nạp thì coi như rỗi', () => {
    expect(pendingCountOf(null)).toBe(0);
    expect(isBusyOf(null)).toBe(false);
  });

  it('cộng cả job đang chạy lẫn đang chờ', () => {
    const status = {
      state: 'running' as const,
      queued: 4,
      running: 1,
      done: 9,
      error: 0,
      cancelled: 0,
    };

    expect(pendingCountOf(status)).toBe(5);
    expect(isBusyOf(status)).toBe(true);
  });

  it('xong hết rồi thì không còn busy', () => {
    const status = {
      state: 'idle' as const,
      queued: 0,
      running: 0,
      done: 9,
      error: 1,
      cancelled: 0,
    };

    expect(isBusyOf(status)).toBe(false);
  });
});

describe('loadPending (P5.4)', () => {
  it('nạp danh sách job và đánh dấu đã hỏi', async () => {
    const job = {
      id: 'job-1',
      type: 'synthesize' as const,
      segmentId: 'seg-1',
      priority: 0,
      status: 'queued' as const,
      attempts: 0,
      createdAt: 1000,
    };
    fake.api.queue.listPending.mockResolvedValueOnce({ ok: true, data: [job] });

    await useQueueStore.getState().loadPending();

    expect(useQueueStore.getState().pending).toEqual([job]);
    expect(useQueueStore.getState().pendingLoaded).toBe(true);
  });

  it('hàng đợi rỗng vẫn đánh dấu đã hỏi — phân biệt với "chưa nạp"', async () => {
    fake.api.queue.listPending.mockResolvedValueOnce({ ok: true, data: [] });

    await useQueueStore.getState().loadPending();

    expect(useQueueStore.getState().pendingLoaded).toBe(true);
  });

  it('IPC reject không làm sập store', async () => {
    fake.api.queue.listPending.mockRejectedValueOnce(new Error('No handler'));

    await useQueueStore.getState().loadPending();

    expect(useQueueStore.getState().error).toContain('Không kết nối được');
    expect(useQueueStore.getState().pendingLoaded).toBe(false);
  });
});

describe('cancelJob (P5.4)', () => {
  it('huỷ rồi nạp lại danh sách', async () => {
    await useQueueStore.getState().cancelJob('job-1');

    expect(fake.api.queue.cancelJob).toHaveBeenCalledWith('job-1');
    expect(fake.api.queue.listPending).toHaveBeenCalledTimes(1);
  });

  it('job đã xong: GIỮ lỗi dù lượt nạp lại thành công', async () => {
    // Lượt nạp lại thành công không có nghĩa việc user yêu cầu đã thành công.
    // Xoá lỗi ở đó thì thông báo biến mất trước khi user kịp đọc.
    fake.api.queue.cancelJob.mockResolvedValueOnce(err('NOT_FOUND', 'Job này đã xong'));

    await useQueueStore.getState().cancelJob('job-1');

    expect(useQueueStore.getState().error).toBe('Job này đã xong');
    expect(fake.api.queue.listPending).toHaveBeenCalledTimes(1);
  });

  it('huỷ thành công thì xoá lỗi cũ', async () => {
    useQueueStore.setState({ error: 'lỗi từ lượt trước' });

    await useQueueStore.getState().cancelJob('job-1');

    expect(useQueueStore.getState().error).toBeNull();
  });
});
