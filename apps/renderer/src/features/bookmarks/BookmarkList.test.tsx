import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBookmark, installFakeApi } from '@/test/fake-api';
import { useBookmarkStore } from '@/stores/bookmark-store';
import { BookmarkList } from './BookmarkList';
import { ReadingStatsPanel } from './ReadingStatsPanel';

/** Danh sách dấu trang + khối thống kê (P5.4). */

const load = async (options: Parameters<typeof installFakeApi>[0] = {}) => {
  installFakeApi(options);
  useBookmarkStore.setState({
    entries: [],
    stats: null,
    bookId: null,
    loading: false,
    error: null,
  });
  await act(async () => {
    await useBookmarkStore.getState().load('book-1');
  });
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('BookmarkList', () => {
  it('chưa có dấu trang nào thì chỉ đường cho user', async () => {
    await load();
    render(<BookmarkList onSelect={vi.fn()} />);

    expect(screen.getByTestId('bookmark-empty')).toHaveTextContent('Đánh dấu');
  });

  it('hiện chương, ghi chú và trích đoạn', async () => {
    await load({ bookmarks: [fakeBookmark()] });
    render(<BookmarkList onSelect={vi.fn()} />);

    const item = screen.getByTestId('bookmark-item');
    expect(item).toHaveTextContent('Chương 1');
    expect(item).toHaveTextContent('Chỗ đáng nhớ');
    expect(item).toHaveTextContent('Câu thứ 1 của đoạn văn.');
  });

  it('dấu trang không ghi chú vẫn hiện được', async () => {
    const bare = fakeBookmark();
    const { note: _dropped, ...rest } = bare.bookmark;
    await load({ bookmarks: [{ ...bare, bookmark: rest }] });
    render(<BookmarkList onSelect={vi.fn()} />);

    expect(screen.getByTestId('bookmark-item')).toHaveTextContent('Câu thứ 1');
  });

  it('bấm một hàng trả cả segmentId lẫn chỉ số chương', async () => {
    // Nơi gọi cần `chapterIndex` để biết có phải đổi chương trước không
    await load({ bookmarks: [fakeBookmark({ chapterIndex: 2 })] });
    const onSelect = vi.fn();
    render(<BookmarkList onSelect={onSelect} />);

    await userEvent.click(screen.getByTestId('bookmark-item'));

    expect(onSelect).toHaveBeenCalledWith('book-1-c1-s1', 2);
  });

  it('hiện đủ mọi dấu trang', async () => {
    await load({
      bookmarks: [
        fakeBookmark(),
        fakeBookmark({ bookmark: { id: 'bm-2', bookId: 'book-1', segmentId: 's2', createdAt: 2 } }),
      ],
    });
    render(<BookmarkList onSelect={vi.fn()} />);

    expect(screen.getAllByTestId('bookmark-item')).toHaveLength(2);
  });
});

describe('ReadingStatsPanel', () => {
  it('ẩn hẳn khi chưa nạp được thống kê', () => {
    // "Chưa biết" và "bằng 0" phải trông khác nhau
    useBookmarkStore.setState({ stats: null });
    const { container } = render(<ReadingStatsPanel />);

    expect(container).toBeEmptyDOMElement();
  });

  it('hiện phần trăm đọc và vị trí', async () => {
    await load();
    render(<ReadingStatsPanel />);

    const panel = screen.getByTestId('reading-stats');
    // 45/120 đoạn = 38%
    expect(panel).toHaveTextContent('38%');
    expect(panel).toHaveTextContent('Chương 2 · đoạn 46/120');
  });

  it('hai thanh riêng cho tiến độ đọc và tiến độ generate', async () => {
    await load();
    render(<ReadingStatsPanel />);

    expect(screen.getByTestId('reading-progress-bar')).toHaveStyle({ width: '38%' });
    // 60/120 đoạn có audio = 50%, lệch hẳn với tiến độ đọc
    expect(screen.getByTestId('audio-progress-bar')).toHaveStyle({ width: '50%' });
  });

  it('sách chưa generate gì thì không hiện dòng thời lượng/dung lượng', async () => {
    await load({ stats: { segmentsWithAudio: 0, audioDurationMs: 0, audioBytes: 0 } });
    render(<ReadingStatsPanel />);

    expect(screen.getByTestId('reading-stats')).not.toHaveTextContent('0 B');
  });

  it('có audio rồi thì hiện thời lượng và dung lượng', async () => {
    await load();
    render(<ReadingStatsPanel />);

    // 600000 ms → 10:00, 1800000 B → 1.7 MB
    expect(screen.getByTestId('reading-stats')).toHaveTextContent('10:00 · 1.7 MB');
  });
});
