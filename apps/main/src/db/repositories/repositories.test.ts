import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as Db } from 'better-sqlite3';
import type { Book, Chapter, Segment } from '@ln/shared';
import { applyConnectionPragmas, migrate } from '../migrator.js';
import { createBookRepository, type BookRepository } from './books.js';
import { createChapterRepository, type ChapterRepository } from './chapters.js';
import { createSegmentRepository, type SegmentRepository } from './segments.js';

/**
 * Chạy trên SQLite in-memory thật (không mock) — ràng buộc schema, CASCADE và
 * chuyển đổi NULL ↔ optional chỉ đúng khi đi qua DB thật.
 */

let db: Db;
let books: BookRepository;
let chapters: ChapterRepository;
let segments: SegmentRepository;

const book = (overrides: Partial<Book> = {}): Book => ({
  id: 'book-1',
  title: 'Kiếm Vực Thần Đế',
  format: 'pdf',
  filePath: 'D:\\lib\\book-1.pdf',
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
  pageStart: 1,
  pageEnd: 10,
  segmentCount: 0,
  audioBytes: 0,
  generateStatus: 'none',
  ...overrides,
});

const segment = (overrides: Partial<Segment> = {}): Segment => ({
  id: 'seg-1',
  chapterId: 'chap-1',
  index: 0,
  text: 'Câu văn đầu tiên.',
  anchor: { kind: 'pdf', page: 1, rects: [{ x: 72, y: 100, width: 400, height: 13 }] },
  status: 'pending',
  alignStatus: 'none',
  ...overrides,
});

beforeEach(() => {
  db = new Database(':memory:');
  applyConnectionPragmas(db);
  migrate(db);

  books = createBookRepository(db);
  chapters = createChapterRepository(db);
  segments = createSegmentRepository(db);
});

afterEach(() => {
  db.close();
});

describe('BookRepository', () => {
  it('lưu rồi đọc lại giữ nguyên giá trị', () => {
    books.insert(book());
    expect(books.findById('book-1')).toEqual(book());
  });

  it('field optional không có thì KHÔNG xuất hiện với giá trị undefined', () => {
    books.insert(book());
    const found = books.findById('book-1');

    // exactOptionalPropertyTypes: gán undefined tường minh khác hẳn với vắng mặt
    expect(found).not.toHaveProperty('author');
    expect(found).not.toHaveProperty('lastOpenedAt');
  });

  it('giữ nguyên field optional khi có giá trị', () => {
    books.insert(book({ author: 'Tác giả', coverPath: 'D:\\covers\\a.jpg', lastOpenedAt: 5000 }));
    const found = books.findById('book-1');

    expect(found?.author).toBe('Tác giả');
    expect(found?.lastOpenedAt).toBe(5000);
  });

  it('tìm được theo hash — dùng để phát hiện import trùng', () => {
    books.insert(book());
    expect(books.findByHash('hash-1')?.id).toBe('book-1');
    expect(books.findByHash('hash-khác')).toBeUndefined();
  });

  it('hash trùng bị schema từ chối', () => {
    books.insert(book());
    expect(() => books.insert(book({ id: 'book-2', fileHash: 'hash-1' }))).toThrow();
  });

  it('không tìm thấy trả undefined, không ném', () => {
    expect(books.findById('không-có')).toBeUndefined();
  });

  it('listRecent xếp sách mới mở lên đầu', () => {
    books.insert(book({ id: 'a', fileHash: 'h-a', addedAt: 1000 }));
    books.insert(book({ id: 'b', fileHash: 'h-b', addedAt: 2000 }));
    books.markOpened('a', 9000);

    expect(books.listRecent().map((b) => b.id)).toEqual(['a', 'b']);
  });

  it('sách chưa mở bao giờ xếp theo lúc thêm vào', () => {
    books.insert(book({ id: 'cũ', fileHash: 'h-1', addedAt: 1000 }));
    books.insert(book({ id: 'mới', fileHash: 'h-2', addedAt: 2000 }));

    expect(books.listRecent().map((b) => b.id)).toEqual(['mới', 'cũ']);
  });

  it('markOpened ghi lại vị trí đọc dở', () => {
    books.insert(book());
    books.markOpened('book-1', 5000, 'seg-42');

    const found = books.findById('book-1');
    expect(found?.lastOpenedAt).toBe(5000);
    expect(found?.lastSegmentId).toBe('seg-42');
  });

  it('markOpened không xoá vị trí cũ khi lần này chưa biết đọc tới đâu', () => {
    books.insert(book({ lastSegmentId: 'seg-10' }));
    books.markOpened('book-1', 7000);

    expect(books.findById('book-1')?.lastSegmentId).toBe('seg-10');
  });

  it('xoá sách kéo theo chương và segment (CASCADE)', () => {
    books.insert(book());
    chapters.insertMany([chapter()]);
    segments.insertMany([segment()]);

    expect(books.remove('book-1')).toBe(true);
    expect(chapters.listByBook('book-1')).toEqual([]);
    expect(segments.listByChapter('chap-1')).toEqual([]);
  });

  it('xoá sách không tồn tại trả false', () => {
    expect(books.remove('không-có')).toBe(false);
  });
});

describe('ChapterRepository', () => {
  beforeEach(() => {
    books.insert(book());
  });

  it('lưu nhiều chương và đọc lại theo đúng thứ tự', () => {
    chapters.insertMany([
      chapter({ id: 'c2', index: 1, title: 'Chương 2' }),
      chapter({ id: 'c1', index: 0, title: 'Chương 1' }),
    ]);

    expect(chapters.listByBook('book-1').map((c) => c.title)).toEqual(['Chương 1', 'Chương 2']);
  });

  it('chương DOCX không có trang thì field vắng mặt', () => {
    const { pageStart: _s, pageEnd: _e, ...noPages } = chapter();
    chapters.insertMany([noPages]);

    const found = chapters.findById('chap-1');
    expect(found).not.toHaveProperty('pageStart');
  });

  it('insertMany là một transaction — lỗi giữa chừng không để lại chương dở', () => {
    expect(() =>
      chapters.insertMany([
        chapter({ id: 'ok', index: 0 }),
        // index trùng vi phạm UNIQUE(book_id, idx)
        chapter({ id: 'hỏng', index: 0 }),
      ]),
    ).toThrow();

    expect(chapters.listByBook('book-1')).toEqual([]);
  });

  it('mảng rỗng không làm gì, không ném', () => {
    expect(() => chapters.insertMany([])).not.toThrow();
  });

  it('cập nhật được số segment', () => {
    chapters.insertMany([chapter()]);
    chapters.setSegmentCount('chap-1', 137);

    expect(chapters.findById('chap-1')?.segmentCount).toBe(137);
  });
});

describe('SegmentRepository', () => {
  beforeEach(() => {
    books.insert(book());
    chapters.insertMany([chapter()]);
  });

  it('anchor PDF đi qua JSON vẫn nguyên vẹn', () => {
    segments.insertMany([segment()]);
    const found = segments.findById('seg-1');

    expect(found?.anchor).toEqual({
      kind: 'pdf',
      page: 1,
      rects: [{ x: 72, y: 100, width: 400, height: 13 }],
    });
  });

  it('anchor DOCX đi qua JSON vẫn nguyên vẹn', () => {
    segments.insertMany([
      segment({ anchor: { kind: 'docx', nodePath: 'p:12', offset: 40 } }),
    ]);

    expect(segments.findById('seg-1')?.anchor).toEqual({
      kind: 'docx',
      nodePath: 'p:12',
      offset: 40,
    });
  });

  it('anchor hỏng thì ném rõ ràng, không trả neo giả', () => {
    db.prepare(
      `INSERT INTO segments (id, chapter_id, idx, text, anchor) VALUES (?, ?, ?, ?, ?)`,
    ).run('seg-hỏng', 'chap-1', 5, 'text', '"chuỗi chứ không phải object"');

    expect(() => segments.findById('seg-hỏng')).toThrow(/anchor không hợp lệ/);
  });

  it('đọc lại theo đúng thứ tự index', () => {
    segments.insertMany([
      segment({ id: 's3', index: 2, text: 'Ba.' }),
      segment({ id: 's1', index: 0, text: 'Một.' }),
      segment({ id: 's2', index: 1, text: 'Hai.' }),
    ]);

    expect(segments.listByChapter('chap-1').map((s) => s.text)).toEqual(['Một.', 'Hai.', 'Ba.']);
  });

  it('lưu được số lượng lớn trong một transaction', () => {
    // Sách 270 trang cho ~5000 segment — phải chịu được quy mô này
    const many = Array.from({ length: 5000 }, (_, i) =>
      segment({ id: `s${i}`, index: i, text: `Câu thứ ${i}.` }),
    );

    segments.insertMany(many);
    expect(segments.countByChapter('chap-1')).toBe(5000);
  });

  it('insertMany là một transaction — index trùng thì không lưu gì', () => {
    expect(() =>
      segments.insertMany([segment({ id: 'a', index: 0 }), segment({ id: 'b', index: 0 })]),
    ).toThrow();

    expect(segments.countByChapter('chap-1')).toBe(0);
  });

  it('segment chưa generate thì không có audioPath', () => {
    segments.insertMany([segment()]);
    const found = segments.findById('seg-1');

    expect(found).not.toHaveProperty('audioPath');
    expect(found?.status).toBe('pending');
    expect(found?.alignStatus).toBe('none');
  });
});

describe('SegmentRepository — vòng đời generate (P2.5)', () => {
  const ready = {
    audioPath: 'D:/audio/book-1/seg-1.ogg',
    durationMs: 2810,
    audioBytes: 9401,
    alignStatus: 'estimated' as const,
  };

  beforeEach(() => {
    books.insert(book());
    chapters.insertMany([chapter()]);
    segments.insertMany([segment({ id: 'seg-1', index: 0 }), segment({ id: 'seg-2', index: 1 })]);
  });

  it('đi qua đủ ba trạng thái queued → generating → ready', () => {
    segments.markQueued('seg-1');
    expect(segments.findById('seg-1')?.status).toBe('queued');

    segments.markGenerating('seg-1');
    expect(segments.findById('seg-1')?.status).toBe('generating');

    segments.markReady('seg-1', ready);
    expect(segments.findById('seg-1')?.status).toBe('ready');
  });

  it('ghi lại durationMs thật của sidecar, không ước lượng lại', () => {
    segments.markReady('seg-1', ready);
    const found = segments.findById('seg-1');

    expect(found?.durationMs).toBe(2810);
    expect(found?.audioBytes).toBe(9401);
    expect(found?.audioPath).toBe('D:/audio/book-1/seg-1.ogg');
  });

  it('timing phoneme lẫn ước lượng đều cho alignStatus estimated', () => {
    // Chỉ CTC ở Phase 4 mới được lên 'aligned'.
    segments.markReady('seg-1', ready);
    expect(segments.findById('seg-1')?.alignStatus).toBe('estimated');
  });

  it('cộng dung lượng lên chương', () => {
    segments.markReady('seg-1', ready);
    expect(chapters.findById('chap-1')?.audioBytes).toBe(9401);
  });

  it('generate lại KHÔNG đếm trùng dung lượng', () => {
    // Đổi bitrate hay đổi giọng là generate lại — cộng dồn thì storage manager
    // hiện số gấp đôi mà không có cách nào tự phát hiện.
    segments.markReady('seg-1', ready);
    segments.markReady('seg-1', { ...ready, audioBytes: 5000 });

    expect(chapters.findById('chap-1')?.audioBytes).toBe(5000);
  });

  it('mới xong một phần thì chương là partial', () => {
    segments.markReady('seg-1', ready);
    expect(chapters.findById('chap-1')?.generateStatus).toBe('partial');
  });

  it('xong hết thì chương là complete', () => {
    segments.markReady('seg-1', ready);
    segments.markReady('seg-2', ready);

    expect(chapters.findById('chap-1')?.generateStatus).toBe('complete');
  });

  it('lỗi thì giữ lại thông báo cho user', () => {
    segments.markError('seg-1', 'Voice chưa được cài');
    const found = segments.findById('seg-1');

    expect(found?.status).toBe('error');
    expect(found?.errorMessage).toBe('Voice chưa được cài');
  });

  it('generate lại thành công thì xoá lỗi cũ', () => {
    segments.markError('seg-1', 'lỗi tạm');
    segments.markReady('seg-1', ready);

    expect(segments.findById('seg-1')).not.toHaveProperty('errorMessage');
  });

  it('huỷ job thì segment về pending chứ không kẹt ở generating', () => {
    segments.markGenerating('seg-1');
    segments.resetToPending('seg-1');

    expect(segments.findById('seg-1')?.status).toBe('pending');
  });

  it('huỷ KHÔNG xoá audio đã có của segment đã xong', () => {
    // Job huỷ sau khi segment đã ready thì file .ogg vẫn nằm trên đĩa — đưa về
    // pending là nói dối, và user sẽ generate lại thứ đã có.
    segments.markReady('seg-1', ready);
    segments.resetToPending('seg-1');

    expect(segments.findById('seg-1')?.status).toBe('ready');
  });

  it('liệt kê được segment chưa có audio để enqueue', () => {
    segments.markReady('seg-1', ready);

    expect(segments.listPendingByChapter('chap-1').map((s) => s.id)).toEqual(['seg-2']);
  });

  it('tra ngược ra sách để dựng đường dẫn audio', () => {
    expect(segments.findBookId('seg-1')).toBe('book-1');
    expect(segments.findBookId('không-có')).toBeUndefined();
  });
});
