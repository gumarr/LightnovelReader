import { beforeEach, describe, expect, it, vi } from 'vitest';
import { err } from '@ln/shared';
import {
  installFakeApi,
  fakeBook,
  fakeLibraryEntry,
  type FakeApi,
} from '@/test/fake-api';
import { mostRecentlyRead, useLibraryStore } from './library-store';

let fake: FakeApi;

const resetStore = (): void => {
  useLibraryStore.setState({ entries: [], opened: null, loading: false, error: null });
};

beforeEach(() => {
  vi.restoreAllMocks();
  fake = installFakeApi({ library: [fakeLibraryEntry()] });
  resetStore();
});

describe('load', () => {
  it('nạp danh sách sách từ main', async () => {
    await useLibraryStore.getState().load();

    const state = useLibraryStore.getState();
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0]?.book.title).toBe('Kiếm Vực Thần Đế');
    expect(state.loading).toBe(false);
  });

  it('thư viện rỗng không phải lỗi', async () => {
    fake = installFakeApi({ library: [] });
    await useLibraryStore.getState().load();

    const state = useLibraryStore.getState();
    expect(state.entries).toEqual([]);
    expect(state.error).toBeNull();
  });

  it('lỗi từ main hiện ra và tắt loading', async () => {
    fake.api.library.list.mockResolvedValueOnce(err('DB_ERROR', 'Không đọc được DB'));
    await useLibraryStore.getState().load();

    const state = useLibraryStore.getState();
    expect(state.error).toBe('Không đọc được DB');
    expect(state.loading).toBe(false);
  });

  it('IPC reject không làm kẹt ở "đang tải"', async () => {
    fake.api.library.list.mockRejectedValueOnce(new Error('main chết'));
    await useLibraryStore.getState().load();

    const state = useLibraryStore.getState();
    expect(state.loading).toBe(false);
    expect(state.error).toContain('Không kết nối được');
  });
});

describe('open', () => {
  it('mở sách và giữ danh sách chương', async () => {
    await useLibraryStore.getState().open('book-1');

    const opened = useLibraryStore.getState().opened;
    expect(opened?.book.id).toBe('book-1');
    expect(opened?.chapters).toHaveLength(3);
  });

  it('sách không tồn tại hiện lỗi, không mở', async () => {
    await useLibraryStore.getState().open('không-có');

    const state = useLibraryStore.getState();
    expect(state.opened).toBeNull();
    expect(state.error).toContain('Không tìm thấy sách');
  });

  it('close quay lại thư viện', async () => {
    await useLibraryStore.getState().open('book-1');
    useLibraryStore.getState().close();

    expect(useLibraryStore.getState().opened).toBeNull();
  });

  it('IPC reject không làm kẹt loading', async () => {
    fake.api.library.openBook.mockRejectedValueOnce(new Error('main chết'));
    await useLibraryStore.getState().open('book-1');

    expect(useLibraryStore.getState().loading).toBe(false);
  });
});

describe('remove', () => {
  it('bỏ sách khỏi danh sách mà không gọi lại list()', async () => {
    await useLibraryStore.getState().load();
    fake.api.library.list.mockClear();

    await useLibraryStore.getState().remove('book-1');

    expect(useLibraryStore.getState().entries).toEqual([]);
    expect(fake.api.library.list).not.toHaveBeenCalled();
  });

  it('đóng màn chi tiết nếu đang mở đúng sách bị xoá', async () => {
    await useLibraryStore.getState().load();
    await useLibraryStore.getState().open('book-1');

    await useLibraryStore.getState().remove('book-1');

    expect(useLibraryStore.getState().opened).toBeNull();
  });

  it('giữ nguyên màn chi tiết khi xoá sách khác', async () => {
    useLibraryStore.setState({
      entries: [fakeLibraryEntry(), fakeLibraryEntry(fakeBook({ id: 'book-2' }))],
    });
    await useLibraryStore.getState().open('book-1');

    await useLibraryStore.getState().remove('book-2');

    expect(useLibraryStore.getState().opened?.book.id).toBe('book-1');
  });

  it('lỗi từ main giữ nguyên danh sách', async () => {
    await useLibraryStore.getState().load();
    fake.api.library.removeBook.mockResolvedValueOnce(err('NOT_FOUND', 'Không tìm thấy sách'));

    await useLibraryStore.getState().remove('book-1');

    expect(useLibraryStore.getState().entries).toHaveLength(1);
    expect(useLibraryStore.getState().error).toBe('Không tìm thấy sách');
  });
});

describe('saveProgress', () => {
  it('gửi bookId và segmentId xuống main', async () => {
    await useLibraryStore.getState().saveProgress('book-1', 'seg-42');

    expect(fake.api.library.setProgress).toHaveBeenCalledWith({
      bookId: 'book-1',
      segmentId: 'seg-42',
    });
  });

  it('lỗi ghi tiến độ không ném — không được chặn user đọc tiếp', async () => {
    fake.api.library.setProgress.mockRejectedValueOnce(new Error('main chết'));

    await expect(
      useLibraryStore.getState().saveProgress('book-1', 'seg-42'),
    ).resolves.toBeUndefined();
    expect(useLibraryStore.getState().error).toContain('Không kết nối được');
  });
});

describe('mostRecentlyRead', () => {
  it('lấy sách đã mở đầu tiên trong danh sách (list đã sắp sẵn)', () => {
    const entries = [
      fakeLibraryEntry(fakeBook({ id: 'chưa-đọc' })),
      fakeLibraryEntry(fakeBook({ id: 'đã-đọc', lastOpenedAt: 5000 })),
    ];

    expect(mostRecentlyRead(entries)?.book.id).toBe('đã-đọc');
  });

  it('không có sách nào từng mở thì trả undefined', () => {
    expect(mostRecentlyRead([fakeLibraryEntry()])).toBeUndefined();
  });

  it('thư viện rỗng trả undefined', () => {
    expect(mostRecentlyRead([])).toBeUndefined();
  });
});
