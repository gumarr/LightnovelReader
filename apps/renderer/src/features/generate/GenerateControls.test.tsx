import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { err } from '@ln/shared';
import { installFakeApi, type FakeApi } from '@/test/fake-api';
import { useQueueStore } from '@/stores/queue-store';
import { useSettingsStore } from '@/stores/settings-store';
import { GenerateControls } from './GenerateControls';

/**
 * Test nút tạo audio.
 *
 * Trọng tâm: **không lượt generate nào chạy mà chưa qua hộp ước lượng** (ràng
 * buộc CLAUDE.md), và nút bị chặn khi chưa chọn giọng đọc.
 */

let fake: FakeApi;

beforeEach(async () => {
  fake = installFakeApi({ settings: { voiceVi: 'vi_VN-vais1000-medium' } });
  useQueueStore.setState({ status: null, error: null, prefetched: [] });
  useSettingsStore.setState({ settings: null, error: null, loading: false });
  await useSettingsStore.getState().load();
});

const setup = (props: Partial<Parameters<typeof GenerateControls>[0]> = {}) =>
  render(
    <GenerateControls
      bookId="book-1"
      bookTitle="Kiếm Vực Thần Đế"
      chapterId="chap-1"
      chapterTitle="Chương Một"
      voiceReady
      {...props}
    />,
  );

describe('cửa xác nhận ước lượng', () => {
  it('bấm tạo chương KHÔNG xếp hàng ngay — phải qua hộp ước lượng', async () => {
    setup();

    await userEvent.click(screen.getByTestId('generate-chapter'));

    expect(await screen.findByTestId('generate-estimate-dialog')).toBeInTheDocument();
    // Đây là ràng buộc chính: chưa xác nhận thì chưa xếp gì
    expect(fake.api.queue.enqueueChapter).not.toHaveBeenCalled();
  });

  it('bấm tạo cả sách cũng phải qua hộp ước lượng', async () => {
    setup();

    await userEvent.click(screen.getByTestId('generate-book'));

    expect(await screen.findByTestId('generate-estimate-dialog')).toBeInTheDocument();
    expect(fake.api.queue.enqueueBook).not.toHaveBeenCalled();
  });

  it('xác nhận rồi mới xếp hàng đợi', async () => {
    setup();

    await userEvent.click(screen.getByTestId('generate-chapter'));
    await userEvent.click(await screen.findByRole('button', { name: 'Bắt đầu tạo' }));

    await waitFor(() => {
      expect(fake.api.queue.enqueueChapter).toHaveBeenCalledWith({ chapterId: 'chap-1' });
    });
  });

  it('xác nhận cả sách thì gọi enqueueBook, không phải enqueueChapter', async () => {
    setup();

    await userEvent.click(screen.getByTestId('generate-book'));
    await userEvent.click(await screen.findByRole('button', { name: 'Bắt đầu tạo' }));

    await waitFor(() => {
      expect(fake.api.queue.enqueueBook).toHaveBeenCalledWith('book-1');
    });
    expect(fake.api.queue.enqueueChapter).not.toHaveBeenCalled();
  });

  it('huỷ hộp thì không xếp gì và hộp đóng lại', async () => {
    setup();

    await userEvent.click(screen.getByTestId('generate-chapter'));
    await userEvent.click(await screen.findByRole('button', { name: 'Huỷ' }));

    expect(screen.queryByTestId('generate-estimate-dialog')).not.toBeInTheDocument();
    expect(fake.api.queue.enqueueChapter).not.toHaveBeenCalled();
  });

  it('ước lượng hỏng thì KHÔNG mở hộp rỗng', async () => {
    fake.api.queue.estimateChapter.mockResolvedValueOnce(err('NOT_FOUND', 'Không có chương.'));
    setup();

    await userEvent.click(screen.getByTestId('generate-chapter'));

    await waitFor(() => {
      expect(screen.getByTestId('generate-error')).toHaveTextContent('Không có chương');
    });
    expect(screen.queryByTestId('generate-estimate-dialog')).not.toBeInTheDocument();
  });
});

describe('chặn khi chưa chọn giọng đọc', () => {
  it('nút mờ và nói rõ lý do', () => {
    setup({ voiceReady: false });

    expect(screen.getByTestId('generate-chapter')).toBeDisabled();
    expect(screen.getByTestId('generate-book')).toBeDisabled();
    expect(screen.getByTestId('generate-no-voice')).toBeInTheDocument();
  });

  it('đã chọn giọng thì không còn cảnh báo', () => {
    setup({ voiceReady: true });

    expect(screen.queryByTestId('generate-no-voice')).not.toBeInTheDocument();
    expect(screen.getByTestId('generate-chapter')).toBeEnabled();
  });
});

describe('phạm vi hiện nút', () => {
  it('màn chi tiết sách (không có chương) chỉ hiện nút cả sách', () => {
    // `exactOptionalPropertyTypes`: field optional phải VẮNG MẶT, không phải
    // mang giá trị `undefined` — nên render trực tiếp thay vì qua `setup`.
    render(<GenerateControls bookId="book-1" bookTitle="Kiếm Vực Thần Đế" voiceReady />);

    expect(screen.queryByTestId('generate-chapter')).not.toBeInTheDocument();
    expect(screen.getByTestId('generate-book')).toBeInTheDocument();
  });
});

describe('thanh tiến độ', () => {
  it('rỗi thì không chiếm chỗ', () => {
    setup();

    expect(screen.queryByTestId('queue-progress')).not.toBeInTheDocument();
  });

  it('có việc thì hiện thanh tiến độ', () => {
    useQueueStore.setState({
      status: { state: 'running', queued: 4, running: 1, done: 2, error: 0, cancelled: 0 },
    });
    setup();

    expect(screen.getByTestId('queue-progress')).toBeInTheDocument();
    expect(screen.getByText(/còn 5 đoạn/)).toBeInTheDocument();
  });

  it('bấm tạm dừng gọi IPC', async () => {
    useQueueStore.setState({
      status: { state: 'running', queued: 4, running: 1, done: 0, error: 0, cancelled: 0 },
    });
    setup();

    await userEvent.click(screen.getByRole('button', { name: 'Tạm dừng' }));

    expect(fake.api.queue.pause).toHaveBeenCalled();
  });

  it('đang tạm dừng thì hiện nút tiếp tục', async () => {
    useQueueStore.setState({
      status: { state: 'paused', queued: 4, running: 0, done: 0, error: 0, cancelled: 0 },
    });
    setup();

    await userEvent.click(screen.getByRole('button', { name: 'Tiếp tục' }));

    expect(fake.api.queue.resume).toHaveBeenCalled();
  });

  it('bấm huỷ hết gọi IPC', async () => {
    useQueueStore.setState({
      status: { state: 'running', queued: 4, running: 1, done: 0, error: 0, cancelled: 0 },
    });
    setup();

    await userEvent.click(screen.getByRole('button', { name: 'Huỷ hết' }));

    expect(fake.api.queue.cancelAll).toHaveBeenCalled();
  });

  it('hiện số job lỗi để user biết có gì không xong', () => {
    useQueueStore.setState({
      status: { state: 'running', queued: 1, running: 0, done: 5, error: 3, cancelled: 0 },
    });
    setup();

    expect(screen.getByTestId('queue-error-count')).toHaveTextContent('3 lỗi');
  });
});
