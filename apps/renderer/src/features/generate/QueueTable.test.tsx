import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { err, JOB_PRIORITY_URGENT, ok, type Job } from '@ln/shared';
import { installFakeApi, type FakeApi } from '@/test/fake-api';
import { useQueueStore } from '@/stores/queue-store';
import { QueueTable } from './QueueTable';

/**
 * Bảng hàng đợi (P5.4).
 *
 * `queue:listPending` + `queue:cancelJob` có từ P2.6 mà chưa ai gọi suốt ba
 * phase — đây là đường gọi đầu tiên.
 */

let fake: FakeApi;

const job = (overrides: Partial<Job> = {}): Job => ({
  id: 'job-1',
  type: 'synthesize',
  segmentId: 'seg-1',
  priority: 0,
  status: 'queued',
  attempts: 0,
  createdAt: 1000,
  ...overrides,
});

const renderTable = async (jobs: Job[] = []) => {
  fake = installFakeApi();
  fake.api.queue.listPending.mockResolvedValue(ok(jobs));
  useQueueStore.setState({ pending: [], pendingLoaded: false, error: null, status: null });

  const onClose = vi.fn();
  await act(async () => {
    render(<QueueTable onClose={onClose} />);
  });
  return { onClose };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('nạp danh sách', () => {
  it('gọi listPending đúng một lần khi mở', async () => {
    // Không hỏi vòng: danh sách tới 200 job và không có event nào đẩy nó xuống
    await renderTable([job()]);

    expect(fake.api.queue.listPending).toHaveBeenCalledTimes(1);
  });

  it('hiện từng job kèm trạng thái và mức ưu tiên', async () => {
    await renderTable([job({ status: 'running', priority: JOB_PRIORITY_URGENT })]);

    const row = screen.getByTestId('queue-job-row');
    expect(row).toHaveTextContent('Đang chạy');
    expect(row).toHaveTextContent('Sắp phát');
    expect(row).toHaveTextContent('seg-1');
  });

  it('hàng đợi rỗng nói rõ, không để bảng trống trơn', async () => {
    await renderTable([]);

    expect(screen.getByTestId('queue-table-empty')).toBeInTheDocument();
  });

  it('phân biệt "chưa nạp" với "rỗng"', async () => {
    // Cả hai đều cho `pending: []` — thiếu `pendingLoaded` thì bảng nói "không
    // có việc nào" ngay lúc còn đang tải.
    fake = installFakeApi();
    useQueueStore.setState({ pending: [], pendingLoaded: false, error: null, status: null });

    render(<QueueTable onClose={vi.fn()} />);
    expect(screen.queryByTestId('queue-table-empty')).toBeNull();

    await act(async () => {
      await useQueueStore.getState().loadPending();
    });
    expect(screen.getByTestId('queue-table-empty')).toBeInTheDocument();
  });

  it('hiện lỗi và số lần đã thử của job hỏng', async () => {
    await renderTable([job({ status: 'error', attempts: 3, errorMessage: 'Sidecar chết' })]);

    expect(screen.getByTestId('queue-job-row')).toHaveTextContent('đã thử 3 lần · Sidecar chết');
  });

  it('nút nạp lại gọi thêm một lượt', async () => {
    await renderTable([job()]);

    await act(async () => {
      await userEvent.click(screen.getByTestId('queue-table-refresh'));
    });

    expect(fake.api.queue.listPending).toHaveBeenCalledTimes(2);
  });
});

describe('huỷ một job', () => {
  it('gọi cancelJob với đúng id', async () => {
    await renderTable([job({ id: 'job-7' })]);

    await act(async () => {
      await userEvent.click(screen.getByTestId('queue-cancel-job-7'));
    });

    expect(fake.api.queue.cancelJob).toHaveBeenCalledWith('job-7');
  });

  it('nạp lại danh sách sau khi huỷ', async () => {
    await renderTable([job()]);

    await act(async () => {
      await userEvent.click(screen.getByTestId('queue-cancel-job-1'));
    });

    expect(fake.api.queue.listPending).toHaveBeenCalledTimes(2);
  });

  it('job vừa xong trước cú bấm: báo lỗi NHƯNG vẫn nạp lại', async () => {
    // Bảng đang hiện đã cũ — giữ nguyên nó là hiển thị sai
    await renderTable([job()]);
    fake.api.queue.cancelJob.mockResolvedValueOnce(err('NOT_FOUND', 'Job này đã xong'));

    await act(async () => {
      await userEvent.click(screen.getByTestId('queue-cancel-job-1'));
    });

    expect(screen.getByRole('alert')).toHaveTextContent('Job này đã xong');
    expect(fake.api.queue.listPending).toHaveBeenCalledTimes(2);
  });
});

describe('đóng bảng', () => {
  it('bấm Đóng gọi onClose', async () => {
    const { onClose } = await renderTable([]);

    await userEvent.click(screen.getByTestId('queue-table-close'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
