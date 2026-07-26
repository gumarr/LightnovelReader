import { describe, expect, it, vi } from 'vitest';
import type { Book, Chapter } from '@ln/shared';
import { createStorageHandlers } from './storage.js';
import type { BookRepository } from '../../db/repositories/books.js';
import type { ChapterRepository } from '../../db/repositories/chapters.js';
import type { StorageService } from '../../services/storage.js';
import type { GenerateQueue } from '../../services/queue.js';
import { InvalidInputError } from '../wrap.js';

/**
 * Test handler `storage:*`.
 *
 * Trọng tâm: **huỷ job trước khi xoá file**. Bỏ bước đó thì worker ghi lại đúng
 * những file vừa xoá, DB nói `pending` cho file đang tồn tại, và user thấy dung
 * lượng không giảm.
 */

const book = (id = 'book-1'): Book => ({
  id,
  title: 'Sách thử',
  format: 'pdf',
  filePath: `D:\\lib\\${id}.pdf`,
  fileHash: `hash-${id}`,
  lang: 'vi',
  addedAt: 1000,
});

const chapter = (overrides: Partial<Chapter> = {}): Chapter => ({
  id: 'chap-1',
  bookId: 'book-1',
  index: 0,
  title: 'Chương 1',
  segmentCount: 10,
  audioBytes: 5000,
  generateStatus: 'complete',
  ...overrides,
});

const emptyResult = { segments: 0, freedBytes: 0, filesDeleted: 0 };

const setup = (options: {
  findBook?: (id: string) => Book | undefined;
  findChapter?: (id: string) => Chapter | undefined;
  audioDir?: string;
  warnBytes?: number;
} = {}) => {
  /** Thứ tự thao tác — kiểm huỷ job có xảy ra TRƯỚC lượt xoá hay không */
  const order: string[] = [];

  const storage = {
    usage: vi.fn(async (input: { audioDir: string; warnBytes: number }) => ({
      audioDir: input.audioDir,
      audioBytes: 9000,
      audioBytesOnDisk: 9400,
      orphanBytes: 0,
      orphanFiles: 0,
      warnBytes: input.warnBytes,
      books: [],
    })),
    chapterUsage: vi.fn(() => [
      {
        chapterId: 'chap-1',
        title: 'Chương 1',
        index: 0,
        segmentCount: 10,
        readySegments: 10,
        audioBytes: 5000,
      },
    ]),
    deleteChapterAudio: vi.fn(async () => {
      order.push('deleteChapter');
      return { segments: 10, freedBytes: 5000, filesDeleted: 20 };
    }),
    deleteBookAudio: vi.fn(async () => {
      order.push('deleteBook');
      return { segments: 30, freedBytes: 15_000, filesDeleted: 60 };
    }),
    deleteReadAudio: vi.fn(async () => {
      order.push('deleteRead');
      return { segments: 10, freedBytes: 5000, filesDeleted: 20 };
    }),
    deleteOrphans: vi.fn(async () => ({ files: 4, bytes: 7000 })),
    removeBookFiles: vi.fn(async () => undefined),
  } as unknown as StorageService;

  const books = {
    findById: options.findBook ?? ((id: string) => (id === 'book-1' ? book() : undefined)),
  } as unknown as BookRepository;

  const chapters = {
    findById: options.findChapter ?? ((id: string) => (id === 'chap-1' ? chapter() : undefined)),
  } as unknown as ChapterRepository;

  const cancelBook = vi.fn((bookId: string) => {
    order.push(`cancelBook:${bookId}`);
    return 3;
  });

  const queue = { cancelBook } as unknown as GenerateQueue;

  return {
    handlers: createStorageHandlers({
      storage,
      books,
      chapters,
      queue,
      getAudioDir: () => options.audioDir ?? 'E:\\audio',
      getWarnBytes: () => options.warnBytes ?? 5 * 1024 ** 3,
    }),
    storage,
    cancelBook,
    order,
  };
};

describe('storage:getUsage', () => {
  it('truyền audioDir và ngưỡng hiện tại xuống service', async () => {
    const { handlers, storage } = setup({ audioDir: 'F:\\ln', warnBytes: 2048 });
    const result = await handlers.getUsage();

    expect(result.ok).toBe(true);
    expect(storage.usage).toHaveBeenCalledWith({ audioDir: 'F:\\ln', warnBytes: 2048 });
  });

  it('trả cả số DB lẫn số quét đĩa để UI thấy được lệch', async () => {
    const { handlers } = setup();
    const result = await handlers.getUsage();

    if (!result.ok) throw new Error('phải thành công');
    expect(result.data.audioBytes).toBe(9000);
    expect(result.data.audioBytesOnDisk).toBe(9400);
  });
});

describe('storage:getChapterUsage', () => {
  it('trả dung lượng từng chương', () => {
    const { handlers } = setup();
    const result = handlers.getChapterUsage('book-1');

    if (!result.ok) throw new Error('phải thành công');
    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.audioBytes).toBe(5000);
  });

  it('sách không tồn tại trả NOT_FOUND', () => {
    const { handlers } = setup({ findBook: () => undefined });
    const result = handlers.getChapterUsage('không-có');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
  });

  it('từ chối bookId rỗng', () => {
    const { handlers } = setup();
    expect(() => handlers.getChapterUsage('')).toThrow(InvalidInputError);
  });
});

describe('storage:deleteChapterAudio', () => {
  it('HUỶ JOB của sách trước khi xoá file', async () => {
    // Ngược thứ tự thì job còn lại ghi lại đúng file vừa xoá.
    const { handlers, order } = setup();
    await handlers.deleteChapterAudio('chap-1');

    expect(order).toEqual(['cancelBook:book-1', 'deleteChapter']);
  });

  it('trả số byte đã giải phóng cho UI báo lại', async () => {
    const { handlers } = setup();
    const result = await handlers.deleteChapterAudio('chap-1');

    if (!result.ok) throw new Error('phải thành công');
    expect(result.data.freedBytes).toBe(5000);
    expect(result.data.filesDeleted).toBe(20);
  });

  it('chương không tồn tại trả NOT_FOUND và KHÔNG huỷ job nào', async () => {
    const { handlers, cancelBook } = setup({ findChapter: () => undefined });
    const result = await handlers.deleteChapterAudio('không-có');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
    expect(cancelBook).not.toHaveBeenCalled();
  });

  it('từ chối chapterId rỗng', async () => {
    const { handlers } = setup();
    await expect(handlers.deleteChapterAudio('')).rejects.toThrow(InvalidInputError);
  });
});

describe('storage:deleteBookAudio', () => {
  it('huỷ job rồi mới xoá', async () => {
    const { handlers, order } = setup();
    await handlers.deleteBookAudio('book-1');

    expect(order).toEqual(['cancelBook:book-1', 'deleteBook']);
  });

  it('sách không tồn tại trả NOT_FOUND', async () => {
    const { handlers, cancelBook } = setup({ findBook: () => undefined });
    const result = await handlers.deleteBookAudio('không-có');

    expect(result.ok).toBe(false);
    expect(cancelBook).not.toHaveBeenCalled();
  });
});

describe('storage:deleteReadAudio', () => {
  it('huỷ job rồi mới xoá chương đã đọc', async () => {
    const { handlers, order } = setup();
    await handlers.deleteReadAudio('book-1');

    expect(order).toEqual(['cancelBook:book-1', 'deleteRead']);
  });

  it('sách không tồn tại trả NOT_FOUND', async () => {
    const { handlers } = setup({ findBook: () => undefined });
    const result = await handlers.deleteReadAudio('không-có');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
  });
});

describe('storage:deleteOrphans', () => {
  it('đổi kết quả sang hình dạng chung, segments = 0', async () => {
    // File mồ côi không thuộc segment nào còn trong DB — 0 là đúng chứ không
    // phải thiếu sót.
    const { handlers } = setup();
    const result = await handlers.deleteOrphans();

    if (!result.ok) throw new Error('phải thành công');
    expect(result.data).toEqual({ segments: 0, freedBytes: 7000, filesDeleted: 4 });
  });

  it('KHÔNG huỷ job — dọn rác không đụng sách nào đang generate', async () => {
    const { handlers, cancelBook } = setup();
    await handlers.deleteOrphans();

    expect(cancelBook).not.toHaveBeenCalled();
  });
});

describe('đọc thiết lập lúc gọi, không chốt sẵn', () => {
  it('đổi thư mục audio giữa hai lượt gọi thì lượt sau dùng thư mục mới', async () => {
    let dir = 'E:\\cu';
    const storage = {
      usage: vi.fn(async () => ({
        audioDir: dir,
        audioBytes: 0,
        audioBytesOnDisk: 0,
        orphanBytes: 0,
        orphanFiles: 0,
        warnBytes: 0,
        books: [],
      })),
      deleteBookAudio: vi.fn(async () => emptyResult),
    } as unknown as StorageService;

    const handlers = createStorageHandlers({
      storage,
      books: { findById: () => book() } as unknown as BookRepository,
      chapters: {} as unknown as ChapterRepository,
      queue: { cancelBook: vi.fn(() => 0) } as unknown as GenerateQueue,
      getAudioDir: () => dir,
      getWarnBytes: () => 0,
    });

    await handlers.deleteBookAudio('book-1');
    dir = 'F:\\moi';
    await handlers.deleteBookAudio('book-1');

    expect(storage.deleteBookAudio).toHaveBeenLastCalledWith({
      audioDir: 'F:\\moi',
      bookId: 'book-1',
    });
  });
});
