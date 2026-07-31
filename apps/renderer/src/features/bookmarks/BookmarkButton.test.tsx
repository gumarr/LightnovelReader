import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBookmark, installFakeApi, type FakeApi } from '@/test/fake-api';
import { useBookmarkStore } from '@/stores/bookmark-store';
import { BookmarkButton } from './BookmarkButton';

/**
 * Nút đánh dấu đoạn (P5.4).
 *
 * Trọng tâm: bấm khi đã có dấu thì **mở ô sửa** chứ không xoá ngay (xoá là thao
 * tác mất dữ liệu, không đáng nằm sau một cú bấm nhầm).
 */

let fake: FakeApi;

const renderButton = async (
  segmentId: string | null = 'book-1-c1-s1',
  options: Parameters<typeof installFakeApi>[0] = {},
) => {
  fake = installFakeApi(options);
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

  await act(async () => {
    render(<BookmarkButton segmentId={segmentId} />);
  });
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('hiển thị', () => {
  it('đoạn chưa đánh dấu hiện sao rỗng', async () => {
    await renderButton();

    const button = screen.getByTestId('bookmark-toggle');
    expect(button).toHaveTextContent('Đánh dấu');
    expect(button).toHaveAttribute('aria-pressed', 'false');
  });

  it('đoạn đã đánh dấu hiện sao đầy', async () => {
    await renderButton('book-1-c1-s1', { bookmarks: [fakeBookmark()] });

    const button = screen.getByTestId('bookmark-toggle');
    expect(button).toHaveTextContent('Đã đánh dấu');
    expect(button).toHaveAttribute('aria-pressed', 'true');
  });

  it('chưa chọn đoạn nào thì nút bị vô hiệu hoá', async () => {
    await renderButton(null);

    expect(screen.getByTestId('bookmark-toggle')).toBeDisabled();
  });

  it('ô ghi chú chỉ hiện sau khi bấm', async () => {
    await renderButton();

    expect(screen.queryByTestId('bookmark-editor')).toBeNull();
    await userEvent.click(screen.getByTestId('bookmark-toggle'));
    expect(screen.getByTestId('bookmark-editor')).toBeInTheDocument();
  });
});

describe('thêm dấu trang', () => {
  it('lưu kèm ghi chú', async () => {
    await renderButton();

    await userEvent.click(screen.getByTestId('bookmark-toggle'));
    await userEvent.type(screen.getByTestId('bookmark-note-input'), 'Chỗ hay');
    await act(async () => {
      await userEvent.click(screen.getByTestId('bookmark-save'));
    });

    expect(fake.api.bookmarks.add).toHaveBeenCalledWith({
      bookId: 'book-1',
      segmentId: 'book-1-c1-s1',
      note: 'Chỗ hay',
    });
  });

  it('lưu được khi để trống ghi chú — dấu trang trơn vẫn hợp lệ', async () => {
    await renderButton();

    await userEvent.click(screen.getByTestId('bookmark-toggle'));
    await act(async () => {
      await userEvent.click(screen.getByTestId('bookmark-save'));
    });

    expect(fake.api.bookmarks.add).toHaveBeenCalled();
  });

  it('đóng ô sau khi lưu xong', async () => {
    await renderButton();

    await userEvent.click(screen.getByTestId('bookmark-toggle'));
    await act(async () => {
      await userEvent.click(screen.getByTestId('bookmark-save'));
    });

    expect(screen.queryByTestId('bookmark-editor')).toBeNull();
  });

  it('không có nút xoá khi đoạn chưa từng được đánh dấu', async () => {
    await renderButton();
    await userEvent.click(screen.getByTestId('bookmark-toggle'));

    expect(screen.queryByTestId('bookmark-delete')).toBeNull();
  });
});

describe('sửa dấu trang đã có', () => {
  it('điền sẵn ghi chú cũ vào ô', async () => {
    // Mở ô rồi mới đi hỏi thì ô trống một nhịp, trông như mất dữ liệu
    await renderButton('book-1-c1-s1', { bookmarks: [fakeBookmark()] });

    await userEvent.click(screen.getByTestId('bookmark-toggle'));

    expect(screen.getByTestId('bookmark-note-input')).toHaveValue('Chỗ đáng nhớ');
  });

  it('bấm nút KHÔNG xoá ngay — chỉ mở ô sửa', async () => {
    await renderButton('book-1-c1-s1', { bookmarks: [fakeBookmark()] });

    await userEvent.click(screen.getByTestId('bookmark-toggle'));

    expect(fake.api.bookmarks.remove).not.toHaveBeenCalled();
    expect(screen.getByTestId('bookmark-editor')).toBeInTheDocument();
  });

  it('lưu ghi chú mới đi qua updateNote, không tạo dấu trang mới', async () => {
    await renderButton('book-1-c1-s1', { bookmarks: [fakeBookmark()] });

    await userEvent.click(screen.getByTestId('bookmark-toggle'));
    await userEvent.clear(screen.getByTestId('bookmark-note-input'));
    await userEvent.type(screen.getByTestId('bookmark-note-input'), 'Ghi chú mới');
    await act(async () => {
      await userEvent.click(screen.getByTestId('bookmark-save'));
    });

    expect(fake.api.bookmarks.updateNote).toHaveBeenCalledWith({
      id: 'bm-1',
      note: 'Ghi chú mới',
    });
    expect(fake.api.bookmarks.add).not.toHaveBeenCalled();
  });

  it('xoá được từ trong ô sửa', async () => {
    await renderButton('book-1-c1-s1', { bookmarks: [fakeBookmark()] });

    await userEvent.click(screen.getByTestId('bookmark-toggle'));
    await act(async () => {
      await userEvent.click(screen.getByTestId('bookmark-delete'));
    });

    expect(fake.api.bookmarks.remove).toHaveBeenCalledWith('bm-1');
    expect(screen.queryByTestId('bookmark-editor')).toBeNull();
  });

  it('bấm Huỷ đóng ô mà không lưu gì', async () => {
    await renderButton();

    await userEvent.click(screen.getByTestId('bookmark-toggle'));
    await userEvent.type(screen.getByTestId('bookmark-note-input'), 'bỏ đi');
    await userEvent.click(screen.getByRole('button', { name: 'Huỷ' }));

    expect(screen.queryByTestId('bookmark-editor')).toBeNull();
    expect(fake.api.bookmarks.add).not.toHaveBeenCalled();
  });
});
