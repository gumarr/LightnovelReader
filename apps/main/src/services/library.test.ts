import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as Db } from 'better-sqlite3';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CleanedPage, Page } from '@ln/parsers';
import type { ChapterDraft } from '@ln/shared';
import { applyConnectionPragmas, migrate } from '../db/migrator.js';
import { createBookRepository, type BookRepository } from '../db/repositories/books.js';
import { createChapterRepository, type ChapterRepository } from '../db/repositories/chapters.js';
import { createSegmentRepository, type SegmentRepository } from '../db/repositories/segments.js';
import { createLibraryService, hashFileStream, type LibraryService } from './library.js';

let db: Db;
let workDir: string;
let books: BookRepository;
let chapters: ChapterRepository;
let segments: SegmentRepository;
let library: LibraryService;
let idCounter: number;

/** File nguồn giả — nội dung không quan trọng, chỉ cần copy và hash được */
const makeSourceFile = (name: string, content: string): string => {
  const path = join(workDir, name);
  writeFileSync(path, content, 'utf8');
  return path;
};

const draft = (
  id: string,
  title: string,
  pageStart: number,
  pageEnd: number,
): ChapterDraft => ({ id, title, pageStart, pageEnd, excluded: false });

const cleaned = (pageNumber: number, text: string): CleanedPage => ({ pageNumber, text });

const page = (pageNumber: number, text: string): Page => ({
  pageNumber,
  width: 612,
  height: 792,
  lines: [{ text, x: 72, y: 100, width: 400, height: 13 }],
});

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'ln-library-'));
  db = new Database(':memory:');
  applyConnectionPragmas(db);
  migrate(db);

  books = createBookRepository(db);
  chapters = createChapterRepository(db);
  segments = createSegmentRepository(db);

  idCounter = 0;
  library = createLibraryService({
    userData: workDir,
    books,
    chapters,
    segments,
    now: () => 1000,
    newId: () => `id-${(idCounter += 1)}`,
  });
});

afterEach(() => {
  db.close();
  rmSync(workDir, { recursive: true, force: true });
});

describe('hashFileStream', () => {
  it('cùng nội dung cho cùng hash', async () => {
    const a = makeSourceFile('a.pdf', 'nội dung giống nhau');
    const b = makeSourceFile('b.pdf', 'nội dung giống nhau');

    expect(await hashFileStream(a)).toBe(await hashFileStream(b));
  });

  it('khác nội dung cho khác hash', async () => {
    const a = makeSourceFile('a.pdf', 'nội dung A');
    const b = makeSourceFile('b.pdf', 'nội dung B');

    expect(await hashFileStream(a)).not.toBe(await hashFileStream(b));
  });

  it('trả về SHA-256 dạng hex', async () => {
    const hash = await hashFileStream(makeSourceFile('a.pdf', 'x'));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('save', () => {
  const input = (overrides = {}): Parameters<LibraryService['save']>[0] => ({
    filePath: makeSourceFile('sach.pdf', 'nội dung sách'),
    title: 'Sách thử',
    format: 'pdf' as const,
    lang: 'vi' as const,
    chapters: [draft('c1', 'Chương 1', 1, 2)],
    cleaned: [cleaned(1, 'Câu ở trang một.'), cleaned(2, 'Câu ở trang hai.')],
    ...overrides,
  });

  it('copy file gốc vào thư viện, không tham chiếu tại chỗ', async () => {
    const source = makeSourceFile('goc.pdf', 'nội dung gốc');
    const result = await library.save(input({ filePath: source }));

    expect(result.book.filePath).not.toBe(source);
    expect(existsSync(result.book.filePath)).toBe(true);
    expect(readFileSync(result.book.filePath, 'utf8')).toBe('nội dung gốc');
  });

  it('giữ đuôi file gốc', async () => {
    const result = await library.save(input());
    expect(result.book.filePath.endsWith('.pdf')).toBe(true);
  });

  it('lưu sách vào DB đọc lại được', async () => {
    const result = await library.save(input());
    const found = books.findById(result.book.id);

    expect(found?.title).toBe('Sách thử');
    expect(found?.format).toBe('pdf');
    expect(found?.lang).toBe('vi');
    expect(found?.addedAt).toBe(1000);
  });

  it('cắt khoảng trắng thừa quanh tên sách', async () => {
    const result = await library.save(input({ title: '  Sách thử  ' }));
    expect(result.book.title).toBe('Sách thử');
  });

  it('lưu chương theo đúng thứ tự đã xác nhận', async () => {
    const result = await library.save(
      input({
        chapters: [draft('c1', 'Chương 1', 1, 1), draft('c2', 'Chương 2', 2, 2)],
      }),
    );

    const saved = chapters.listByBook(result.book.id);
    expect(saved.map((c) => c.title)).toEqual(['Chương 1', 'Chương 2']);
    expect(saved.map((c) => c.index)).toEqual([0, 1]);
  });

  it('dựng segment cho từng chương và ghi lại segmentCount', async () => {
    const result = await library.save(input());
    const saved = chapters.listByBook(result.book.id);

    expect(result.segmentCount).toBeGreaterThan(0);
    expect(saved[0]?.segmentCount).toBe(result.segmentCount);
    expect(segments.countByChapter(saved[0]!.id)).toBe(result.segmentCount);
  });

  it('segment mang neo PDF có số trang đúng', async () => {
    const result = await library.save(
      input({ pages: [page(1, 'Câu ở trang một.'), page(2, 'Câu ở trang hai.')] }),
    );

    const chapterId = chapters.listByBook(result.book.id)[0]!.id;
    const saved = segments.listByChapter(chapterId);

    expect(saved[0]?.anchor).toMatchObject({ kind: 'pdf', page: 1 });
    expect(saved.at(-1)?.anchor).toMatchObject({ kind: 'pdf', page: 2 });
  });

  it('có trang gốc thì segment có rects để viewer highlight', async () => {
    const result = await library.save(input({ pages: [page(1, 'Câu ở trang một.')] }));
    const chapterId = chapters.listByBook(result.book.id)[0]!.id;
    const anchor = segments.listByChapter(chapterId)[0]?.anchor;

    if (anchor?.kind === 'pdf') expect(anchor.rects.length).toBeGreaterThan(0);
    else throw new Error('Neo phải là pdf');
  });

  it('DOCX dùng neo docx, không phải pdf', async () => {
    const result = await library.save(
      input({ filePath: makeSourceFile('sach.docx', 'nội dung'), format: 'docx' }),
    );

    const chapterId = chapters.listByBook(result.book.id)[0]!.id;
    expect(segments.listByChapter(chapterId)[0]?.anchor.kind).toBe('docx');
  });

  it('segment mới lưu ở trạng thái chưa generate', async () => {
    const result = await library.save(input());
    const chapterId = chapters.listByBook(result.book.id)[0]!.id;
    const first = segments.listByChapter(chapterId)[0];

    expect(first?.status).toBe('pending');
    expect(first?.alignStatus).toBe('none');
    expect(first).not.toHaveProperty('audioPath');
  });

  it('import lại đúng file đó trả về sách cũ, không tạo bản sao', async () => {
    const source = makeSourceFile('sach.pdf', 'nội dung sách');
    const first = await library.save(input({ filePath: source }));
    const second = await library.save(input({ filePath: source }));

    expect(second.duplicateOf?.id).toBe(first.book.id);
    expect(books.count()).toBe(1);
  });

  it('file khác nội dung nhưng cùng tên vẫn là sách mới', async () => {
    await library.save(input({ filePath: makeSourceFile('a.pdf', 'nội dung A') }));
    await library.save(input({ filePath: makeSourceFile('b.pdf', 'nội dung B') }));

    expect(books.count()).toBe(2);
  });

  it('chỉ dựng segment cho trang thuộc chương', async () => {
    const result = await library.save(
      input({
        chapters: [draft('c1', 'Chỉ trang 2', 2, 2)],
        cleaned: [cleaned(1, 'Không thuộc chương.'), cleaned(2, 'Thuộc chương.')],
      }),
    );

    const chapterId = chapters.listByBook(result.book.id)[0]!.id;
    const texts = segments.listByChapter(chapterId).map((s) => s.text);

    expect(texts.join(' ')).toContain('Thuộc chương');
    expect(texts.join(' ')).not.toContain('Không thuộc');
  });

  it('chương không có nội dung vẫn lưu được với 0 segment', async () => {
    const result = await library.save(
      input({ chapters: [draft('c1', 'Chương rỗng', 9, 9)] }),
    );

    expect(result.chapterCount).toBe(1);
    expect(result.segmentCount).toBe(0);
  });
});
