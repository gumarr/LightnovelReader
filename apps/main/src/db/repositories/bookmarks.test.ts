import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as Db } from 'better-sqlite3';
import type { Book, Bookmark, Chapter, Segment } from '@ln/shared';
import { applyConnectionPragmas, migrate } from '../migrator.js';
import { createBookRepository } from './books.js';
import { createChapterRepository } from './chapters.js';
import { createSegmentRepository } from './segments.js';
import { createBookmarkRepository, toExcerpt, type BookmarkRepository } from './bookmarks.js';

/**
 * Chạy trên SQLite in-memory thật: CASCADE và chuyển đổi NULL ↔ optional là hai
 * thứ mock không dựng lại được, mà cả hai đều quyết định hành vi ở đây.
 */

let db: Db;
let bookmarks: BookmarkRepository;

const LIMIT = 100;

const bookmark = (overrides: Partial<Bookmark> = {}): Bookmark => ({
  id: 'bm-1',
  bookId: 'book-1',
  segmentId: 'seg-1',
  createdAt: 5000,
  ...overrides,
});

/** Sách 2 chương × 2 segment — đủ để kiểm thứ tự xếp theo mạch đọc */
const seed = (): void => {
  const books = createBookRepository(db);
  const chapters = createChapterRepository(db);
  const segments = createSegmentRepository(db);

  const bookOf = (id: string, hash: string): Book => ({
    id,
    title: 'Kiếm Vực Thần Đế',
    format: 'pdf',
    filePath: `D:\\lib\\${id}.pdf`,
    fileHash: hash,
    lang: 'vi',
    addedAt: 1000,
  });
  books.insert(bookOf('book-1', 'hash-1'));
  // Sách thứ hai không có chương nào — chỉ để kiểm `book_id` có vào điều kiện
  // lọc không. Thiếu nó thì khoá ngoại chặn ngay ở lượt ghi.
  books.insert(bookOf('book-2', 'hash-2'));

  const chapterOf = (id: string, index: number, title: string): Chapter => ({
    id,
    bookId: 'book-1',
    index,
    title,
    segmentCount: 2,
    audioBytes: 0,
    errorCount: 0,
    generateStatus: 'none',
  });
  chapters.insertMany([chapterOf('chap-1', 0, 'Chương 1'), chapterOf('chap-2', 1, 'Chương 2')]);

  const segmentOf = (id: string, chapterId: string, index: number, text: string): Segment => ({
    id,
    chapterId,
    index,
    text,
    anchor: { kind: 'pdf', page: 1, rects: [] },
    status: 'pending',
    alignStatus: 'none',
  });
  segments.insertMany([
    segmentOf('seg-1', 'chap-1', 0, 'Câu đầu chương một.'),
    segmentOf('seg-2', 'chap-1', 1, 'Câu sau chương một.'),
    segmentOf('seg-3', 'chap-2', 0, 'Câu đầu chương hai.'),
  ]);
};

beforeEach(() => {
  db = new Database(':memory:');
  applyConnectionPragmas(db);
  migrate(db);
  seed();
  bookmarks = createBookmarkRepository(db);
});

afterEach(() => {
  db.close();
});

describe('toExcerpt', () => {
  it('giữ nguyên câu ngắn', () => {
    expect(toExcerpt('Câu ngắn.')).toBe('Câu ngắn.');
  });

  it('gộp khoảng trắng thừa — text segment có thể xuống dòng giữa câu', () => {
    expect(toExcerpt('Câu  có\nxuống dòng.')).toBe('Câu có xuống dòng.');
  });

  it('cắt ở ranh giới từ, không cắt giữa từ', () => {
    const text = `${'a'.repeat(100)} ${'b'.repeat(50)}`;
    const excerpt = toExcerpt(text);

    expect(excerpt).toBe(`${'a'.repeat(100)}…`);
    expect(excerpt).not.toContain('b');
  });

  it('cắt cứng khi cả trích đoạn không có khoảng trắng nào', () => {
    // Không có ranh giới từ nào để bám vào — thà cắt cứng còn hơn trả chuỗi rỗng
    const excerpt = toExcerpt('x'.repeat(200));

    expect(excerpt).toBe(`${'x'.repeat(120)}…`);
  });
});

describe('BookmarkRepository', () => {
  it('thêm rồi đọc lại được', () => {
    bookmarks.upsert(bookmark({ note: 'Chỗ hay' }));

    expect(bookmarks.findById('bm-1')).toEqual({
      id: 'bm-1',
      bookId: 'book-1',
      segmentId: 'seg-1',
      note: 'Chỗ hay',
      createdAt: 5000,
    });
  });

  it('không có ghi chú thì trường `note` vắng mặt, không phải chuỗi rỗng', () => {
    bookmarks.upsert(bookmark());

    expect(bookmarks.findById('bm-1')).not.toHaveProperty('note');
  });

  it('đánh dấu lại cùng segment thì cập nhật ghi chú, không tạo bản trùng', () => {
    bookmarks.upsert(bookmark({ id: 'bm-1', note: 'lần đầu' }));
    const id = bookmarks.upsert(bookmark({ id: 'bm-2', note: 'lần sau', createdAt: 9000 }));

    // Trả id CŨ: renderer dùng id này cho nút xoá, trả id vừa sinh là trỏ vào
    // hàng không tồn tại.
    expect(id).toBe('bm-1');
    expect(bookmarks.countByBook('book-1')).toBe(1);
    expect(bookmarks.findById('bm-1')?.note).toBe('lần sau');
    // `createdAt` giữ nguyên: đó là lúc user đánh dấu chỗ này lần đầu
    expect(bookmarks.findById('bm-1')?.createdAt).toBe(5000);
  });

  it('cùng segment nhưng khác sách là hai dấu trang riêng', () => {
    // Không xảy ra với dữ liệu thật (segment thuộc đúng một sách) nhưng khoá
    // lại điều kiện WHERE — thiếu `book_id` thì `upsert` gộp nhầm.
    bookmarks.upsert(bookmark({ id: 'bm-1', bookId: 'book-1' }));
    bookmarks.upsert(bookmark({ id: 'bm-2', bookId: 'book-2' }));

    expect(bookmarks.countByBook('book-1')).toBe(1);
    expect(bookmarks.countByBook('book-2')).toBe(1);
  });

  it('listByBook xếp theo mạch đọc chứ không theo lúc tạo', () => {
    // Tạo NGƯỢC thứ tự đọc: chương 2 trước, rồi mới tới hai đoạn chương 1
    bookmarks.upsert(bookmark({ id: 'bm-a', segmentId: 'seg-3', createdAt: 1 }));
    bookmarks.upsert(bookmark({ id: 'bm-b', segmentId: 'seg-2', createdAt: 2 }));
    bookmarks.upsert(bookmark({ id: 'bm-c', segmentId: 'seg-1', createdAt: 3 }));

    expect(bookmarks.listByBook('book-1', LIMIT).map((e) => e.bookmark.id)).toEqual([
      'bm-c',
      'bm-b',
      'bm-a',
    ]);
  });

  it('listByBook ghép sẵn tiêu đề chương và trích đoạn', () => {
    bookmarks.upsert(bookmark({ segmentId: 'seg-3' }));

    expect(bookmarks.listByBook('book-1', LIMIT)[0]).toMatchObject({
      chapterTitle: 'Chương 2',
      chapterIndex: 1,
      segmentIndex: 0,
      excerpt: 'Câu đầu chương hai.',
    });
  });

  it('listByBook tôn trọng trần số mục', () => {
    bookmarks.upsert(bookmark({ id: 'bm-1', segmentId: 'seg-1' }));
    bookmarks.upsert(bookmark({ id: 'bm-2', segmentId: 'seg-2' }));

    expect(bookmarks.listByBook('book-1', 1)).toHaveLength(1);
  });

  it('listByBook chỉ trả dấu trang của sách được hỏi', () => {
    bookmarks.upsert(bookmark({ id: 'bm-1', bookId: 'book-1' }));
    bookmarks.upsert(bookmark({ id: 'bm-2', bookId: 'book-2', segmentId: 'seg-2' }));

    expect(bookmarks.listByBook('book-1', LIMIT).map((e) => e.bookmark.id)).toEqual(['bm-1']);
  });

  it('updateNote sửa được và báo có đổi', () => {
    bookmarks.upsert(bookmark({ note: 'cũ' }));

    expect(bookmarks.updateNote('bm-1', 'mới')).toBe(true);
    expect(bookmarks.findById('bm-1')?.note).toBe('mới');
  });

  it('updateNote chuỗi rỗng là xoá ghi chú, dấu trang vẫn còn', () => {
    bookmarks.upsert(bookmark({ note: 'cũ' }));

    expect(bookmarks.updateNote('bm-1', '')).toBe(true);
    expect(bookmarks.findById('bm-1')).not.toHaveProperty('note');
    expect(bookmarks.countByBook('book-1')).toBe(1);
  });

  it('updateNote trên id không tồn tại báo không đổi gì', () => {
    // Handler dựa vào giá trị này để trả NOT_FOUND thay vì `ok` giả
    expect(bookmarks.updateNote('không-có', 'x')).toBe(false);
  });

  it('xoá rồi thì không tìm lại được', () => {
    bookmarks.upsert(bookmark());
    bookmarks.remove('bm-1');

    expect(bookmarks.findById('bm-1')).toBeUndefined();
    expect(bookmarks.countByBook('book-1')).toBe(0);
  });

  it('xoá id không tồn tại không ném lỗi', () => {
    expect(() => {
      bookmarks.remove('không-có');
    }).not.toThrow();
  });

  it('findEntryById trả kèm ngữ cảnh', () => {
    bookmarks.upsert(bookmark({ segmentId: 'seg-2', note: 'ghi chú' }));

    expect(bookmarks.findEntryById('bm-1')).toEqual({
      bookmark: {
        id: 'bm-1',
        bookId: 'book-1',
        segmentId: 'seg-2',
        note: 'ghi chú',
        createdAt: 5000,
      },
      chapterTitle: 'Chương 1',
      chapterIndex: 0,
      segmentIndex: 1,
      excerpt: 'Câu sau chương một.',
    });
  });

  it('xoá segment kéo theo dấu trang (CASCADE)', () => {
    // Xoá audio KHÔNG xoá segment nên không đụng dấu trang; nhưng nhập lại sách
    // thì segment cũ biến mất, và dấu trang trỏ vào chỗ không còn là rác.
    bookmarks.upsert(bookmark());
    db.prepare('DELETE FROM segments WHERE id = ?').run('seg-1');

    expect(bookmarks.findById('bm-1')).toBeUndefined();
  });

  it('xoá sách kéo theo dấu trang (CASCADE)', () => {
    bookmarks.upsert(bookmark());
    db.prepare('DELETE FROM books WHERE id = ?').run('book-1');

    expect(bookmarks.countByBook('book-1')).toBe(0);
  });
});
