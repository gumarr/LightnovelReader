import { describe, expect, it, vi } from 'vitest';
import type { Book, ChapterDraft } from '@ln/shared';
import { createLibraryHandlers } from './library.js';
import type { ImportSession, ImportSessionStore } from '../../services/import-session.js';
import type { LibraryService, SaveBookInput } from '../../services/library.js';
import type { BookRepository } from '../../db/repositories/books.js';
import type { ChapterRepository } from '../../db/repositories/chapters.js';
import type { SegmentRepository } from '../../db/repositories/segments.js';
import { InvalidInputError } from '../wrap.js';

const book = (id = 'book-1'): Book => ({
  id,
  title: 'Sách thử',
  format: 'pdf',
  filePath: `D:\\lib\\${id}.pdf`,
  fileHash: `hash-${id}`,
  lang: 'vi',
  addedAt: 1000,
});

const draft = (id: string, excluded = false): ChapterDraft => ({
  id,
  title: `Chương ${id}`,
  pageStart: 1,
  pageEnd: 10,
  excluded,
});

const session = (format: 'pdf' | 'docx' | 'epub' = 'pdf'): ImportSession =>
  ({
    id: 'imp1',
    filePath: 'D:\\sach\\goc.pdf',
    document: { format, pages: [], outline: [], totalPages: 10, hasRealPages: true },
    cleaned: [{ pageNumber: 1, text: 'Nội dung.' }],
    createdAt: 0,
  }) as ImportSession;

const setup = (options: {
  session?: ImportSession | undefined;
  onSave?: (input: SaveBookInput) => Promise<unknown>;
  books?: Book[];
  /** Sách tra được theo id — mặc định luôn tìm thấy `book-1` */
  findBook?: (id: string) => Book | undefined;
  findSegment?: (id: string) => { id: string; chapterId: string } | undefined;
  removeResult?: boolean;
} = {}) => {
  const saved: SaveBookInput[] = [];
  const discarded: string[] = [];
  const opened: { id: string; at: number; lastSegmentId?: string }[] = [];
  const removed: string[] = [];

  const sessions = {
    create: vi.fn(),
    get: () => ('session' in options ? options.session : session()),
    discard: (id: string) => {
      discarded.push(id);
      return true;
    },
    size: () => 1,
  } as unknown as ImportSessionStore;

  const library = {
    hashFile: vi.fn(),
    save: async (input: SaveBookInput) => {
      saved.push(input);
      if (options.onSave !== undefined) await options.onSave(input);
      return { book: book(), chapterCount: input.chapters.length, segmentCount: 42 };
    },
  } as unknown as LibraryService;

  const books = {
    listRecent: () => options.books ?? [],
    findById: options.findBook ?? ((id: string) => (id === 'book-1' ? book() : undefined)),
    markOpened: (id: string, at: number, lastSegmentId?: string) => {
      opened.push(lastSegmentId === undefined ? { id, at } : { id, at, lastSegmentId });
    },
    remove: (id: string) => {
      removed.push(id);
      return options.removeResult ?? true;
    },
  } as unknown as BookRepository;

  const segments = {
    findById:
      options.findSegment ??
      ((id: string) => (id === 'seg-42' ? { id, chapterId: 'c2' } : undefined)),
  } as unknown as SegmentRepository;

  const chapters = {
    listByBook: () => [
      { id: 'c1', bookId: 'book-1', index: 0, title: 'A', segmentCount: 10, audioBytes: 0, generateStatus: 'none' as const },
      { id: 'c2', bookId: 'book-1', index: 1, title: 'B', segmentCount: 32, audioBytes: 0, generateStatus: 'none' as const },
    ],
  } as unknown as ChapterRepository;

  return {
    handlers: createLibraryHandlers({
      library,
      sessions,
      books,
      chapters,
      segments,
      now: () => 5000,
    }),
    saved,
    discarded,
    opened,
    removed,
  };
};

const request = (overrides = {}) => ({
  importId: 'imp1',
  title: 'Sách thử',
  lang: 'vi' as const,
  chapters: [draft('c1')],
  ...overrides,
});

describe('library:saveBook', () => {
  it('lưu sách và trả về số chương/segment', async () => {
    const { handlers } = setup();
    const result = await handlers.saveBook(request());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.bookId).toBe('book-1');
      expect(result.data.segmentCount).toBe(42);
      expect(result.data.duplicate).toBe(false);
    }
  });

  it('KHÔNG lưu chương user đã loại trừ', async () => {
    const { handlers, saved } = setup();
    await handlers.saveBook(
      request({ chapters: [draft('giữ'), draft('bỏ', true), draft('giữ-2')] }),
    );

    expect(saved[0]?.chapters.map((c) => c.id)).toEqual(['giữ', 'giữ-2']);
  });

  it('loại trừ hết mọi chương thì từ chối', async () => {
    const { handlers } = setup();
    const result = await handlers.saveBook(request({ chapters: [draft('c1', true)] }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('ít nhất một chương');
  });

  it('phiên hết hạn trả NOT_FOUND kèm hướng dẫn', async () => {
    const { handlers } = setup({ session: undefined });
    const result = await handlers.saveBook(request());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
      expect(result.error.message).toContain('chọn lại file');
    }
  });

  it('giải phóng phiên sau khi lưu — không chờ renderer nhớ gọi cancel', async () => {
    const { handlers, discarded } = setup();
    await handlers.saveBook(request());

    expect(discarded).toEqual(['imp1']);
  });

  it('PDF truyền trang gốc để dựng rects', async () => {
    const { handlers, saved } = setup();
    await handlers.saveBook(request());

    expect(saved[0]).toHaveProperty('pages');
  });

  it('DOCX KHÔNG truyền trang gốc — không có toạ độ thật', async () => {
    const { handlers, saved } = setup({ session: session('docx') });
    await handlers.saveBook(request());

    expect(saved[0]).not.toHaveProperty('pages');
  });

  it('EPUB bị từ chối rõ ràng', async () => {
    const { handlers } = setup({ session: session('epub') });
    const result = await handlers.saveBook(request());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('UNSUPPORTED_FORMAT');
  });

  it('từ chối tên sách rỗng', async () => {
    const { handlers } = setup();
    await expect(handlers.saveBook(request({ title: '   ' }))).rejects.toBeInstanceOf(
      InvalidInputError,
    );
  });

  it('từ chối danh sách chương rỗng', async () => {
    const { handlers } = setup();
    await expect(handlers.saveBook(request({ chapters: [] }))).rejects.toBeInstanceOf(
      InvalidInputError,
    );
  });

  it('từ chối lang không hợp lệ', async () => {
    const { handlers } = setup();
    await expect(handlers.saveBook(request({ lang: 'jp' }))).rejects.toBeInstanceOf(
      InvalidInputError,
    );
  });

  it('từ chối số chương vượt trần — renderer hỏng không ép main dựng vô hạn', async () => {
    const { handlers } = setup();
    const many = Array.from({ length: 2001 }, (_, i) => draft(`c${i}`));

    await expect(handlers.saveBook(request({ chapters: many }))).rejects.toBeInstanceOf(
      InvalidInputError,
    );
  });
});

describe('library:openBook', () => {
  it('trả về sách kèm danh sách chương', () => {
    const { handlers } = setup();
    const result = handlers.openBook('book-1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.book.id).toBe('book-1');
      expect(result.data.chapters).toHaveLength(2);
    }
  });

  it('ghi lại thời điểm mở', () => {
    const { handlers, opened } = setup();
    handlers.openBook('book-1');

    expect(opened).toEqual([{ id: 'book-1', at: 5000 }]);
  });

  it('mở sách KHÔNG ghi đè vị trí đọc dở', () => {
    const { handlers, opened } = setup();
    handlers.openBook('book-1');

    // Mở sách không có nghĩa là đã đọc tới đâu
    expect(opened[0]).not.toHaveProperty('lastSegmentId');
  });

  it('chỉ ra chương chứa segment đọc dở để resume', () => {
    const { handlers } = setup({
      findBook: () => ({ ...book(), lastSegmentId: 'seg-42' }),
    });
    const result = handlers.openBook('book-1');

    if (result.ok) expect(result.data.resumeChapterId).toBe('c2');
  });

  it('chưa đọc lần nào thì không có chương resume', () => {
    const { handlers } = setup();
    const result = handlers.openBook('book-1');

    if (result.ok) expect(result.data).not.toHaveProperty('resumeChapterId');
  });

  it('segment đọc dở đã biến mất thì bỏ qua, không phải lỗi', () => {
    // Sách nhập lại sinh ID mới — vị trí cũ trỏ vào segment không còn
    const { handlers } = setup({
      findBook: () => ({ ...book(), lastSegmentId: 'seg-cũ' }),
      findSegment: () => undefined,
    });
    const result = handlers.openBook('book-1');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).not.toHaveProperty('resumeChapterId');
  });

  it('sách không tồn tại trả NOT_FOUND', () => {
    const { handlers } = setup();
    const result = handlers.openBook('không-có');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
  });

  it('từ chối bookId rỗng', () => {
    const { handlers } = setup();
    expect(() => handlers.openBook('')).toThrow(InvalidInputError);
  });
});

describe('library:setProgress', () => {
  it('ghi lại vị trí đọc dở', () => {
    const { handlers, opened } = setup();
    const result = handlers.setProgress({ bookId: 'book-1', segmentId: 'seg-42' });

    expect(result.ok).toBe(true);
    expect(opened).toEqual([{ id: 'book-1', at: 5000, lastSegmentId: 'seg-42' }]);
  });

  it('từ chối segment không tồn tại — resume sau sẽ trỏ vào hư không', () => {
    const { handlers, opened } = setup();
    const result = handlers.setProgress({ bookId: 'book-1', segmentId: 'seg-lạ' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
    expect(opened).toEqual([]);
  });

  it('từ chối sách không tồn tại', () => {
    const { handlers } = setup();
    const result = handlers.setProgress({ bookId: 'không-có', segmentId: 'seg-42' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
  });

  it('từ chối input thiếu field', () => {
    const { handlers } = setup();
    expect(() => handlers.setProgress({ bookId: 'book-1' })).toThrow(InvalidInputError);
  });
});

describe('library:removeBook', () => {
  it('xoá sách theo id', () => {
    const { handlers, removed } = setup();
    const result = handlers.removeBook('book-1');

    expect(result.ok).toBe(true);
    expect(removed).toEqual(['book-1']);
  });

  it('xoá sách không tồn tại trả NOT_FOUND', () => {
    const { handlers } = setup({ removeResult: false });
    const result = handlers.removeBook('không-có');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
  });

  it('từ chối bookId rỗng', () => {
    const { handlers } = setup();
    expect(() => handlers.removeBook('')).toThrow(InvalidInputError);
  });
});

describe('library:list', () => {
  it('trả về danh sách kèm số chương và segment', () => {
    const { handlers } = setup({ books: [book()] });
    const result = handlers.list();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0]?.chapterCount).toBe(2);
      expect(result.data[0]?.segmentCount).toBe(42);
    }
  });

  it('thư viện rỗng trả mảng rỗng, không phải lỗi', () => {
    const { handlers } = setup({ books: [] });
    const result = handlers.list();

    expect(result).toEqual({ ok: true, data: [] });
  });
});
