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
  errorCount: 0,
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

describe('SegmentRepository — số liệu ước lượng (P2.6)', () => {
  beforeEach(() => {
    books.insert(book());
    chapters.insertMany([
      chapter({ id: 'chap-1', index: 0 }),
      chapter({ id: 'chap-2', index: 1 }),
    ]);
  });

  it('đếm ký tự bằng SQL, không kéo text lên', () => {
    segments.insertMany([
      segment({ id: 'seg-1', chapterId: 'chap-1', index: 0, text: '12345' }),
      segment({ id: 'seg-2', chapterId: 'chap-1', index: 1, text: '1234567890' }),
    ]);

    expect(segments.pendingStatsByChapter('chap-1')).toEqual({
      segmentCount: 2,
      totalChars: 15,
    });
  });

  it('LENGTH đếm KÝ TỰ tiếng Việt, không đếm byte UTF-8', () => {
    // "Đường" là 5 ký tự nhưng 8 byte UTF-8. Đếm byte thì mọi ước lượng cho
    // sách tiếng Việt sẽ phồng lên gần gấp đôi.
    segments.insertMany([segment({ id: 'seg-1', chapterId: 'chap-1', text: 'Đường' })]);

    expect(segments.pendingStatsByChapter('chap-1').totalChars).toBe(5);
  });

  it('segment đã `ready` KHÔNG tính vào phần phải generate', () => {
    segments.insertMany([
      segment({ id: 'seg-1', chapterId: 'chap-1', index: 0, text: 'chưa xong' }),
      segment({ id: 'seg-2', chapterId: 'chap-1', index: 1, text: 'đã xong rồi' }),
    ]);
    segments.markReady('seg-2', {
      audioPath: 'D:/audio/book-1/seg-2.ogg',
      durationMs: 1000,
      audioBytes: 4096,
      alignStatus: 'estimated',
    });

    expect(segments.pendingStatsByChapter('chap-1')).toEqual({
      segmentCount: 1,
      totalChars: 'chưa xong'.length,
    });
  });

  it('thống kê cả sách gộp mọi chương', () => {
    segments.insertMany([
      segment({ id: 'seg-1', chapterId: 'chap-1', index: 0, text: '12345' }),
      segment({ id: 'seg-2', chapterId: 'chap-2', index: 0, text: '12345' }),
    ]);

    expect(segments.pendingStatsByBook('book-1')).toEqual({
      segmentCount: 2,
      totalChars: 10,
    });
  });

  it('sách khác không lẫn vào thống kê', () => {
    books.insert(book({ id: 'book-2', fileHash: 'hash-2' }));
    chapters.insertMany([chapter({ id: 'chap-x', bookId: 'book-2' })]);
    segments.insertMany([
      segment({ id: 'seg-1', chapterId: 'chap-1', text: '12345' }),
      segment({ id: 'seg-9', chapterId: 'chap-x', text: '123456789' }),
    ]);

    expect(segments.pendingStatsByBook('book-1').totalChars).toBe(5);
  });

  it('sách rỗng trả 0 chứ không phải NULL', () => {
    // COALESCE: SUM trên tập rỗng cho NULL, mà NULL đi tới UI thành "NaN B".
    expect(segments.pendingStatsByBook('book-1')).toEqual({ segmentCount: 0, totalChars: 0 });
  });

  it('listPendingByBook theo thứ tự chương rồi thứ tự đọc', () => {
    // Chèn ngược để chứng minh ORDER BY thật sự sắp lại, không ăn may thứ tự chèn
    segments.insertMany([
      segment({ id: 'seg-c2-1', chapterId: 'chap-2', index: 1 }),
      segment({ id: 'seg-c2-0', chapterId: 'chap-2', index: 0 }),
      segment({ id: 'seg-c1-1', chapterId: 'chap-1', index: 1 }),
      segment({ id: 'seg-c1-0', chapterId: 'chap-1', index: 0 }),
    ]);

    expect(segments.listPendingByBook('book-1').map((s) => s.id)).toEqual([
      'seg-c1-0',
      'seg-c1-1',
      'seg-c2-0',
      'seg-c2-1',
    ]);
  });

  it('listPendingByBook bỏ segment đã có audio', () => {
    segments.insertMany([
      segment({ id: 'seg-1', chapterId: 'chap-1', index: 0 }),
      segment({ id: 'seg-2', chapterId: 'chap-1', index: 1 }),
    ]);
    segments.markReady('seg-1', {
      audioPath: 'D:/audio/book-1/seg-1.ogg',
      durationMs: 1000,
      audioBytes: 4096,
      alignStatus: 'estimated',
    });

    expect(segments.listPendingByBook('book-1').map((s) => s.id)).toEqual(['seg-2']);
  });
});

describe('SegmentRepository — số liệu thống kê đọc (P5.4)', () => {
  beforeEach(() => {
    books.insert(book());
    chapters.insertMany([
      chapter({ id: 'chap-1', index: 0 }),
      chapter({ id: 'chap-2', index: 1 }),
    ]);
  });

  it('bookStats gộp bốn con số trong một lượt', () => {
    segments.insertMany([
      segment({ id: 'seg-1', chapterId: 'chap-1', index: 0 }),
      segment({ id: 'seg-2', chapterId: 'chap-1', index: 1 }),
      segment({ id: 'seg-3', chapterId: 'chap-2', index: 0 }),
    ]);
    segments.markReady('seg-1', {
      audioPath: 'D:/audio/book-1/seg-1.ogg',
      durationMs: 3000,
      audioBytes: 9000,
      alignStatus: 'estimated',
    });
    segments.markReady('seg-2', {
      audioPath: 'D:/audio/book-1/seg-2.ogg',
      durationMs: 2000,
      audioBytes: 6000,
      alignStatus: 'estimated',
    });

    expect(segments.bookStats('book-1')).toEqual({
      segmentCount: 3,
      readyCount: 2,
      totalDurationMs: 5000,
      totalAudioBytes: 15000,
    });
  });

  it('bookStats trên sách chưa generate gì trả 0, không phải NULL', () => {
    // `SUM` trên tập rỗng cho NULL; để lọt thì UI hiện "NaN phút"
    segments.insertMany([segment({ id: 'seg-1', chapterId: 'chap-1' })]);

    expect(segments.bookStats('book-1')).toEqual({
      segmentCount: 1,
      readyCount: 0,
      totalDurationMs: 0,
      totalAudioBytes: 0,
    });
  });

  it('bookStats trên sách không có segment nào trả 0 hết', () => {
    expect(segments.bookStats('book-1')).toEqual({
      segmentCount: 0,
      readyCount: 0,
      totalDurationMs: 0,
      totalAudioBytes: 0,
    });
  });

  it('bookStats không lẫn sách khác', () => {
    books.insert(book({ id: 'book-2', fileHash: 'hash-2' }));
    chapters.insertMany([chapter({ id: 'chap-x', bookId: 'book-2' })]);
    segments.insertMany([
      segment({ id: 'seg-1', chapterId: 'chap-1' }),
      segment({ id: 'seg-9', chapterId: 'chap-x' }),
    ]);

    expect(segments.bookStats('book-1').segmentCount).toBe(1);
  });

  it('countBefore đếm xuyên chương, không đếm lại từ 0 mỗi chương', () => {
    // Chính là lỗi mà truy vấn này sinh ra để tránh: `s.idx < ?` đơn thuần sẽ
    // trả 0 cho đoạn đầu chương 2 dù trước nó còn cả chương 1.
    segments.insertMany([
      segment({ id: 'seg-c1-0', chapterId: 'chap-1', index: 0 }),
      segment({ id: 'seg-c1-1', chapterId: 'chap-1', index: 1 }),
      segment({ id: 'seg-c2-0', chapterId: 'chap-2', index: 0 }),
      segment({ id: 'seg-c2-1', chapterId: 'chap-2', index: 1 }),
    ]);

    expect(segments.countBefore('seg-c1-0')).toBe(0);
    expect(segments.countBefore('seg-c1-1')).toBe(1);
    expect(segments.countBefore('seg-c2-0')).toBe(2);
    expect(segments.countBefore('seg-c2-1')).toBe(3);
  });

  it('countBefore không đếm segment của sách khác', () => {
    books.insert(book({ id: 'book-2', fileHash: 'hash-2' }));
    chapters.insertMany([chapter({ id: 'chap-x', bookId: 'book-2', index: 0 })]);
    segments.insertMany([
      segment({ id: 'seg-x', chapterId: 'chap-x', index: 0 }),
      segment({ id: 'seg-1', chapterId: 'chap-1', index: 0 }),
      segment({ id: 'seg-2', chapterId: 'chap-1', index: 1 }),
    ]);

    expect(segments.countBefore('seg-2')).toBe(1);
  });

  it('countBefore trên segment không tồn tại trả 0', () => {
    // Sách nhập lại thì `last_segment_id` trỏ vào segment đã mất — không được ném
    segments.insertMany([segment({ id: 'seg-1', chapterId: 'chap-1' })]);

    expect(segments.countBefore('không-có')).toBe(0);
  });
});

describe('ChapterRepository — dung lượng audio cả sách (P2.6)', () => {
  it('cộng audio_bytes của mọi chương', () => {
    books.insert(book());
    chapters.insertMany([
      chapter({ id: 'chap-1', index: 0 }),
      chapter({ id: 'chap-2', index: 1 }),
    ]);
    segments.insertMany([
      segment({ id: 'seg-1', chapterId: 'chap-1' }),
      segment({ id: 'seg-2', chapterId: 'chap-2' }),
    ]);

    segments.markReady('seg-1', {
      audioPath: 'D:/audio/book-1/seg-1.ogg',
      durationMs: 1000,
      audioBytes: 4000,
      alignStatus: 'estimated',
    });
    segments.markReady('seg-2', {
      audioPath: 'D:/audio/book-1/seg-2.ogg',
      durationMs: 1000,
      audioBytes: 6000,
      alignStatus: 'estimated',
    });

    expect(chapters.audioBytesByBook('book-1')).toBe(10_000);
  });

  it('sách chưa generate trả 0', () => {
    books.insert(book());
    chapters.insertMany([chapter()]);

    expect(chapters.audioBytesByBook('book-1')).toBe(0);
  });

  it('sách không tồn tại trả 0 chứ không NULL', () => {
    expect(chapters.audioBytesByBook('book-khong-co')).toBe(0);
  });
});

describe('SegmentRepository — xoá audio (P2.7)', () => {
  const ready = (bytes: number) => ({
    audioPath: 'D:/audio/book-1/seg.ogg',
    durationMs: 3000,
    audioBytes: bytes,
    alignStatus: 'estimated' as const,
  });

  beforeEach(() => {
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
    segments.markReady('seg-1', ready(4000));
    segments.markReady('seg-2', ready(6000));
    segments.markReady('seg-3', ready(5000));
  });

  it('liệt kê segment ĐÃ có audio — nguồn để biết file nào cần xoá', () => {
    segments.resetToPending('seg-2');
    // `resetToPending` không đụng segment `ready`, nên vẫn đủ hai
    expect(segments.listReadyByChapter('chap-1').map((s) => s.id)).toEqual(['seg-1', 'seg-2']);
  });

  it('chỉ liệt kê segment ready, bỏ segment chưa generate', () => {
    segments.insertMany([segment({ id: 'seg-4', chapterId: 'chap-1', index: 2 })]);

    expect(segments.listReadyByChapter('chap-1').map((s) => s.id)).toEqual(['seg-1', 'seg-2']);
  });

  it('liệt kê cả sách theo thứ tự chương rồi thứ tự đọc', () => {
    expect(segments.listReadyByBook('book-1').map((s) => s.id)).toEqual([
      'seg-1',
      'seg-2',
      'seg-3',
    ]);
  });

  it('xoá audio đưa segment về pending, KHÔNG để kẹt ở ready', () => {
    // Đây là lỗi cùng loại với 4.35: để nguyên `ready` cho file đã xoá thì
    // reader vẫn hiện nút phát cho một file không còn tồn tại.
    expect(segments.clearAudioByChapter('chap-1')).toBe(2);

    expect(segments.findById('seg-1')?.status).toBe('pending');
    expect(segments.findById('seg-2')?.status).toBe('pending');
  });

  it('xoá audio bỏ luôn audioPath, durationMs, audioBytes', () => {
    segments.clearAudioByChapter('chap-1');
    const found = segments.findById('seg-1');

    expect(found).not.toHaveProperty('audioPath');
    expect(found).not.toHaveProperty('durationMs');
    expect(found).not.toHaveProperty('audioBytes');
    expect(found?.alignStatus).toBe('none');
  });

  it('xoá audio tính lại dung lượng chương về 0', () => {
    segments.clearAudioByChapter('chap-1');

    expect(chapters.findById('chap-1')?.audioBytes).toBe(0);
    expect(chapters.findById('chap-1')?.generateStatus).toBe('none');
  });

  it('xoá một chương KHÔNG đụng chương khác', () => {
    segments.clearAudioByChapter('chap-1');

    expect(segments.findById('seg-3')?.status).toBe('ready');
    expect(chapters.findById('chap-2')?.audioBytes).toBe(5000);
  });

  it('xoá audio KHÔNG xoá tiến độ đọc — ràng buộc CLAUDE.md', () => {
    books.markOpened('book-1', 9000, 'seg-1');
    segments.clearAudioByChapter('chap-1');

    expect(books.findById('book-1')?.lastSegmentId).toBe('seg-1');
  });

  it('xoá audio KHÔNG xoá segment hay cấu trúc chương', () => {
    segments.clearAudioByChapter('chap-1');

    expect(segments.listByChapter('chap-1')).toHaveLength(2);
    expect(chapters.listByBook('book-1')).toHaveLength(2);
    expect(segments.findById('seg-1')?.text).toBe('Câu văn đầu tiên.');
  });

  it('xoá cả sách dọn mọi chương và mọi dung lượng', () => {
    expect(segments.clearAudioByBook('book-1')).toBe(3);

    expect(chapters.audioBytesByBook('book-1')).toBe(0);
    expect(segments.listReadyByBook('book-1')).toEqual([]);
  });

  it('xoá lần thứ hai trả 0 chứ không lỗi', () => {
    segments.clearAudioByChapter('chap-1');
    expect(segments.clearAudioByChapter('chap-1')).toBe(0);
  });

  it('KHÔNG đụng segment đang generating — job của nó còn chạy', () => {
    // Đưa segment đang chạy về `pending` sẽ đụng nhau với `markReady` của chính
    // job đó ngay sau, để lại DB nói `pending` cho file vừa ghi xong.
    segments.markGenerating('seg-3');
    segments.clearAudioByBook('book-1');

    expect(segments.findById('seg-3')?.status).toBe('generating');
  });

  it('chương không tồn tại trả 0', () => {
    expect(segments.clearAudioByChapter('khong-co')).toBe(0);
  });
});

describe('ChapterRepository — dung lượng toàn thư viện (P2.7)', () => {
  beforeEach(() => {
    books.insert(book({ id: 'book-1' }));
    books.insert(book({ id: 'book-2', fileHash: 'hash-2' }));
    chapters.insertMany([
      chapter({ id: 'chap-1', bookId: 'book-1', index: 0 }),
      chapter({ id: 'chap-2', bookId: 'book-2', index: 0 }),
    ]);
    segments.insertMany([
      segment({ id: 'seg-1', chapterId: 'chap-1' }),
      segment({ id: 'seg-2', chapterId: 'chap-2' }),
    ]);
    segments.markReady('seg-1', {
      audioPath: 'D:/audio/book-1/seg-1.ogg',
      durationMs: 1000,
      audioBytes: 3000,
      alignStatus: 'estimated',
    });
    segments.markReady('seg-2', {
      audioPath: 'D:/audio/book-2/seg-2.ogg',
      durationMs: 1000,
      audioBytes: 7000,
      alignStatus: 'estimated',
    });
  });

  it('trả dung lượng từng sách trong MỘT truy vấn', () => {
    const perBook = chapters.audioBytesPerBook();

    expect(perBook.get('book-1')).toBe(3000);
    expect(perBook.get('book-2')).toBe(7000);
  });

  it('sách chưa generate vẫn có mặt với 0 — không rơi khỏi bảng', () => {
    // Sách chưa có audio vẫn chiếm chỗ bằng bản copy file gốc; mất tích khỏi
    // danh sách thì user không xoá được nó từ Storage Manager.
    books.insert(book({ id: 'book-3', fileHash: 'hash-3' }));
    const perBook = chapters.audioBytesPerBook();

    expect(perBook.has('book-3')).toBe(true);
    expect(perBook.get('book-3')).toBe(0);
  });

  it('tổng toàn thư viện cộng mọi sách', () => {
    expect(chapters.audioBytesTotal()).toBe(10_000);
  });

  it('thư viện rỗng trả 0 chứ không NULL', () => {
    const empty = new Database(':memory:');
    applyConnectionPragmas(empty);
    migrate(empty);

    expect(createChapterRepository(empty).audioBytesTotal()).toBe(0);
    empty.close();
  });
});

describe('ChapterRepository — đếm segment lỗi (P2.7b)', () => {
  const ready = {
    audioPath: 'D:/audio/book-1/seg.ogg',
    durationMs: 3000,
    audioBytes: 4000,
    alignStatus: 'estimated' as const,
  };

  beforeEach(() => {
    books.insert(book());
    chapters.insertMany([chapter({ id: 'chap-1', index: 0 }), chapter({ id: 'chap-2', index: 1 })]);
    segments.insertMany([
      segment({ id: 'seg-1', chapterId: 'chap-1', index: 0 }),
      segment({ id: 'seg-2', chapterId: 'chap-1', index: 1 }),
      segment({ id: 'seg-3', chapterId: 'chap-2', index: 0 }),
    ]);
  });

  it('chương mới nhập chưa có lỗi nào', () => {
    expect(chapters.findById('chap-1')?.errorCount).toBe(0);
  });

  it('markError tăng số lỗi của chương', () => {
    segments.markError('seg-1', 'Piper không sinh ra audio nào');

    expect(chapters.findById('chap-1')?.errorCount).toBe(1);
  });

  it('đếm đúng nhiều segment lỗi trong cùng chương', () => {
    segments.markError('seg-1', 'lỗi');
    segments.markError('seg-2', 'lỗi');

    expect(chapters.findById('chap-1')?.errorCount).toBe(2);
  });

  it('KHÔNG tính lỗi của chương khác', () => {
    segments.markError('seg-3', 'lỗi');

    expect(chapters.findById('chap-1')?.errorCount).toBe(0);
    expect(chapters.findById('chap-2')?.errorCount).toBe(1);
  });

  it('markError hai lần cùng segment vẫn chỉ đếm một — tính LẠI, không cộng dồn', () => {
    // Job thử lại 3 lượt rồi mới hỏng hẳn; cộng dồn thì một segment thành 3 lỗi
    segments.markError('seg-1', 'lần một');
    segments.markError('seg-1', 'lần hai');

    expect(chapters.findById('chap-1')?.errorCount).toBe(1);
  });

  it('generate lại thành công thì hết lỗi', () => {
    segments.markError('seg-1', 'lỗi');
    segments.markReady('seg-1', ready);

    expect(chapters.findById('chap-1')?.errorCount).toBe(0);
  });

  it('resetToPending KHÔNG xoá lỗi — segment error không phải queued/generating', () => {
    // `pendingStmt` chỉ nhận `queued`/`generating`, nên segment `error` giữ
    // nguyên trạng thái. Số lỗi phải khớp với thực tế đó.
    segments.markError('seg-1', 'lỗi');
    segments.resetToPending('seg-1');

    expect(segments.findById('seg-1')?.status).toBe('error');
    expect(chapters.findById('chap-1')?.errorCount).toBe(1);
  });

  it('huỷ job của segment đang chờ thì số lỗi không đổi', () => {
    segments.markError('seg-1', 'lỗi');
    segments.markQueued('seg-2');
    segments.resetToPending('seg-2');

    expect(chapters.findById('chap-1')?.errorCount).toBe(1);
  });

  it('xoá audio cả chương thì lỗi cũng về 0', () => {
    // Xoá audio là bỏ hết dấu vết lượt generate trước, gồm cả segment lỗi:
    // `clearAudioByChapter` chỉ đụng `ready`, nhưng chương phải tính lại.
    segments.markReady('seg-1', ready);
    segments.markError('seg-2', 'lỗi');
    expect(chapters.findById('chap-1')?.errorCount).toBe(1);

    segments.clearAudioByChapter('chap-1');

    // seg-2 vẫn `error` (không phải `ready`) nên số lỗi vẫn là 1 — đúng thực tế
    expect(segments.findById('seg-2')?.status).toBe('error');
    expect(chapters.findById('chap-1')?.errorCount).toBe(1);
  });

  it('chương có lỗi vẫn lên complete khi mọi segment còn lại đã xong', () => {
    // `generate_status` xét `status = 'ready'`, nên chương có đoạn lỗi không bao
    // giờ `complete`. Đây là lý do phải hiện `errorCount` riêng ở UI.
    segments.markReady('seg-1', ready);
    segments.markError('seg-2', 'lỗi');

    expect(chapters.findById('chap-1')?.generateStatus).toBe('partial');
    expect(chapters.findById('chap-1')?.errorCount).toBe(1);
  });
});
