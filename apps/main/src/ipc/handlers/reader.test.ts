import { describe, expect, it, vi } from 'vitest';
import type { Book, Chapter, Segment } from '@ln/shared';
import { createReaderHandlers } from './reader.js';
import type { BookRepository } from '../../db/repositories/books.js';
import type { ChapterRepository } from '../../db/repositories/chapters.js';
import type { SegmentRepository } from '../../db/repositories/segments.js';
import type { TimingsFile, TimingsStore } from '../../services/timings-store.js';
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

/** Lỗi "không có file" của Node — phân biệt với lỗi quyền/ổ đĩa */
const enoent = (): NodeJS.ErrnoException => {
  const error: NodeJS.ErrnoException = new Error('ENOENT');
  error.code = 'ENOENT';
  return error;
};

const setup = (
  options: {
    books?: Book[];
    chapters?: Chapter[];
    segments?: Segment[];
    readFile?: (path: string) => Promise<Uint8Array>;
    convertDocx?: (path: string) => Promise<string>;
    timings?: TimingsFile | undefined;
    readTimings?: () => Promise<TimingsFile | undefined>;
    audioDir?: string;
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

  const readTimings = vi.fn(
    options.readTimings ?? (async () => options.timings),
  ) as unknown as TimingsStore['read'];

  let audioDir = options.audioDir ?? 'D:\\audio';

  const handlers = createReaderHandlers({
    books: {
      findById: (id: string) => list.find((b) => b.id === id),
    } as unknown as BookRepository,
    chapters: {
      findById: (id: string) => chapterList.find((c) => c.id === id),
    } as unknown as ChapterRepository,
    segments: {
      listByChapter: (id: string) => segmentList.filter((s) => s.chapterId === id),
      findById: (id: string) => segmentList.find((s) => s.id === id),
      findBookId: (id: string) =>
        segmentList.some((s) => s.id === id) ? chapterList[0]?.bookId : undefined,
    } as unknown as SegmentRepository,
    readFile,
    convertDocx,
    timings: { read: readTimings } as unknown as TimingsStore,
    getAudioDir: () => audioDir,
  });

  return {
    handlers,
    readFile,
    convertDocx,
    readPaths,
    convertPaths,
    readTimings,
    setAudioDir: (next: string) => {
      audioDir = next;
    },
  };
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

describe('getSegmentAudio', () => {
  /** Segment `ready` + timing thật từ phoneme — trường hợp thường gặp nhất */
  const readySetup = (over: Parameters<typeof setup>[0] = {}) =>
    setup({
      segments: [
        { ...segment('s1', 0), text: 'một hai ba', status: 'ready', durationMs: 1500 },
        segment('s2', 1),
      ],
      timings: {
        version: 1,
        segmentId: 's1',
        durationMs: 1500,
        source: 'phoneme',
        words: [
          { w: 'một', startMs: 0, endMs: 400, charStart: 0, charEnd: 3 },
          { w: 'hai', startMs: 450, endMs: 900, charStart: 4, charEnd: 7 },
          { w: 'ba', startMs: 950, endMs: 1500, charStart: 8, charEnd: 10 },
        ],
      },
      ...over,
    });

  it('trả bytes audio kèm timing từ phoneme', async () => {
    const { handlers } = readySetup();
    const result = await handlers.getSegmentAudio('s1');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(new Uint8Array(result.data.bytes)).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(result.data.durationMs).toBe(1500);
    expect(result.data.timingSource).toBe('phoneme');
    expect(result.data.timings.map((t) => t.w)).toEqual(['một', 'hai', 'ba']);
  });

  it('đường dẫn ghép từ audioDir + bookId + segmentId, renderer không truyền path', async () => {
    const { handlers, readPaths } = readySetup();
    await handlers.getSegmentAudio('s1');

    expect(readPaths).toEqual(['D:\\audio\\book-1\\s1.ogg']);
  });

  it('đọc audioDir mỗi lần gọi — user đổi thư mục giữa phiên', async () => {
    const { handlers, readPaths, setAudioDir } = readySetup();

    await handlers.getSegmentAudio('s1');
    setAudioDir('E:\\audio-mới');
    await handlers.getSegmentAudio('s1');

    expect(readPaths).toEqual(['D:\\audio\\book-1\\s1.ogg', 'E:\\audio-mới\\book-1\\s1.ogg']);
  });

  it('sao chép ra ArrayBuffer riêng, không gửi kèm pool của Node', async () => {
    const pool = new Uint8Array([9, 9, 7, 8, 9, 9]);
    const { handlers } = readySetup({ readFile: async () => pool.subarray(2, 4) });

    const result = await handlers.getSegmentAudio('s1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.bytes.byteLength).toBe(2);
    expect(new Uint8Array(result.data.bytes)).toEqual(new Uint8Array([7, 8]));
  });

  it('thiếu file timing thì ước lượng, không trả mảng rỗng', async () => {
    // Có tiếng mà không có mốc thì highlight đứng im — renderer không phải xử lý
    const { handlers } = readySetup({ timings: undefined });
    const result = await handlers.getSegmentAudio('s1');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.timingSource).toBe('estimate');
    expect(result.data.timings.map((t) => t.w)).toEqual(['một', 'hai', 'ba']);
    expect(result.data.timings.at(-1)?.endMs).toBe(1500);
  });

  it('file timing có nhưng mảng từ rỗng cũng rơi về ước lượng', async () => {
    const { handlers } = readySetup({
      timings: { version: 1, segmentId: 's1', durationMs: 1500, source: 'phoneme', words: [] },
    });

    const result = await handlers.getSegmentAudio('s1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.timingSource).toBe('estimate');
    expect(result.data.timings).toHaveLength(3);
  });

  it('mất file timing thì lấy durationMs từ DB', async () => {
    const { handlers } = readySetup({ timings: undefined });
    const result = await handlers.getSegmentAudio('s1');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.durationMs).toBe(1500);
  });

  it('segment chưa generate báo NOT_FOUND, không đọc đĩa', async () => {
    // Player bắt mã này để xếp ưu tiên rồi chờ, chứ không hiện hộp lỗi
    const { handlers, readFile } = readySetup();
    const result = await handlers.getSegmentAudio('s2');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_FOUND');
    expect(readFile).not.toHaveBeenCalled();
  });

  it('DB nói ready mà file đã bị xoá cũng báo NOT_FOUND', async () => {
    // Storage Manager vừa xoá audio dưới chân player
    const { handlers } = readySetup({
      readFile: async () => {
        throw enoent();
      },
    });

    const result = await handlers.getSegmentAudio('s1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_FOUND');
  });

  it('lỗi đĩa khác ENOENT vẫn ném lên — không giả vờ là "chưa generate"', async () => {
    const denied: NodeJS.ErrnoException = new Error('EACCES');
    denied.code = 'EACCES';

    const { handlers } = readySetup({
      readFile: async () => {
        throw denied;
      },
    });

    await expect(handlers.getSegmentAudio('s1')).rejects.toThrow('EACCES');
  });

  it('segment không tồn tại báo NOT_FOUND', async () => {
    const { handlers } = readySetup();
    const result = await handlers.getSegmentAudio('không-có');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_FOUND');
  });

  it('segmentId sai kiểu ném InvalidInputError', async () => {
    const { handlers } = readySetup();
    await expect(handlers.getSegmentAudio(42)).rejects.toThrow(InvalidInputError);
  });
});
