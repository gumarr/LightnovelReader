import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as Db } from 'better-sqlite3';
import type { Book, PronunciationOverride } from '@ln/shared';
import { applyConnectionPragmas, migrate } from '../migrator.js';
import { createBookRepository } from './books.js';
import {
  createPronunciationRepository,
  type PronunciationRepository,
} from './pronunciations.js';

/**
 * Chạy trên SQLite in-memory thật — ràng buộc `CHECK`, index một phần và ngữ
 * nghĩa `NULL` của SQLite không mock lại được cho đúng.
 */

let db: Db;
let repo: PronunciationRepository;

const entry = (overrides: Partial<PronunciationOverride> = {}): PronunciationOverride => ({
  id: 'pron-1',
  term: 'tokyo',
  replacement: 'Tô-ki-ô',
  createdAt: 1000,
  ...overrides,
});

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

beforeEach(() => {
  db = new Database(':memory:');
  applyConnectionPragmas(db);
  migrate(db);
  repo = createPronunciationRepository(db);

  const books = createBookRepository(db);
  books.insert(book());
  books.insert(book({ id: 'book-2', fileHash: 'hash-2' }));
});

afterEach(() => {
  db.close();
});

describe('thêm và đọc', () => {
  it('lưu rồi đọc lại được mục toàn cục', () => {
    repo.upsert(entry());
    expect(repo.listGlobal()).toEqual([entry()]);
  });

  it('lưu rồi đọc lại được mục theo sách', () => {
    repo.upsert(entry({ bookId: 'book-1' }));
    expect(repo.listByBook('book-1')).toEqual([entry({ bookId: 'book-1' })]);
  });

  it('mục toàn cục không lọt vào danh sách của sách', () => {
    repo.upsert(entry());
    expect(repo.listByBook('book-1')).toEqual([]);
  });

  it('mục của sách không lọt vào danh sách toàn cục', () => {
    repo.upsert(entry({ bookId: 'book-1' }));
    expect(repo.listGlobal()).toEqual([]);
  });

  it('mục của sách khác không lọt vào', () => {
    repo.upsert(entry({ bookId: 'book-2' }));
    expect(repo.listByBook('book-1')).toEqual([]);
  });

  it('hạ chữ thường khi lưu', () => {
    repo.upsert(entry({ term: 'TOKYO' }));
    expect(repo.listGlobal()[0]?.term).toBe('tokyo');
  });

  it('sắp xếp theo term', () => {
    repo.upsert(entry({ id: 'p1', term: 'osaka' }));
    repo.upsert(entry({ id: 'p2', term: 'kyoto' }));
    expect(repo.listGlobal().map((e) => e.term)).toEqual(['kyoto', 'osaka']);
  });
});

describe('ghi đè', () => {
  it('sửa cách đọc của cùng một term toàn cục', () => {
    repo.upsert(entry({ replacement: 'Tô-ki-ô' }));
    repo.upsert(entry({ id: 'pron-2', replacement: 'Đông-Kinh' }));

    const all = repo.listGlobal();
    expect(all).toHaveLength(1);
    expect(all[0]?.replacement).toBe('Đông-Kinh');
  });

  it('sửa cách đọc của cùng một term trong một sách', () => {
    repo.upsert(entry({ bookId: 'book-1', replacement: 'Tô-ki-ô' }));
    repo.upsert(entry({ id: 'pron-2', bookId: 'book-1', replacement: 'Đông-Kinh' }));

    const all = repo.listByBook('book-1');
    expect(all).toHaveLength(1);
    expect(all[0]?.replacement).toBe('Đông-Kinh');
  });

  it('cùng term ở sách khác nhau là hai mục riêng', () => {
    repo.upsert(entry({ id: 'p1', bookId: 'book-1', replacement: 'A' }));
    repo.upsert(entry({ id: 'p2', bookId: 'book-2', replacement: 'B' }));

    expect(repo.listByBook('book-1')[0]?.replacement).toBe('A');
    expect(repo.listByBook('book-2')[0]?.replacement).toBe('B');
  });

  it('mục toàn cục và mục của sách cùng term cùng tồn tại', () => {
    repo.upsert(entry({ id: 'p1', replacement: 'toàn-cục' }));
    repo.upsert(entry({ id: 'p2', bookId: 'book-1', replacement: 'của-sách' }));

    expect(repo.listGlobal()).toHaveLength(1);
    expect(repo.listByBook('book-1')).toHaveLength(1);
  });
});

describe('xoá', () => {
  it('xoá theo id', () => {
    repo.upsert(entry());
    repo.remove('pron-1');
    expect(repo.listGlobal()).toEqual([]);
  });

  it('xoá id không tồn tại không ném lỗi', () => {
    expect(() => repo.remove('không-có')).not.toThrow();
  });

  it('xoá sách thì mục của sách đó biến mất theo', () => {
    repo.upsert(entry({ bookId: 'book-1' }));
    db.prepare('DELETE FROM books WHERE id = ?').run('book-1');
    expect(repo.listByBook('book-1')).toEqual([]);
  });

  it('xoá sách không đụng tới mục toàn cục', () => {
    repo.upsert(entry());
    db.prepare('DELETE FROM books WHERE id = ?').run('book-1');
    expect(repo.listGlobal()).toHaveLength(1);
  });
});

describe('bảng tra gửi sang sidecar', () => {
  it('gộp mục toàn cục với mục của sách', () => {
    repo.upsert(entry({ id: 'p1', term: 'tokyo', replacement: 'Tô-ki-ô' }));
    repo.upsert(entry({ id: 'p2', bookId: 'book-1', term: 'asuka', replacement: 'A-xư-ca' }));

    expect(repo.lookupTable('book-1')).toEqual({
      tokyo: 'Tô-ki-ô',
      asuka: 'A-xư-ca',
    });
  });

  it('mục của sách thắng mục toàn cục khi trùng term', () => {
    repo.upsert(entry({ id: 'p1', term: 'tokyo', replacement: 'toàn-cục' }));
    repo.upsert(entry({ id: 'p2', bookId: 'book-1', term: 'tokyo', replacement: 'của-sách' }));

    expect(repo.lookupTable('book-1')['tokyo']).toBe('của-sách');
  });

  it('không lấy mục của sách khác', () => {
    repo.upsert(entry({ id: 'p1', bookId: 'book-2', term: 'tokyo', replacement: 'khác' }));
    expect(repo.lookupTable('book-1')).toEqual({});
  });

  it('sách chưa có mục nào trả bảng rỗng', () => {
    expect(repo.lookupTable('book-1')).toEqual({});
  });
});

describe('ràng buộc schema', () => {
  it('chặn term rỗng', () => {
    expect(() => repo.upsert(entry({ term: '' }))).toThrow();
  });

  it('chặn replacement rỗng', () => {
    expect(() => repo.upsert(entry({ replacement: '' }))).toThrow();
  });

  it('chặn bookId không tồn tại', () => {
    expect(() => repo.upsert(entry({ bookId: 'không-có' }))).toThrow();
  });
});
