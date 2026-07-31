import { describe, expect, it, vi } from 'vitest';
import type { PronunciationOverride } from '@ln/shared';
import { createPronunciationHandlers } from './pronunciations.js';
import type { PronunciationRepository } from '../../db/repositories/pronunciations.js';

/**
 * Test handler `pronunciations:*` (P5.2, tầng 3 — plan.md mục 8.1).
 *
 * Trọng tâm là những thứ **biên này** quyết định chứ không phải repository:
 * chuẩn hoá `term` về chữ thường, cấm khoảng trắng trong cách đọc, và gộp mục
 * toàn cục với mục của sách.
 */

const entry = (overrides: Partial<PronunciationOverride> = {}): PronunciationOverride => ({
  id: 'p1',
  term: 'tokyo',
  replacement: 'Tô-ki-ô',
  createdAt: 1000,
  ...overrides,
});

type RepoOverrides = Partial<PronunciationRepository>;

const fakeRepo = (overrides: RepoOverrides = {}): PronunciationRepository => ({
  upsert: vi.fn(),
  remove: vi.fn(),
  listByBook: vi.fn(() => []),
  listGlobal: vi.fn(() => []),
  lookupTable: vi.fn(() => ({})),
  ...overrides,
});

const setup = (repo: PronunciationRepository = fakeRepo(), bookExists = true) =>
  createPronunciationHandlers({
    pronunciations: repo,
    bookExists: () => bookExists,
    newId: () => 'new-id',
    now: () => 2000,
  });

describe('list', () => {
  it('gộp mục của sách và mục toàn cục', () => {
    // User cần thấy VÌ SAO một từ đang đọc như vậy — nguyên nhân có thể nằm ở
    // mục toàn cục đặt từ lâu, không phải mục vừa sửa cho sách này.
    const repo = fakeRepo({
      listByBook: vi.fn(() => [entry({ id: 'b1', term: 'asuka', bookId: 'book-1' })]),
      listGlobal: vi.fn(() => [entry({ id: 'g1', term: 'tokyo' })]),
    });

    const result = setup(repo).list('book-1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.map((e) => e.id)).toEqual(['b1', 'g1']);
  });

  it('bookId rỗng bị từ chối', () => {
    expect(() => setup().list('')).toThrow();
  });
});

describe('save', () => {
  it('hạ term về chữ thường', () => {
    // Sidecar tra bảng theo khoá đã thường hoá; để "Tokyo" và "tokyo" thành hai
    // mục là dựng sẵn một mục không bao giờ khớp.
    const upsert = vi.fn();
    setup(fakeRepo({ upsert })).save({ term: '  ToKyO  ', replacement: 'Tô-ki-ô' });

    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ term: 'tokyo' }));
  });

  it('cấm khoảng trắng trong cách đọc', () => {
    // "Tô ki ô" khiến Piper chèn khoảng nghỉ giữa các âm tiết, nghe rời rạc
    // thành ba tiếng thay vì một cái tên (mục 4.62).
    expect(() => setup().save({ term: 'tokyo', replacement: 'Tô ki ô' })).toThrow(/gạch nối/);
  });

  it('cách đọc rỗng bị từ chối', () => {
    expect(() => setup().save({ term: 'tokyo', replacement: '   ' })).toThrow();
  });

  it('lưu theo sách khi có bookId', () => {
    const upsert = vi.fn();
    setup(fakeRepo({ upsert })).save({
      bookId: 'book-1',
      term: 'kaguya',
      replacement: 'Ka-gu-ya',
    });

    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ bookId: 'book-1' }));
  });

  it('bỏ bookId thì thành mục toàn cục', () => {
    const upsert = vi.fn();
    setup(fakeRepo({ upsert })).save({ term: 'tokyo', replacement: 'Tô-ki-ô' });

    const saved = upsert.mock.calls[0]?.[0] as PronunciationOverride | undefined;
    expect(saved).toBeDefined();
    expect(saved && 'bookId' in saved).toBe(false);
  });

  it('sách không tồn tại thì báo lỗi thay vì tạo mục mồ côi', () => {
    const result = setup(fakeRepo(), false).save({
      bookId: 'đã-xoá',
      term: 'tokyo',
      replacement: 'Tô-ki-ô',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_FOUND');
  });

  it('trả về bản trong DB, không phải bản vừa dựng', () => {
    // `upsert` ghi đè khi trùng `term`, nên id vừa sinh KHÔNG phải id thật nằm
    // trong DB. Renderer dùng id đó cho nút xoá — trả nhầm thì xoá trượt.
    const repo = fakeRepo({
      listGlobal: vi.fn(() => [entry({ id: 'id-đã-có', term: 'tokyo' })]),
    });

    const result = setup(repo).save({ term: 'tokyo', replacement: 'Tô-ki-ô' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.id).toBe('id-đã-có');
  });
});

describe('remove', () => {
  it('gọi repository xoá', () => {
    const remove = vi.fn();
    expect(setup(fakeRepo({ remove })).remove('p1').ok).toBe(true);
    expect(remove).toHaveBeenCalledWith('p1');
  });

  it('xoá mục không tồn tại vẫn OK', () => {
    // User muốn "đừng đọc theo cách đó nữa", mà điều đó đã đúng sẵn rồi.
    expect(setup().remove('không-có').ok).toBe(true);
  });

  it('id rỗng bị từ chối', () => {
    expect(() => setup().remove('')).toThrow();
  });
});
