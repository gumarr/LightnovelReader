import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BookDetail, Chapter } from '@ln/shared';
import { fakeBook } from '@/test/fake-api';
import { BookDetailView } from './BookDetailView';

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

/** Alias cho những phép thử không quan tâm tới việc mở trình đọc */
const renderView = render;

describe('hiển thị', () => {
  it('hiện tên sách và tổng số liệu', () => {
    renderView(<BookDetailView detail={detail()} onBack={vi.fn()} />);

    expect(screen.getByText('Kiếm Vực Thần Đế')).toBeInTheDocument();
    expect(screen.getByText(/3 chương · 300 segment/)).toBeInTheDocument();
  });

  it('liệt kê chương theo thứ tự', () => {
    renderView(<BookDetailView detail={detail()} onBack={vi.fn()} />);

    expect(items()).toHaveLength(3);
    expect(within(items()[0]!).getByText('Chương 1')).toBeInTheDocument();
  });

  it('PDF hiện "Trang X–Y"', () => {
    renderView(<BookDetailView detail={detail()} onBack={vi.fn()} />);
    expect(within(items()[0]!).getByText(/Trang 1–10/)).toBeInTheDocument();
  });

  it('DOCX hiện "Đoạn" chứ không phải "Trang"', () => {
    renderView(
      <BookDetailView
        detail={detail({ book: fakeBook({ format: 'docx' }) })}
        onBack={vi.fn()}
      />,
    );

    expect(within(items()[0]!).getByText(/Đoạn 1–10/)).toBeInTheDocument();
    expect(within(items()[0]!).queryByText(/Trang 1–10/)).toBeNull();
  });

  it('chương không có khoảng trang vẫn hiện được', () => {
    const noPages = chapter(0);
    delete noPages.pageStart;
    delete noPages.pageEnd;

    renderView(<BookDetailView detail={detail({ chapters: [noPages] })} onBack={vi.fn()} />);
    expect(within(items()[0]!).getByText(/100 segment/)).toBeInTheDocument();
  });

  it('sách chưa có chương nào không làm vỡ giao diện', () => {
    renderView(<BookDetailView detail={detail({ chapters: [] })} onBack={vi.fn()} />);

    expect(items()).toHaveLength(0);
    expect(screen.getByText(/chưa có chương nào/)).toBeInTheDocument();
  });
});

describe('resume', () => {
  it('đánh dấu chương đang đọc dở', () => {
    renderView(<BookDetailView detail={detail({ resumeChapterId: 'c2' })} onBack={vi.fn()} />);

    expect(items()[1]?.dataset['resume']).toBe('true');
    expect(within(items()[1]!).getByText('Đang đọc')).toBeInTheDocument();
  });

  it('chưa đọc lần nào thì không chương nào được đánh dấu', () => {
    renderView(<BookDetailView detail={detail()} onBack={vi.fn()} />);

    expect(items().every((i) => i.dataset['resume'] === 'false')).toBe(true);
    expect(screen.queryByText('Đang đọc')).toBeNull();
  });
});

describe('mở trình đọc', () => {
  it('bấm một chương mở đúng chương đó', async () => {
    const user = userEvent.setup();
    const onRead = vi.fn();
    render(<BookDetailView detail={detail()} onBack={vi.fn()} onRead={onRead} />);

    await user.click(screen.getByRole('button', { name: 'Đọc Chương 2' }));
    expect(onRead).toHaveBeenCalledWith('c2');
  });

  it('nút đọc ở đầu màn không chỉ định chương — để trình đọc tự chọn chỗ dở', async () => {
    const user = userEvent.setup();
    const onRead = vi.fn();
    render(
      <BookDetailView detail={detail({ resumeChapterId: 'c2' })} onBack={vi.fn()} onRead={onRead} />,
    );

    await user.click(screen.getByRole('button', { name: 'Đọc tiếp' }));
    expect(onRead).toHaveBeenCalledWith();
  });

  it('sách chưa từng đọc thì nút ghi "Đọc"', () => {
    render(<BookDetailView detail={detail()} onBack={vi.fn()} onRead={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Đọc' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Đọc tiếp' })).toBeNull();
  });

  it('sách không có chương thì không hiện nút đọc', () => {
    render(<BookDetailView detail={detail({ chapters: [] })} onBack={vi.fn()} onRead={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /^Đọc/ })).toBeNull();
  });
});

describe('quay lại', () => {
  it('bấm nút quay lại gọi onBack', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    renderView(<BookDetailView detail={detail()} onBack={onBack} />);

    await user.click(screen.getByRole('button', { name: /Thư viện/ }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
