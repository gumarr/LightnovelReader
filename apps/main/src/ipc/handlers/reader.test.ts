import { describe, expect, it, vi } from 'vitest';
import type { Book, Chapter, Segment } from '@ln/shared';
import { createReaderHandlers } from './reader.js';
import type { BookRepository } from '../../db/repositories/books.js';
import type { ChapterRepository } from '../../db/repositories/chapters.js';
import type { SegmentRepository } from '../../db/repositories/segments.js';
import { InvalidInputError } from '../wrap.js';

const book = (over: Partial<Book> = {}): Book => ({
  id: 'book-1',
  title: 'Sách thử',
  format: 'pdf',
  filePath: 'D:\\lib\\book-1.pdf',
  fileHash: 'hash',
  lang: 'vi',
  addedAt: 1000,
  ...over,
});

const chapter = (id = 'ch-1'): Chapter => ({
  id,
  bookId: 'book-1',
  index: 0,
  title: 'Chương 1',
  segmentCount: 2,
  audioBytes: 0,
  errorCount: 0,
  generateStatus: 'none',
});

const segment = (id: string, index: number): Segment => ({
  id,
  chapterId: 'ch-1',
  index,
  text: `Đoạn ${index}.`,
  anchor: { kind: 'pdf', page: 1, rects: [] },
  status: 'pending',
  alignStatus: 'none',
});

const setup = (
  options: {
    books?: Book[];
    chapters?: Chapter[];
    segments?: Segment[];
    readFile?: (path: string) => Promise<Uint8Array>;
    convertDocx?: (path: string) => Promise<string>;
  } = {},
) => {
  const readPaths: string[] = [];
  const convertPaths: string[] = [];

  const readFile = vi.fn(async (path: string) => {
    readPaths.push(path);
    return options.readFile === undefined
      ? new Uint8Array([1, 2, 3, 4])
      : await options.readFile(path);
  });

  const convertDocx = vi.fn(async (path: string) => {
    convertPaths.push(path);
    return options.convertDocx === undefined ? '<p>xin chào</p>' : await options.convertDocx(path);
  });

  const list = options.books ?? [book()];
  const chapterList = options.chapters ?? [chapter()];
  const segmentList = options.segments ?? [segment('s1', 0), segment('s2', 1)];

  const handlers = createReaderHandlers({
    books: {
      findById: (id: string) => list.find((b) => b.id === id),
    } as unknown as BookRepository,
    chapters: {
      findById: (id: string) => chapterList.find((c) => c.id === id),
    } as unknown as ChapterRepository,
    segments: {
      listByChapter: (id: string) => segmentList.filter((s) => s.chapterId === id),
    } as unknown as SegmentRepository,
    readFile,
    convertDocx,
  });

  return { handlers, readFile, convertDocx, readPaths, convertPaths };
};

describe('getBookFile', () => {
  it('trả bytes của file PDF', async () => {
    const { handlers } = setup();
    const result = await handlers.getBookFile('book-1');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(new Uint8Array(result.data.bytes)).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(result.data.format).toBe('pdf');
  });

  it('đường dẫn lấy từ DB, không phải từ renderer', async () => {
    // Renderer chỉ gửi bookId — không có cách nào bảo main đọc file tuỳ ý
    const { handlers, readPaths } = setup();
    await handlers.getBookFile('book-1');

    expect(readPaths).toEqual(['D:\\lib\\book-1.pdf']);
  });

  it('sao chép ra ArrayBuffer riêng, không gửi kèm pool của Node', async () => {
    // Buffer của Node là lát của pool chung; gửi thẳng `.buffer` là lộ dữ liệu
    // file khác nằm cùng pool
    const pool = new Uint8Array([9, 9, 1, 2, 3, 9, 9]);
    const view = pool.subarray(2, 5);

    const { handlers } = setup({ readFile: async () => view });
    const result = await handlers.getBookFile('book-1');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.bytes.byteLength).toBe(3);
    expect(new Uint8Array(result.data.bytes)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('sách không có báo NOT_FOUND', async () => {
    const { handlers, readFile } = setup();
    const result = await handlers.getBookFile('không-có');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_FOUND');
    expect(readFile).not.toHaveBeenCalled();
  });

  it('sách DOCX bị từ chối — kênh này chỉ cho PDF', async () => {
    const { handlers } = setup({ books: [book({ format: 'docx' })] });
    const result = await handlers.getBookFile('book-1');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_INPUT');
  });

  it('bookId sai kiểu ném InvalidInputError', async () => {
    const { handlers } = setup();
    await expect(handlers.getBookFile(42)).rejects.toThrow(InvalidInputError);
  });
});

describe('getBookHtml', () => {
  it('trả HTML đã sanitize và đánh số khối', async () => {
    const { handlers } = setup({
      books: [book({ format: 'docx' })],
      convertDocx: async () => '<p class="x">a</p><script>bad()</script><h1>b</h1>',
    });

    const result = await handlers.getBookHtml('book-1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.html).toBe('<p data-block="0">a</p><h1 data-block="1">b</h1>');
    expect(result.data.blockCount).toBe(2);
  });

  it('cache theo sách — không convert lại lần hai', async () => {
    const { handlers, convertDocx } = setup({ books: [book({ format: 'docx' })] });

    await handlers.getBookHtml('book-1');
    await handlers.getBookHtml('book-1');

    expect(convertDocx).toHaveBeenCalledTimes(1);
  });

  it('mở sách khác thì thay chỗ trong cache', async () => {
    const { handlers, convertDocx } = setup({
      books: [book({ format: 'docx' }), book({ id: 'book-2', format: 'docx' })],
    });

    await handlers.getBookHtml('book-1');
    await handlers.getBookHtml('book-2');
    await handlers.getBookHtml('book-1');

    // Chỉ giữ một sách để thư viện lớn không dồn hết vào RAM
    expect(convertDocx).toHaveBeenCalledTimes(3);
  });

  it('sách PDF bị từ chối — kênh này chỉ cho DOCX', async () => {
    const { handlers } = setup();
    const result = await handlers.getBookHtml('book-1');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_INPUT');
  });

  it('sách không có báo NOT_FOUND', async () => {
    const { handlers, convertDocx } = setup();
    const result = await handlers.getBookHtml('không-có');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_FOUND');
    expect(convertDocx).not.toHaveBeenCalled();
  });
});

describe('listSegments', () => {
  it('trả segment của chương theo đúng thứ tự', () => {
    const { handlers } = setup();
    const result = handlers.listSegments('ch-1');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.map((s) => s.id)).toEqual(['s1', 's2']);
  });

  it('chương không có báo NOT_FOUND', () => {
    const { handlers } = setup();
    const result = handlers.listSegments('ch-lạ');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_FOUND');
  });

  it('chapterId sai kiểu ném InvalidInputError', () => {
    const { handlers } = setup();
    expect(() => handlers.listSegments(null)).toThrow(InvalidInputError);
  });
});
