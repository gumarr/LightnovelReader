import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { err } from '@ln/shared';
import { installFakeApi, fakeBook, fakeLibraryEntry, type FakeApi } from '@/test/fake-api';
import { useLibraryStore } from '@/stores/library-store';
import { LibraryGrid } from './LibraryGrid';

let fake: FakeApi;

const resetStore = (): void => {
  useLibraryStore.setState({ entries: [], opened: null, loading: false, error: null });
};

beforeEach(() => {
  vi.restoreAllMocks();
  resetStore();
});

const setup = async (
  library = [fakeLibraryEntry()],
): Promise<{ onImport: ReturnType<typeof vi.fn>; onOpen: ReturnType<typeof vi.fn> }> => {
  fake = installFakeApi({ library });
  const onImport = vi.fn();
  const onOpen = vi.fn();

  await act(async () => {
    render(<LibraryGrid onImport={onImport} onManageVoices={vi.fn()} onManageStorage={vi.fn()} onOpen={onOpen} />);
  });

  return { onImport, onOpen };
};

const cards = (): HTMLElement[] => screen.queryAllByTestId('book-card');

describe('hiển thị', () => {
  it('nạp thư viện khi mở màn', async () => {
    await setup();
    await waitFor(() => expect(fake.api.library.list).toHaveBeenCalledTimes(1));
  });

  it('hiện thẻ cho từng sách', async () => {
    await setup([
      fakeLibraryEntry(fakeBook({ id: 'a', title: 'Sách A' })),
      fakeLibraryEntry(fakeBook({ id: 'b', title: 'Sách B' })),
    ]);

    await waitFor(() => expect(cards()).toHaveLength(2));
    expect(screen.getByText('Sách A')).toBeInTheDocument();
  });

  it('hiện số chương trên thẻ', async () => {
    await setup([fakeLibraryEntry(fakeBook(), 10, 4817)]);

    await waitFor(() => expect(cards()).toHaveLength(1));
    expect(screen.getByText('10 chương')).toBeInTheDocument();
  });

  it('số segment nằm ở tooltip — thẻ 150px không đủ chỗ nhưng vẫn phải tra được', async () => {
    await setup([fakeLibraryEntry(fakeBook(), 10, 4817)]);

    await waitFor(() => expect(cards()).toHaveLength(1));
    expect(screen.getByRole('button', { name: /Mở Kiếm Vực/ })).toHaveAttribute(
      'title',
      expect.stringContaining('4817 segment'),
    );
  });

  it('hiện định dạng sách', async () => {
    await setup([fakeLibraryEntry(fakeBook({ format: 'docx' }))]);
    await waitFor(() => expect(screen.getByText('DOCX')).toBeInTheDocument());
  });

  it('sách chưa mở lần nào ghi "Chưa đọc"', async () => {
    await setup();
    await waitFor(() => expect(screen.getByText('Chưa đọc')).toBeInTheDocument());
  });

  it('thư viện rỗng hiện lời mời nhập sách', async () => {
    await setup([]);

    await waitFor(() => expect(screen.getByText(/Thư viện còn trống/)).toBeInTheDocument());
    expect(cards()).toHaveLength(0);
  });

  it('lỗi nạp thư viện hiện ra cho user', async () => {
    fake = installFakeApi({ library: [] });
    fake.api.library.list.mockResolvedValueOnce(err('DB_ERROR', 'Không đọc được DB'));

    await act(async () => {
      render(<LibraryGrid onImport={vi.fn()} onManageVoices={vi.fn()} onManageStorage={vi.fn()} onOpen={vi.fn()} />);
    });

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Không đọc được DB'));
  });
});

describe('đọc tiếp', () => {
  it('hiện nút đọc tiếp khi có sách từng mở', async () => {
    await setup([fakeLibraryEntry(fakeBook({ title: 'Đang đọc', lastOpenedAt: 5000 }))]);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Đọc tiếp: Đang đọc/ })).toBeInTheDocument(),
    );
  });

  it('không hiện nút đọc tiếp khi chưa mở sách nào', async () => {
    await setup();

    await waitFor(() => expect(cards()).toHaveLength(1));
    expect(screen.queryByRole('button', { name: /Đọc tiếp/ })).toBeNull();
  });

  it('bấm đọc tiếp mở đúng sách đó', async () => {
    const user = userEvent.setup();
    const { onOpen } = await setup([
      fakeLibraryEntry(fakeBook({ id: 'đang-đọc', lastOpenedAt: 5000 })),
    ]);

    await waitFor(() => expect(cards()).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: /Đọc tiếp/ }));

    expect(onOpen).toHaveBeenCalledWith('đang-đọc');
  });
});

describe('thao tác', () => {
  it('bấm thẻ sách gọi onOpen', async () => {
    const user = userEvent.setup();
    const { onOpen } = await setup();

    await waitFor(() => expect(cards()).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: /Mở Kiếm Vực Thần Đế/ }));

    expect(onOpen).toHaveBeenCalledWith('book-1');
  });

  it('bấm nhập sách gọi onImport', async () => {
    const user = userEvent.setup();
    const { onImport } = await setup();

    await waitFor(() => expect(cards()).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: 'Nhập sách' }));

    expect(onImport).toHaveBeenCalledTimes(1);
  });

  it('nhập sách từ màn trống cũng gọi onImport', async () => {
    const user = userEvent.setup();
    const { onImport } = await setup([]);

    await waitFor(() => expect(screen.getByText(/còn trống/)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Nhập sách đầu tiên' }));

    expect(onImport).toHaveBeenCalledTimes(1);
  });

  it('bấm xoá hỏi lại trước, CHƯA xoá gì', async () => {
    const user = userEvent.setup();
    await setup();

    await waitFor(() => expect(cards()).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: /Xoá Kiếm Vực Thần Đế/ }));

    // Xoá sách là mất cấu trúc chương đã sửa tay — không được xoá ngay
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(fake.api.library.removeBook).not.toHaveBeenCalled();
    expect(cards()).toHaveLength(1);
  });

  it('hộp thoại nói rõ mất gì và giữ lại gì', async () => {
    const user = userEvent.setup();
    await setup([fakeLibraryEntry(fakeBook(), 10, 4817)]);

    await waitFor(() => expect(cards()).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: /Xoá Kiếm Vực/ }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/10 chương/)).toBeInTheDocument();
    // Từ P2.7 lượt xoá này dọn cả bản copy trong thư viện và audio đã tạo, nên
    // hộp thoại phải nói đúng: chỉ file user tự chọn lúc nhập là còn.
    expect(within(dialog).getByText(/toàn bộ audio đã tạo/)).toBeInTheDocument();
    expect(within(dialog).getByText(/File gốc bạn chọn lúc nhập vẫn còn/)).toBeInTheDocument();
  });

  it('xác nhận thì mới xoá thật', async () => {
    const user = userEvent.setup();
    await setup();

    await waitFor(() => expect(cards()).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: /Xoá Kiếm Vực Thần Đế/ }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Xoá' }));

    await waitFor(() => expect(cards()).toHaveLength(0));
    expect(fake.api.library.removeBook).toHaveBeenCalledWith('book-1');
  });

  it('huỷ thì không xoá và đóng hộp thoại', async () => {
    const user = userEvent.setup();
    await setup();

    await waitFor(() => expect(cards()).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: /Xoá Kiếm Vực Thần Đế/ }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Huỷ' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fake.api.library.removeBook).not.toHaveBeenCalled();
    expect(cards()).toHaveLength(1);
  });

  it('mỗi thẻ có nút xoá riêng, không nhầm sách', async () => {
    const user = userEvent.setup();
    await setup([
      fakeLibraryEntry(fakeBook({ id: 'a', title: 'Sách A' })),
      fakeLibraryEntry(fakeBook({ id: 'b', title: 'Sách B' })),
    ]);

    await waitFor(() => expect(cards()).toHaveLength(2));
    await user.click(screen.getByRole('button', { name: 'Xoá Sách B' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Xoá' }));

    expect(fake.api.library.removeBook).toHaveBeenCalledWith('b');
    await waitFor(() => expect(within(cards()[0]!).getByText('Sách A')).toBeInTheDocument());
  });
});
