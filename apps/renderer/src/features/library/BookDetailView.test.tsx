import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BookDetail, Chapter } from '@ln/shared';
import { fakeBook, installFakeApi } from '@/test/fake-api';
import { useQueueStore } from '@/stores/queue-store';
import { useSettingsStore } from '@/stores/settings-store';
import { BookDetailView } from './BookDetailView';

// Từ P2.6 màn này gọi `queue:*` để hiện nút tạo audio — cần `window.api` thật giả
beforeEach(() => {
  installFakeApi();
  useQueueStore.setState({ status: null, error: null, prefetched: [] });
  useSettingsStore.setState({ settings: null, error: null, loading: false });
});

const chapter = (index: number, overrides: Partial<Chapter> = {}): Chapter => ({
  id: `c${index + 1}`,
  bookId: 'book-1',
  index,
  title: `Chương ${index + 1}`,
  pageStart: index * 10 + 1,
  pageEnd: (index + 1) * 10,
  segmentCount: 100,
  audioBytes: 0,
  generateStatus: 'none',
  ...overrides,
});

const detail = (overrides: Partial<BookDetail> = {}): BookDetail => ({
  book: fakeBook(),
  chapters: [chapter(0), chapter(1), chapter(2)],
  ...overrides,
});

const items = (): HTMLElement[] => screen.queryAllByTestId('chapter-item');

/**
 * Render rồi chờ effect nạp trạng thái hàng đợi xong.
 *
 * Từ P2.6 màn này gọi `queue:getStatus` trong `useEffect`, nên state đổi **sau**
 * lượt render đồng bộ. Không bọc `act` thì React cảnh báo ở mọi phép thử, và
 * tiếng ồn đó che mất cảnh báo thật.
 */
const renderView = async (ui: Parameters<typeof render>[0]): Promise<void> => {
  await act(async () => {
    render(ui);
  });
};

describe('hiển thị', () => {
  it('hiện tên sách và tổng số liệu', async () => {
    await renderView(<BookDetailView detail={detail()} onBack={vi.fn()} />);

    expect(screen.getByText('Kiếm Vực Thần Đế')).toBeInTheDocument();
    expect(screen.getByText(/3 chương · 300 segment/)).toBeInTheDocument();
  });

  it('liệt kê chương theo thứ tự', async () => {
    await renderView(<BookDetailView detail={detail()} onBack={vi.fn()} />);

    expect(items()).toHaveLength(3);
    expect(within(items()[0]!).getByText('Chương 1')).toBeInTheDocument();
  });

  it('PDF hiện "Trang X–Y"', async () => {
    await renderView(<BookDetailView detail={detail()} onBack={vi.fn()} />);
    expect(within(items()[0]!).getByText(/Trang 1–10/)).toBeInTheDocument();
  });

  it('DOCX hiện "Đoạn" chứ không phải "Trang"', async () => {
    await renderView(
      <BookDetailView
        detail={detail({ book: fakeBook({ format: 'docx' }) })}
        onBack={vi.fn()}
      />,
    );

    expect(within(items()[0]!).getByText(/Đoạn 1–10/)).toBeInTheDocument();
    expect(within(items()[0]!).queryByText(/Trang 1–10/)).toBeNull();
  });

  it('chương không có khoảng trang vẫn hiện được', async () => {
    const noPages = chapter(0);
    delete noPages.pageStart;
    delete noPages.pageEnd;

    await renderView(<BookDetailView detail={detail({ chapters: [noPages] })} onBack={vi.fn()} />);
    expect(within(items()[0]!).getByText(/100 segment/)).toBeInTheDocument();
  });

  it('sách chưa có chương nào không làm vỡ giao diện', async () => {
    await renderView(<BookDetailView detail={detail({ chapters: [] })} onBack={vi.fn()} />);

    expect(items()).toHaveLength(0);
    expect(screen.getByText(/chưa có chương nào/)).toBeInTheDocument();
  });
});

describe('resume', () => {
  it('đánh dấu chương đang đọc dở', async () => {
    await renderView(<BookDetailView detail={detail({ resumeChapterId: 'c2' })} onBack={vi.fn()} />);

    expect(items()[1]?.dataset['resume']).toBe('true');
    expect(within(items()[1]!).getByText('Đang đọc')).toBeInTheDocument();
  });

  it('chưa đọc lần nào thì không chương nào được đánh dấu', async () => {
    await renderView(<BookDetailView detail={detail()} onBack={vi.fn()} />);

    expect(items().every((i) => i.dataset['resume'] === 'false')).toBe(true);
    expect(screen.queryByText('Đang đọc')).toBeNull();
  });
});

describe('mở trình đọc', () => {
  it('bấm một chương mở đúng chương đó', async () => {
    const user = userEvent.setup();
    const onRead = vi.fn();
    await renderView(<BookDetailView detail={detail()} onBack={vi.fn()} onRead={onRead} />);

    await user.click(screen.getByRole('button', { name: 'Đọc Chương 2' }));
    expect(onRead).toHaveBeenCalledWith('c2');
  });

  it('nút đọc ở đầu màn không chỉ định chương — để trình đọc tự chọn chỗ dở', async () => {
    const user = userEvent.setup();
    const onRead = vi.fn();
    await renderView(
      <BookDetailView detail={detail({ resumeChapterId: 'c2' })} onBack={vi.fn()} onRead={onRead} />,
    );

    await user.click(screen.getByRole('button', { name: 'Đọc tiếp' }));
    expect(onRead).toHaveBeenCalledWith();
  });

  it('sách chưa từng đọc thì nút ghi "Đọc"', async () => {
    await renderView(<BookDetailView detail={detail()} onBack={vi.fn()} onRead={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Đọc' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Đọc tiếp' })).toBeNull();
  });

  it('sách không có chương thì không hiện nút đọc', async () => {
    await renderView(
      <BookDetailView detail={detail({ chapters: [] })} onBack={vi.fn()} onRead={vi.fn()} />,
    );
    expect(screen.queryByRole('button', { name: /^Đọc/ })).toBeNull();
  });
});

describe('quay lại', () => {
  it('bấm nút quay lại gọi onBack', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    await renderView(<BookDetailView detail={detail()} onBack={onBack} />);

    await user.click(screen.getByRole('button', { name: /Thư viện/ }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe('tạo audio (P2.6)', () => {
  it('hiện nút tạo audio cả sách', async () => {
    await renderView(<BookDetailView detail={detail()} onBack={vi.fn()} />);

    expect(screen.getByTestId('generate-book')).toBeInTheDocument();
  });

  it('KHÔNG hiện nút tạo theo chương — màn này không mở chương nào', async () => {
    await renderView(<BookDetailView detail={detail()} onBack={vi.fn()} />);

    expect(screen.queryByTestId('generate-chapter')).not.toBeInTheDocument();
  });

  it('sách không có chương thì không hiện nút tạo audio', async () => {
    await renderView(<BookDetailView detail={detail({ chapters: [] })} onBack={vi.fn()} />);

    expect(screen.queryByTestId('generate-book')).not.toBeInTheDocument();
  });

  it('hiện dung lượng audio đã có của cả sách', async () => {
    await renderView(
      <BookDetailView
        detail={detail({
          chapters: [chapter(0, { audioBytes: 1024 * 600 }), chapter(1, { audioBytes: 1024 * 400 })],
        })}
        onBack={vi.fn()}
      />,
    );

    // 600 KB + 400 KB = 1000 KB
    expect(screen.getByText(/1000 KB audio/)).toBeInTheDocument();
  });

  it('chưa generate gì thì không hiện dòng dung lượng', async () => {
    await renderView(<BookDetailView detail={detail()} onBack={vi.fn()} />);

    expect(screen.queryByText(/audio$/)).not.toBeInTheDocument();
  });

  it('đánh dấu chương đã có đủ audio', async () => {
    await renderView(
      <BookDetailView
        detail={detail({
          chapters: [
            chapter(0, { generateStatus: 'complete' }),
            chapter(1, { generateStatus: 'partial' }),
            chapter(2),
          ],
        })}
        onBack={vi.fn()}
      />,
    );

    const badges = screen.getAllByTestId('chapter-generate-status');
    expect(badges).toHaveLength(2);
    expect(badges[0]).toHaveTextContent('Đủ audio');
    expect(badges[1]).toHaveTextContent('Một phần');
  });
});
