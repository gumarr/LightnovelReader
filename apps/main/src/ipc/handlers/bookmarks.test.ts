import { describe, expect, it } from 'vitest';
import type { Bookmark, BookmarkEntry } from '@ln/shared';
import { createBookmarkHandlers } from './bookmarks.js';
import type { BookmarkRepository } from '../../db/repositories/bookmarks.js';
import type { SegmentRepository } from '../../db/repositories/segments.js';
import { InvalidInputError } from '../wrap.js';

const entry = (overrides: Partial<BookmarkEntry> = {}): BookmarkEntry => ({
  bookmark: { id: 'bm-1', bookId: 'book-1', segmentId: 'seg-1', createdAt: 5000 },
  chapterTitle: 'Chương 1',
  chapterIndex: 0,
  segmentIndex: 3,
  excerpt: 'Câu văn.',
  ...overrides,
});

const setup = (
  options: {
    /** Segment tra được — mặc định chỉ có `seg-1` */
    findSegment?: (id: string) => { id: string } | undefined;
    /** Sách chứa segment — mặc định mọi segment thuộc `book-1` */
    findBookId?: (id: string) => string | undefined;
    /** Mục đọc lại được sau khi ghi. `undefined` giả lập ghi xong mà mất dấu */
    readBack?: BookmarkEntry | undefined;
    updateResult?: boolean;
    list?: BookmarkEntry[];
  } = {},
) => {
  const upserted: Bookmark[] = [];
  const removed: string[] = [];
  const noteUpdates: { id: string; note: string }[] = [];
  const listCalls: { bookId: string; limit: number }[] = [];

  const bookmarks = {
    upsert: (bookmark: Bookmark) => {
      upserted.push(bookmark);
      return bookmark.id;
    },
    listByBook: (bookId: string, limit: number) => {
      listCalls.push({ bookId, limit });
      return options.list ?? [];
    },
    findEntryById: () => ('readBack' in options ? options.readBack : entry()),
    updateNote: (id: string, note: string) => {
      noteUpdates.push({ id, note });
      return options.updateResult ?? true;
    },
    remove: (id: string) => {
      removed.push(id);
    },
    countByBook: () => 0,
  } as unknown as BookmarkRepository;

  const segments = {
    findById: options.findSegment ?? ((id: string) => (id === 'seg-1' ? { id } : undefined)),
    findBookId: options.findBookId ?? (() => 'book-1'),
  } as unknown as SegmentRepository;

  return {
    handlers: createBookmarkHandlers({
      bookmarks,
      segments,
      newId: () => 'bm-mới',
      now: () => 9000,
    }),
    upserted,
    removed,
    noteUpdates,
    listCalls,
  };
};

describe('bookmarks:list', () => {
  it('trả danh sách kèm ngữ cảnh', () => {
    const { handlers } = setup({ list: [entry()] });

    expect(handlers.list('book-1')).toEqual({ ok: true, data: [entry()] });
  });

  it('sách chưa có dấu trang nào trả mảng rỗng, không phải lỗi', () => {
    const { handlers } = setup({ list: [] });

    expect(handlers.list('book-1')).toEqual({ ok: true, data: [] });
  });

  it('truyền trần số mục xuống repository', () => {
    const { handlers, listCalls } = setup();
    handlers.list('book-1');

    expect(listCalls[0]?.limit).toBe(500);
  });

  it('bookId rỗng bị chặn ở biên', () => {
    const { handlers } = setup();
    expect(() => handlers.list('')).toThrow(InvalidInputError);
  });
});

describe('bookmarks:add', () => {
  it('thêm được và trả mục kèm ngữ cảnh', () => {
    const { handlers, upserted } = setup();
    const result = handlers.add({ bookId: 'book-1', segmentId: 'seg-1', note: 'Chỗ hay' });

    expect(result).toEqual({ ok: true, data: entry() });
    expect(upserted[0]).toEqual({
      id: 'bm-mới',
      bookId: 'book-1',
      segmentId: 'seg-1',
      note: 'Chỗ hay',
      createdAt: 9000,
    });
  });

  it('không có ghi chú thì không ghi trường `note`', () => {
    const { handlers, upserted } = setup();
    handlers.add({ bookId: 'book-1', segmentId: 'seg-1' });

    expect(upserted[0]).not.toHaveProperty('note');
  });

  it('ghi chú toàn khoảng trắng quy về không có ghi chú', () => {
    // Zod `trim` rồi; chỗ này khoá lại rằng chuỗi rỗng sau trim không lọt xuống
    // DB thành `note = ''` — hai cách biểu diễn cùng một thứ.
    const { handlers, upserted } = setup();
    handlers.add({ bookId: 'book-1', segmentId: 'seg-1', note: '   ' });

    expect(upserted[0]).not.toHaveProperty('note');
  });

  it('cắt khoảng trắng thừa quanh ghi chú', () => {
    const { handlers, upserted } = setup();
    handlers.add({ bookId: 'book-1', segmentId: 'seg-1', note: '  Chỗ hay  ' });

    expect(upserted[0]?.note).toBe('Chỗ hay');
  });

  it('đoạn không tồn tại trả NOT_FOUND, không để khoá ngoại nổ', () => {
    const { handlers } = setup({ findSegment: () => undefined });
    const result = handlers.add({ bookId: 'book-1', segmentId: 'không-có' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
  });

  it('đoạn thuộc sách khác bị từ chối', () => {
    // Sai lặng lẽ khó lần nhất: dấu trang hiện ở sách này, bấm vào nhảy sang
    // nội dung sách khác.
    const { handlers, upserted } = setup({ findBookId: () => 'book-khác' });
    const result = handlers.add({ bookId: 'book-1', segmentId: 'seg-1' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_INPUT');
    expect(upserted).toHaveLength(0);
  });

  it('ghi chú dài quá trần bị chặn', () => {
    const { handlers } = setup();
    expect(() =>
      handlers.add({ bookId: 'book-1', segmentId: 'seg-1', note: 'x'.repeat(501) }),
    ).toThrow(InvalidInputError);
  });

  it('thiếu segmentId bị chặn ở biên', () => {
    const { handlers } = setup();
    expect(() => handlers.add({ bookId: 'book-1' })).toThrow(InvalidInputError);
  });

  it('input không phải object bị chặn', () => {
    const { handlers } = setup();
    expect(() => handlers.add('book-1')).toThrow(InvalidInputError);
  });
});

describe('bookmarks:updateNote', () => {
  it('sửa được ghi chú', () => {
    const { handlers, noteUpdates } = setup();
    const result = handlers.updateNote({ id: 'bm-1', note: 'ghi chú mới' });

    expect(result).toEqual({ ok: true, data: entry() });
    expect(noteUpdates[0]).toEqual({ id: 'bm-1', note: 'ghi chú mới' });
  });

  it('chuỗi rỗng là xoá ghi chú, không phải lỗi', () => {
    const { handlers, noteUpdates } = setup();
    const result = handlers.updateNote({ id: 'bm-1', note: '' });

    expect(result.ok).toBe(true);
    expect(noteUpdates[0]?.note).toBe('');
  });

  it('dấu trang đã bị xoá trả NOT_FOUND', () => {
    const { handlers } = setup({ updateResult: false });
    const result = handlers.updateNote({ id: 'bm-1', note: 'x' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
  });

  it('không cho đổi segmentId — trường lạ bị bỏ qua', () => {
    const { handlers, noteUpdates } = setup();
    handlers.updateNote({ id: 'bm-1', note: 'x', segmentId: 'seg-9' });

    expect(noteUpdates[0]).toEqual({ id: 'bm-1', note: 'x' });
  });

  it('thiếu id bị chặn ở biên', () => {
    const { handlers } = setup();
    expect(() => handlers.updateNote({ note: 'x' })).toThrow(InvalidInputError);
  });
});

describe('bookmarks:remove', () => {
  it('xoá được', () => {
    const { handlers, removed } = setup();

    expect(handlers.remove('bm-1')).toEqual({ ok: true, data: undefined });
    expect(removed).toEqual(['bm-1']);
  });

  it('xoá mục không tồn tại vẫn trả ok — kết quả user muốn đã đúng sẵn', () => {
    const { handlers } = setup();

    expect(handlers.remove('không-có').ok).toBe(true);
  });

  it('id rỗng bị chặn ở biên', () => {
    const { handlers } = setup();
    expect(() => handlers.remove('')).toThrow(InvalidInputError);
  });
});

describe('đọc lại sau khi ghi', () => {
  it('ghi xong mà không đọc lại được thì báo lỗi, không trả dữ liệu bịa', () => {
    // Renderer dùng `id` trả về cho nút xoá; dựng tay một `BookmarkEntry` thiếu
    // ngữ cảnh sẽ hiện ra hàng trống mà không ai biết vì sao.
    const { handlers } = setup({ readBack: undefined });
    const result = handlers.add({ bookId: 'book-1', segmentId: 'seg-1' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
  });
});
