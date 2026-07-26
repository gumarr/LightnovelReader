import { beforeEach, describe, expect, it } from 'vitest';
import { err } from '@ln/shared';
import type { ChapterUsageInfo } from '@ln/shared';
import { installFakeApi, fakeBook, fakeLibraryEntry, type FakeApi } from '@/test/fake-api';
import { hasOrphans, isOverWarnThreshold, totalBytesOf, useStorageStore } from './storage-store';

/**
 * Test store Storage Manager.
 *
 * Trọng tâm: mọi lời gọi IPC bắt được rejection (PROGRESS 4.3), lượt nạp lại sau
 * khi xoá **không** xoá mất thông báo lỗi, và cờ `deleting` luôn được hạ.
 */

let fake: FakeApi;

const chapters: ChapterUsageInfo[] = [
  {
    chapterId: 'book-1-c1',
    title: 'Chương 1',
    index: 0,
    segmentCount: 10,
    readySegments: 10,
    audioBytes: 40_000,
    errorCount: 0,
  },
  {
    chapterId: 'book-1-c2',
    title: 'Chương 2',
    index: 1,
    segmentCount: 10,
    readySegments: 0,
    audioBytes: 0,
    errorCount: 0,
  },
];

const reset = (): void => {
  useStorageStore.setState({
    usage: null,
    chapters: [],
    expandedBookId: null,
    loading: false,
    deleting: false,
    error: null,
    lastDeleted: null,
  });
};

const install = (): FakeApi =>
  installFakeApi({
    library: [fakeLibraryEntry(fakeBook())],
    usage: {
      audioBytes: 40_000,
            audioBytesOnDisk: 41_000,
      books: [
        {
          bookId: 'book-1',
          title: 'Kiếm Vực Thần Đế',
          bookFileBytes: 1000,
          audioBytes: 40_000,
          chapterCount: 2,
          completeChapters: 1,
        },
      ],
    },
    chapterUsage: chapters.map((c) => ({ ...c })),
  });

beforeEach(() => {
  fake = install();
  reset();
});

describe('load', () => {
  it('nạp dung lượng từ main', async () => {
    await useStorageStore.getState().load();

    expect(useStorageStore.getState().usage?.audioBytes).toBe(40_000);
    expect(useStorageStore.getState().error).toBeNull();
  });

  it('hạ cờ loading cả khi thành công', async () => {
    await useStorageStore.getState().load();
    expect(useStorageStore.getState().loading).toBe(false);
  });

  it('lỗi từ main hiện ra cho user', async () => {
    fake.api.storage.getUsage.mockResolvedValueOnce(err('DB_ERROR', 'Không đọc được DB.'));

    await useStorageStore.getState().load();

    expect(useStorageStore.getState().error).toContain('Không đọc được DB');
    expect(useStorageStore.getState().loading).toBe(false);
  });

  it('IPC reject cũng bắt được, không để promise nổ ra ngoài', async () => {
    fake.api.storage.getUsage.mockRejectedValueOnce(new Error('kênh chưa đăng ký'));

    await useStorageStore.getState().load();

    expect(useStorageStore.getState().error).toContain('kênh chưa đăng ký');
    // Không được kẹt ở "Đang đo dung lượng…" vĩnh viễn
    expect(useStorageStore.getState().loading).toBe(false);
  });
});

describe('expandBook', () => {
  it('mở sách thì tải chương của sách đó', async () => {
    await useStorageStore.getState().expandBook('book-1');

    expect(useStorageStore.getState().expandedBookId).toBe('book-1');
    expect(useStorageStore.getState().chapters).toHaveLength(2);
  });

  it('đóng lại thì xoá luôn danh sách chương', async () => {
    // Giữ lại thì lần mở sách khác sẽ nhấp nháy dữ liệu của sách trước
    await useStorageStore.getState().expandBook('book-1');
    await useStorageStore.getState().expandBook(null);

    expect(useStorageStore.getState().expandedBookId).toBeNull();
    expect(useStorageStore.getState().chapters).toEqual([]);
  });

  it('lỗi tải chương vẫn giữ sách ở trạng thái mở để user thấy thông báo', async () => {
    fake.api.storage.getChapterUsage.mockResolvedValueOnce(
      err('NOT_FOUND', 'Không tìm thấy sách này.'),
    );

    await useStorageStore.getState().expandBook('book-1');

    expect(useStorageStore.getState().error).toContain('Không tìm thấy sách');
    expect(useStorageStore.getState().expandedBookId).toBe('book-1');
  });
});

describe('deleteChapterAudio', () => {
  it('xoá rồi nạp lại số mới, không tự trừ ở renderer', async () => {
    await useStorageStore.getState().load();
    await useStorageStore.getState().expandBook('book-1');

    await useStorageStore.getState().deleteChapterAudio('book-1-c1');

    expect(useStorageStore.getState().lastDeleted?.freedBytes).toBe(40_000);
    // Số mới phải đến từ main, không phải phép trừ ở renderer
    expect(fake.api.storage.getUsage).toHaveBeenCalledTimes(2);
    expect(useStorageStore.getState().usage?.audioBytes).toBe(0);
  });

  it('nạp lại luôn bảng chương đang mở', async () => {
    await useStorageStore.getState().expandBook('book-1');
    await useStorageStore.getState().deleteChapterAudio('book-1-c1');

    const c1 = useStorageStore.getState().chapters.find((c) => c.chapterId === 'book-1-c1');
    expect(c1?.audioBytes).toBe(0);
    expect(c1?.readySegments).toBe(0);
  });

  it('không mở sách nào thì KHÔNG gọi getChapterUsage', async () => {
    await useStorageStore.getState().deleteChapterAudio('book-1-c1');

    expect(fake.api.storage.getChapterUsage).not.toHaveBeenCalled();
  });

  it('lỗi vẫn còn dù lượt nạp lại thành công', async () => {
    // Cùng cái bẫy đã sửa ở queue-store: `refresh` thành công ghi `error: null`
    // và thông báo hỏng biến mất trước khi user đọc được.
    fake.api.storage.deleteChapterAudio.mockResolvedValueOnce(
      err('IO_ERROR', 'File đang được dùng.'),
    );

    await useStorageStore.getState().deleteChapterAudio('book-1-c1');

    expect(useStorageStore.getState().error).toContain('File đang được dùng');
    expect(useStorageStore.getState().lastDeleted).toBeNull();
  });

  it('hạ cờ deleting cả khi lượt nạp lại hỏng', async () => {
    // Không hạ thì mọi nút xoá bị vô hiệu tới khi user mở lại màn hình
    fake.api.storage.getUsage.mockRejectedValueOnce(new Error('main chết'));

    await useStorageStore.getState().deleteChapterAudio('book-1-c1');

    expect(useStorageStore.getState().deleting).toBe(false);
  });

  it('bấm hai lần chỉ xoá một lượt', async () => {
    const store = useStorageStore.getState();
    await Promise.all([
      store.deleteChapterAudio('book-1-c1'),
      store.deleteChapterAudio('book-1-c1'),
    ]);

    expect(fake.api.storage.deleteChapterAudio).toHaveBeenCalledTimes(1);
  });
});

describe('deleteBookAudio', () => {
  it('xoá cả sách và nạp lại tổng', async () => {
    await useStorageStore.getState().load();
    await useStorageStore.getState().deleteBookAudio('book-1');

    expect(useStorageStore.getState().lastDeleted?.freedBytes).toBe(40_000);
    expect(useStorageStore.getState().usage?.audioBytes).toBe(0);
  });

  it('sách không tồn tại thì báo lỗi, không đổi số', async () => {
    await useStorageStore.getState().load();
    await useStorageStore.getState().deleteBookAudio('không-có');

    expect(useStorageStore.getState().error).toContain('Không tìm thấy sách');
    expect(useStorageStore.getState().usage?.audioBytes).toBe(40_000);
  });
});

describe('deleteOrphans', () => {
  it('dọn rác rồi nạp lại', async () => {
    fake = installFakeApi({ usage: { orphanFiles: 3, orphanBytes: 9000 } });
    reset();

    await useStorageStore.getState().load();
    expect(hasOrphans(useStorageStore.getState().usage)).toBe(true);

    await useStorageStore.getState().deleteOrphans();

    expect(useStorageStore.getState().lastDeleted?.filesDeleted).toBe(3);
    expect(hasOrphans(useStorageStore.getState().usage)).toBe(false);
  });
});

describe('clearError / clearLastDeleted', () => {
  it('đóng được thông báo lỗi', async () => {
    fake.api.storage.getUsage.mockResolvedValueOnce(err('UNKNOWN', 'lỗi gì đó'));
    await useStorageStore.getState().load();

    useStorageStore.getState().clearError();
    expect(useStorageStore.getState().error).toBeNull();
  });

  it('đóng được thông báo đã xoá', async () => {
    await useStorageStore.getState().deleteBookAudio('book-1');
    expect(useStorageStore.getState().lastDeleted).not.toBeNull();

    useStorageStore.getState().clearLastDeleted();
    expect(useStorageStore.getState().lastDeleted).toBeNull();
  });
});

describe('hàm thuần suy từ usage', () => {
  it('totalBytesOf cộng cả audio lẫn bản copy sách', async () => {
    await useStorageStore.getState().load();
    // 40 000 audio + 1000 file sách
    expect(totalBytesOf(useStorageStore.getState().usage)).toBe(41_000);
  });

  it('totalBytesOf chưa nạp thì trả 0', () => {
    expect(totalBytesOf(null)).toBe(0);
  });

  it('isOverWarnThreshold đúng khi vượt', () => {
    expect(
      isOverWarnThreshold({
        audioDir: 'E:\\a',
        audioBytes: 200,
        audioBytesOnDisk: 200,
        orphanBytes: 0,
        orphanFiles: 0,
        warnBytes: 100,
        books: [],
      }),
    ).toBe(true);
  });

  it('isOverWarnThreshold false khi user tắt cảnh báo', () => {
    expect(
      isOverWarnThreshold({
        audioDir: 'E:\\a',
        audioBytes: 10 ** 9,
        audioBytesOnDisk: 10 ** 9,
        orphanBytes: 0,
        orphanFiles: 0,
        warnBytes: 0,
        books: [],
      }),
    ).toBe(false);
  });
});
