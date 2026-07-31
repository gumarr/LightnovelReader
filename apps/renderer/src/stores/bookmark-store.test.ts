import { beforeEach, describe, expect, it, vi } from 'vitest';
import { err } from '@ln/shared';
import { fakeBookmark, installFakeApi, type FakeApi } from '@/test/fake-api';
import { bookmarkOfSegment, useBookmarkStore } from './bookmark-store';

/**
 * Store dấu trang + thống kê đọc (P5.4).
 *
 * Trọng tâm: nạp lại danh sách sau khi thêm (vì thứ tự là **mạch đọc**, không
 * phải thứ tự tạo), và thống kê luôn đi theo mọi thay đổi của danh sách.
 */

let fake: FakeApi;

const reset = (options: Parameters<typeof installFakeApi>[0] = {}): void => {
  fake = installFakeApi(options);
  useBookmarkStore.setState({
    entries: [],
    stats: null,
    bookId: null,
    loading: false,
    error: null,
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  reset();
});

describe('bookmarkOfSegment', () => {
  it('tìm được dấu trang của đoạn', () => {
    const entry = fakeBookmark();
    expect(bookmarkOfSegment([entry], 'book-1-c1-s1')).toBe(entry);
  });

  it('đoạn chưa đánh dấu trả undefined', () => {
    expect(bookmarkOfSegment([fakeBookmark()], 'đoạn-khác')).toBeUndefined();
  });

  it('chưa chọn đoạn nào thì không tra', () => {
    expect(bookmarkOfSegment([fakeBookmark()], null)).toBeUndefined();
  });
});

describe('load', () => {
  it('nạp cả danh sách lẫn thống kê trong một lượt', async () => {
    reset({ bookmarks: [fakeBookmark()] });

    await useBookmarkStore.getState().load('book-1');
    const state = useBookmarkStore.getState();

    expect(state.entries).toHaveLength(1);
    expect(state.stats?.bookId).toBe('book-1');
    expect(state.bookId).toBe('book-1');
    expect(state.loading).toBe(false);
  });

  it('thống kê hỏng KHÔNG làm hỏng danh sách dấu trang', () => {
    // Hai kênh độc lập: mất phần thống kê thì ẩn khối đó, chứ không đóng cả màn
    reset({ bookmarks: [fakeBookmark()] });
    fake.api.library.getStats.mockResolvedValueOnce(err('DB_ERROR', 'hỏng'));

    return useBookmarkStore
      .getState()
      .load('book-1')
      .then(() => {
        const state = useBookmarkStore.getState();
        expect(state.entries).toHaveLength(1);
        expect(state.stats).toBeNull();
        expect(state.error).toBeNull();
      });
  });

  it('danh sách hỏng thì báo lỗi và dừng loading', async () => {
    fake.api.bookmarks.list.mockResolvedValueOnce(err('DB_ERROR', 'Không mở được DB'));

    await useBookmarkStore.getState().load('book-1');
    const state = useBookmarkStore.getState();

    expect(state.error).toBe('Không mở được DB');
    expect(state.loading).toBe(false);
  });

  it('IPC reject vẫn thoát khỏi trạng thái đang tải', async () => {
    fake.api.bookmarks.list.mockRejectedValueOnce(new Error('No handler'));

    await useBookmarkStore.getState().load('book-1');
    const state = useBookmarkStore.getState();

    expect(state.loading).toBe(false);
    expect(state.error).toContain('Không kết nối được');
  });
});

describe('add', () => {
  it('thêm rồi nạp lại danh sách theo mạch đọc', async () => {
    await useBookmarkStore.getState().load('book-1');
    const okAdded = await useBookmarkStore.getState().add('book-1-c1-s2', 'ghi chú');

    expect(okAdded).toBe(true);
    // Nạp lại chứ không chèn tay: thứ tự do main quyết định
    expect(fake.api.bookmarks.list).toHaveBeenCalledTimes(2);
    expect(useBookmarkStore.getState().entries).toHaveLength(1);
  });

  it('nạp lại thống kê sau khi thêm — số dấu trang phải đổi theo', async () => {
    await useBookmarkStore.getState().load('book-1');
    fake.api.library.getStats.mockClear();

    await useBookmarkStore.getState().add('book-1-c1-s2');

    expect(fake.api.library.getStats).toHaveBeenCalledTimes(1);
  });

  it('không có ghi chú thì không gửi trường `note`', async () => {
    await useBookmarkStore.getState().load('book-1');
    await useBookmarkStore.getState().add('book-1-c1-s2');

    expect(fake.api.bookmarks.add).toHaveBeenCalledWith({
      bookId: 'book-1',
      segmentId: 'book-1-c1-s2',
    });
  });

  it('chưa mở sách thì từ chối, không gửi request chắc chắn hỏng', async () => {
    const okAdded = await useBookmarkStore.getState().add('seg-1');

    expect(okAdded).toBe(false);
    expect(fake.api.bookmarks.add).not.toHaveBeenCalled();
    expect(useBookmarkStore.getState().error).toContain('Chưa mở sách');
  });

  it('main từ chối thì báo lỗi và trả false', async () => {
    await useBookmarkStore.getState().load('book-1');
    fake.api.bookmarks.add.mockResolvedValueOnce(err('NOT_FOUND', 'Không tìm thấy đoạn'));

    const okAdded = await useBookmarkStore.getState().add('đoạn-ma');

    expect(okAdded).toBe(false);
    expect(useBookmarkStore.getState().error).toBe('Không tìm thấy đoạn');
  });
});

describe('updateNote', () => {
  it('sửa ghi chú tại chỗ, không nạp lại cả danh sách', async () => {
    reset({ bookmarks: [fakeBookmark()] });
    await useBookmarkStore.getState().load('book-1');
    fake.api.bookmarks.list.mockClear();

    const okUpdated = await useBookmarkStore.getState().updateNote('bm-1', 'ghi chú mới');

    expect(okUpdated).toBe(true);
    // Sửa ghi chú không đổi vị trí nên không cần lượt nạp thứ hai
    expect(fake.api.bookmarks.list).not.toHaveBeenCalled();
    expect(useBookmarkStore.getState().entries[0]?.bookmark.note).toBe('ghi chú mới');
  });

  it('xoá ghi chú bằng chuỗi rỗng', async () => {
    reset({ bookmarks: [fakeBookmark()] });
    await useBookmarkStore.getState().load('book-1');

    await useBookmarkStore.getState().updateNote('bm-1', '');

    expect(useBookmarkStore.getState().entries[0]?.bookmark).not.toHaveProperty('note');
  });

  it('dấu trang đã bị xoá thì báo lỗi', async () => {
    reset({ bookmarks: [fakeBookmark()] });
    await useBookmarkStore.getState().load('book-1');

    const okUpdated = await useBookmarkStore.getState().updateNote('không-có', 'x');

    expect(okUpdated).toBe(false);
    expect(useBookmarkStore.getState().error).toContain('đã bị xoá');
  });
});

describe('remove', () => {
  it('bỏ khỏi danh sách và nạp lại thống kê', async () => {
    reset({ bookmarks: [fakeBookmark()] });
    await useBookmarkStore.getState().load('book-1');
    fake.api.library.getStats.mockClear();

    await useBookmarkStore.getState().remove('bm-1');

    expect(useBookmarkStore.getState().entries).toHaveLength(0);
    expect(fake.api.library.getStats).toHaveBeenCalledTimes(1);
  });

  it('main từ chối thì giữ nguyên danh sách', async () => {
    reset({ bookmarks: [fakeBookmark()] });
    await useBookmarkStore.getState().load('book-1');
    fake.api.bookmarks.remove.mockResolvedValueOnce(err('DB_ERROR', 'Không xoá được'));

    await useBookmarkStore.getState().remove('bm-1');

    expect(useBookmarkStore.getState().entries).toHaveLength(1);
    expect(useBookmarkStore.getState().error).toBe('Không xoá được');
  });
});

describe('reset', () => {
  it('quên sạch sách cũ — dấu trang không lộ sang sách sau', async () => {
    reset({ bookmarks: [fakeBookmark()] });
    await useBookmarkStore.getState().load('book-1');

    useBookmarkStore.getState().reset();
    const state = useBookmarkStore.getState();

    expect(state.entries).toEqual([]);
    expect(state.stats).toBeNull();
    expect(state.bookId).toBeNull();
  });
});
