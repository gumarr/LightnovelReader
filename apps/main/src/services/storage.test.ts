import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as Db } from 'better-sqlite3';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Book, Chapter, Segment } from '@ln/shared';
import { applyConnectionPragmas, migrate } from '../db/migrator.js';
import { createBookRepository, type BookRepository } from '../db/repositories/books.js';
import { createChapterRepository, type ChapterRepository } from '../db/repositories/chapters.js';
import { createSegmentRepository, type SegmentRepository } from '../db/repositories/segments.js';
import { createStorageService, type StorageService } from './storage.js';

/**
 * Test Storage Manager trên **DB thật + đĩa thật**.
 *
 * Không mock `fs`: cả mục đích của lớp này là xoá file cho đúng, mà `fs` giả chỉ
 * chứng minh nó gọi đúng tên hàm — không chứng minh file nào biến mất. Cùng lý
 * do với `timings-store.test.ts`.
 */

let db: Db;
let audioDir: string;
let libraryDirPath: string;
let books: BookRepository;
let chapters: ChapterRepository;
let segments: SegmentRepository;
let storage: StorageService;

const book = (overrides: Partial<Book> = {}): Book => ({
  id: 'book-1',
  title: 'Kiếm Vực Thần Đế',
  format: 'pdf',
  filePath: join(libraryDirPath, 'book-1.pdf'),
  fileHash: 'hash-1',
  lang: 'vi',
  addedAt: 1000,
  ...overrides,
});

const chapter = (overrides: Partial<Chapter> = {}): Chapter => ({
  id: 'chap-1',
  bookId: 'book-1',
  index: 0,
  title: 'Chương 1',
  segmentCount: 2,
  audioBytes: 0,
  errorCount: 0,
  generateStatus: 'none',
  ...overrides,
});

const segment = (overrides: Partial<Segment> = {}): Segment => ({
  id: 'seg-1',
  chapterId: 'chap-1',
  index: 0,
  text: 'Câu văn.',
  anchor: { kind: 'pdf', page: 1, rects: [] },
  status: 'pending',
  alignStatus: 'none',
  ...overrides,
});

/** Tạo file `.ogg` + `.json` thật cho một segment rồi ghi vào DB như queue làm */
const generate = (bookId: string, segmentId: string, bytes: number): void => {
  const dir = join(audioDir, bookId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${segmentId}.ogg`), Buffer.alloc(bytes, 1));
  writeFileSync(join(dir, `${segmentId}.json`), JSON.stringify({ version: 1, words: [] }));

  segments.markReady(segmentId, {
    audioPath: join(dir, `${segmentId}.ogg`),
    durationMs: 3000,
    audioBytes: bytes,
    alignStatus: 'estimated',
  });
};

const filesIn = (bookId: string): string[] => {
  const dir = join(audioDir, bookId);
  return existsSync(dir) ? readdirSync(dir).sort() : [];
};

beforeEach(() => {
  db = new Database(':memory:');
  applyConnectionPragmas(db);
  migrate(db);

  audioDir = mkdtempSync(join(tmpdir(), 'ln-storage-audio-'));
  libraryDirPath = mkdtempSync(join(tmpdir(), 'ln-storage-lib-'));

  books = createBookRepository(db);
  chapters = createChapterRepository(db);
  segments = createSegmentRepository(db);
  storage = createStorageService({ books, chapters, segments });

  books.insert(book());
  chapters.insertMany([
    chapter({ id: 'chap-1', index: 0 }),
    chapter({ id: 'chap-2', index: 1 }),
  ]);
  segments.insertMany([
    segment({ id: 'seg-1', chapterId: 'chap-1', index: 0 }),
    segment({ id: 'seg-2', chapterId: 'chap-1', index: 1 }),
    segment({ id: 'seg-3', chapterId: 'chap-2', index: 0 }),
  ]);
});

afterEach(() => {
  db.close();
  rmSync(audioDir, { recursive: true, force: true });
  rmSync(libraryDirPath, { recursive: true, force: true });
});

describe('deleteChapterAudio', () => {
  beforeEach(() => {
    generate('book-1', 'seg-1', 4000);
    generate('book-1', 'seg-2', 6000);
    generate('book-1', 'seg-3', 5000);
  });

  it('xoá cả .ogg lẫn .json của chương đó', async () => {
    await storage.deleteChapterAudio({ audioDir, chapterId: 'chap-1' });

    // Chỉ còn file của chap-2. Sót `.json` là rác tích dần mà không ai đếm.
    expect(filesIn('book-1')).toEqual(['seg-3.json', 'seg-3.ogg']);
  });

  it('báo đúng số byte đã giải phóng và số file đã xoá', async () => {
    const result = await storage.deleteChapterAudio({ audioDir, chapterId: 'chap-1' });

    expect(result.freedBytes).toBe(10_000);
    expect(result.segments).toBe(2);
    // 2 segment × (ogg + json)
    expect(result.filesDeleted).toBe(4);
  });

  it('đưa segment về pending để reader không hiện nút phát cho file đã mất', async () => {
    await storage.deleteChapterAudio({ audioDir, chapterId: 'chap-1' });

    expect(segments.findById('seg-1')?.status).toBe('pending');
    expect(chapters.findById('chap-1')?.audioBytes).toBe(0);
  });

  it('KHÔNG đụng audio chương khác', async () => {
    await storage.deleteChapterAudio({ audioDir, chapterId: 'chap-1' });

    expect(segments.findById('seg-3')?.status).toBe('ready');
    expect(chapters.findById('chap-2')?.audioBytes).toBe(5000);
  });

  it('KHÔNG xoá tiến độ đọc — ràng buộc CLAUDE.md', async () => {
    books.markOpened('book-1', 5000, 'seg-1');
    await storage.deleteChapterAudio({ audioDir, chapterId: 'chap-1' });

    expect(books.findById('book-1')?.lastSegmentId).toBe('seg-1');
  });

  it('chương không tồn tại thì không xoá gì và không ném', async () => {
    const result = await storage.deleteChapterAudio({ audioDir, chapterId: 'khong-co' });

    expect(result).toEqual({ segments: 0, freedBytes: 0, filesDeleted: 0 });
    expect(filesIn('book-1')).toHaveLength(6);
  });

  it('file đã bị xoá tay bên ngoài vẫn dọn được DB', async () => {
    // Ổ đĩa rời hoặc user xoá tay: `unlink` ném ENOENT, nhưng DB vẫn phải sạch
    // chứ không kẹt ở `ready` cho file không còn.
    rmSync(join(audioDir, 'book-1', 'seg-1.ogg'));
    const result = await storage.deleteChapterAudio({ audioDir, chapterId: 'chap-1' });

    expect(segments.findById('seg-1')?.status).toBe('pending');
    expect(result.segments).toBe(2);
  });
});

describe('deleteBookAudio', () => {
  beforeEach(() => {
    generate('book-1', 'seg-1', 4000);
    generate('book-1', 'seg-2', 6000);
    generate('book-1', 'seg-3', 5000);
  });

  it('xoá sạch mọi file audio của sách', async () => {
    const result = await storage.deleteBookAudio({ audioDir, bookId: 'book-1' });

    expect(result.freedBytes).toBe(15_000);
    expect(result.segments).toBe(3);
    expect(filesIn('book-1')).toEqual([]);
  });

  it('xoá luôn thư mục sách khi đã rỗng', async () => {
    await storage.deleteBookAudio({ audioDir, bookId: 'book-1' });

    expect(existsSync(join(audioDir, 'book-1'))).toBe(false);
  });

  it('còn file lạ thì giữ thư mục, không ném', async () => {
    writeFileSync(join(audioDir, 'book-1', 'ghi-chu.txt'), 'của user');
    await storage.deleteBookAudio({ audioDir, bookId: 'book-1' });

    // File không phải của app thì không xoá — nó vẫn ở đó
    expect(filesIn('book-1')).toEqual(['ghi-chu.txt']);
  });

  it('mọi chương về 0 và không còn segment ready nào', async () => {
    await storage.deleteBookAudio({ audioDir, bookId: 'book-1' });

    expect(chapters.audioBytesByBook('book-1')).toBe(0);
    expect(segments.listReadyByBook('book-1')).toEqual([]);
  });
});

describe('deleteReadAudio', () => {
  beforeEach(() => {
    chapters.insertMany([chapter({ id: 'chap-3', index: 2 })]);
    segments.insertMany([segment({ id: 'seg-4', chapterId: 'chap-3', index: 0 })]);
    generate('book-1', 'seg-1', 4000);
    generate('book-1', 'seg-2', 6000);
    generate('book-1', 'seg-3', 5000);
    generate('book-1', 'seg-4', 3000);
  });

  it('xoá chương TRƯỚC chương đang đọc, giữ chương đang đọc', async () => {
    // Đang đọc chap-2 → xoá chap-1, giữ chap-2 và chap-3
    books.markOpened('book-1', 5000, 'seg-3');
    const result = await storage.deleteReadAudio({ audioDir, bookId: 'book-1' });

    expect(result.freedBytes).toBe(10_000);
    expect(segments.findById('seg-3')?.status).toBe('ready');
    expect(segments.findById('seg-4')?.status).toBe('ready');
  });

  it('chưa đọc tới đâu thì KHÔNG xoá gì', async () => {
    // Nhầm ở đây là mất hàng giờ generate — mặc định phải là không làm gì.
    const result = await storage.deleteReadAudio({ audioDir, bookId: 'book-1' });

    expect(result.segments).toBe(0);
    expect(filesIn('book-1')).toHaveLength(8);
  });

  it('đang đọc chương đầu thì không có gì để xoá', async () => {
    books.markOpened('book-1', 5000, 'seg-1');
    const result = await storage.deleteReadAudio({ audioDir, bookId: 'book-1' });

    expect(result.segments).toBe(0);
    expect(segments.findById('seg-1')?.status).toBe('ready');
  });

  it('đang đọc chương cuối thì xoá hết chương trước', async () => {
    books.markOpened('book-1', 5000, 'seg-4');
    const result = await storage.deleteReadAudio({ audioDir, bookId: 'book-1' });

    expect(result.freedBytes).toBe(15_000);
    expect(segments.findById('seg-4')?.status).toBe('ready');
  });

  it('segment đọc dở không còn (sách nhập lại) thì không xoá gì', async () => {
    books.markOpened('book-1', 5000, 'seg-1');
    // Mô phỏng segment biến mất mà `last_segment_id` còn trỏ tới
    db.prepare('DELETE FROM segments WHERE id = ?').run('seg-1');

    const result = await storage.deleteReadAudio({ audioDir, bookId: 'book-1' });
    expect(result.segments).toBe(0);
  });
});

describe('usage', () => {
  it('cộng dung lượng theo sách và tổng', async () => {
    generate('book-1', 'seg-1', 4000);
    generate('book-1', 'seg-3', 5000);

    const usage = await storage.usage({ audioDir, warnBytes: 1024 ** 3 });

    expect(usage.audioBytes).toBe(9000);
    expect(usage.books).toHaveLength(1);
    expect(usage.books[0]?.audioBytes).toBe(9000);
    expect(usage.books[0]?.title).toBe('Kiếm Vực Thần Đế');
  });

  it('đếm số chương đủ audio', async () => {
    generate('book-1', 'seg-1', 4000);
    generate('book-1', 'seg-2', 6000);

    const usage = await storage.usage({ audioDir, warnBytes: 0 });

    // chap-1 đủ 2/2, chap-2 chưa có gì
    expect(usage.books[0]?.completeChapters).toBe(1);
    expect(usage.books[0]?.chapterCount).toBe(2);
  });

  it('đo dung lượng bản copy sách gốc', async () => {
    writeFileSync(join(libraryDirPath, 'book-1.pdf'), Buffer.alloc(2048));

    const usage = await storage.usage({ audioDir, warnBytes: 0 });
    expect(usage.books[0]?.bookFileBytes).toBe(2048);
  });

  it('file sách đã mất thì báo 0 chứ không ném', async () => {
    const usage = await storage.usage({ audioDir, warnBytes: 0 });
    expect(usage.books[0]?.bookFileBytes).toBe(0);
  });

  it('quét đĩa gồm cả file .json nên lớn hơn số DB', async () => {
    generate('book-1', 'seg-1', 4000);

    const usage = await storage.usage({ audioDir, warnBytes: 0 });

    expect(usage.audioBytes).toBe(4000);
    expect(usage.audioBytesOnDisk).toBeGreaterThan(4000);
  });

  it('phát hiện file mồ côi của sách không còn trong DB', async () => {
    generate('book-1', 'seg-1', 4000);
    // Sách bị xoá lúc app không chạy → thư mục audio còn lại
    mkdirSync(join(audioDir, 'book-da-xoa'), { recursive: true });
    writeFileSync(join(audioDir, 'book-da-xoa', 'seg-x.ogg'), Buffer.alloc(7000));

    const usage = await storage.usage({ audioDir, warnBytes: 0 });

    expect(usage.orphanFiles).toBe(1);
    expect(usage.orphanBytes).toBe(7000);
  });

  it('thư mục audio chưa tồn tại thì trả 0, không ném', async () => {
    const usage = await storage.usage({ audioDir: join(audioDir, 'chua-co'), warnBytes: 0 });

    expect(usage.audioBytesOnDisk).toBe(0);
    expect(usage.orphanFiles).toBe(0);
  });

  it('bỏ qua file lạ không phải của app', async () => {
    mkdirSync(join(audioDir, 'book-1'), { recursive: true });
    writeFileSync(join(audioDir, 'book-1', 'note.txt'), 'x'.repeat(500));

    const usage = await storage.usage({ audioDir, warnBytes: 0 });
    expect(usage.audioBytesOnDisk).toBe(0);
  });

  it('trả lại ngưỡng cảnh báo để UI không phải tự tra settings', async () => {
    const usage = await storage.usage({ audioDir, warnBytes: 12_345 });
    expect(usage.warnBytes).toBe(12_345);
  });
});

describe('deleteOrphans', () => {
  beforeEach(() => {
    generate('book-1', 'seg-1', 4000);
    mkdirSync(join(audioDir, 'book-da-xoa'), { recursive: true });
    writeFileSync(join(audioDir, 'book-da-xoa', 'seg-x.ogg'), Buffer.alloc(7000));
    writeFileSync(join(audioDir, 'book-da-xoa', 'seg-x.json'), '{}');
  });

  it('xoá file của sách không còn trong DB', async () => {
    const result = await storage.deleteOrphans({ audioDir });

    expect(result.files).toBe(2);
    expect(existsSync(join(audioDir, 'book-da-xoa'))).toBe(false);
  });

  it('KHÔNG đụng audio của sách còn trong thư viện', async () => {
    // Thư mục sách còn sống có thể đang chứa file mà job ghi dở
    await storage.deleteOrphans({ audioDir });

    expect(filesIn('book-1')).toEqual(['seg-1.json', 'seg-1.ogg']);
    expect(segments.findById('seg-1')?.status).toBe('ready');
  });

  it('không có gì mồ côi thì trả 0', async () => {
    await storage.deleteOrphans({ audioDir });
    const again = await storage.deleteOrphans({ audioDir });

    expect(again).toEqual({ files: 0, bytes: 0 });
  });
});

describe('removeBookFiles', () => {
  it('xoá bản copy sách gốc — nợ mục 8 của P1', async () => {
    writeFileSync(join(libraryDirPath, 'book-1.pdf'), Buffer.alloc(1024));
    generate('book-1', 'seg-1', 4000);

    await storage.removeBookFiles({ audioDir, book: book() });

    expect(existsSync(join(libraryDirPath, 'book-1.pdf'))).toBe(false);
  });

  it('xoá cả thư mục audio của sách', async () => {
    generate('book-1', 'seg-1', 4000);
    await storage.removeBookFiles({ audioDir, book: book() });

    expect(existsSync(join(audioDir, 'book-1'))).toBe(false);
  });

  it('sách chưa generate lần nào (không có thư mục audio) vẫn xoá được', async () => {
    writeFileSync(join(libraryDirPath, 'book-1.pdf'), Buffer.alloc(1024));

    await expect(storage.removeBookFiles({ audioDir, book: book() })).resolves.toBeUndefined();
    expect(existsSync(join(libraryDirPath, 'book-1.pdf'))).toBe(false);
  });

  it('file sách đã mất thì vẫn dọn audio, không ném', async () => {
    generate('book-1', 'seg-1', 4000);

    await expect(storage.removeBookFiles({ audioDir, book: book() })).resolves.toBeUndefined();
    expect(existsSync(join(audioDir, 'book-1'))).toBe(false);
  });
});

describe('chapterUsage', () => {
  it('trả từng chương kèm số segment đã có audio', () => {
    generate('book-1', 'seg-1', 4000);

    const rows = storage.chapterUsage('book-1');

    expect(rows).toHaveLength(2);
    expect(rows[0]?.readySegments).toBe(1);
    expect(rows[0]?.segmentCount).toBe(2);
    expect(rows[0]?.audioBytes).toBe(4000);
    expect(rows[1]?.readySegments).toBe(0);
  });

  it('giữ đúng thứ tự chương', () => {
    expect(storage.chapterUsage('book-1').map((c) => c.index)).toEqual([0, 1]);
  });

  it('sách không có chương trả mảng rỗng', () => {
    expect(storage.chapterUsage('khong-co')).toEqual([]);
  });
});

describe('xoá hàng loạt không block main thread', () => {
  it('xoá 300 segment vẫn nhả event loop giữa các lượt', async () => {
    // Một vol có ~4800 segment → 9600 file. Xoá tuần tự không nhả nhịp thì cửa
    // sổ đứng vài giây. Đo bằng cách đếm số lần macrotask chen được vào.
    const ids = Array.from({ length: 300 }, (_, i) => `bulk-${String(i)}`);
    segments.insertMany(
      ids.map((id, i) => segment({ id, chapterId: 'chap-2', index: i + 10 })),
    );
    for (const id of ids) generate('book-1', id, 100);

    let ticks = 0;
    const timer = setInterval(() => {
      ticks += 1;
    }, 0);

    await storage.deleteBookAudio({ audioDir, bookId: 'book-1' });
    clearInterval(timer);

    // 600 file / 64 mỗi lượt ≈ 10 lượt, mỗi lượt nhả một nhịp
    expect(ticks).toBeGreaterThan(3);
    expect(filesIn('book-1')).toEqual([]);
  });
});
