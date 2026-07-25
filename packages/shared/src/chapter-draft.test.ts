import { describe, expect, it } from 'vitest';
import {
  hasBlockingIssue,
  mergeWithPrevious,
  nextDraftId,
  removeChapter,
  renameChapter,
  splitAt,
  toggleExcluded,
  validateDraft,
  type ChapterDraft,
} from './chapter-draft.js';

const draft = (
  id: string,
  title: string,
  pageStart: number,
  pageEnd: number,
  extra: Partial<ChapterDraft> = {},
): ChapterDraft => ({ id, title, pageStart, pageEnd, excluded: false, ...extra });

/** Ba chương liền mạch 1–10, 11–20, 21–30 */
const threeChapters = (): ChapterDraft[] => [
  draft('c1', 'Chương 1', 1, 10, { confidence: 5 }),
  draft('c2', 'Chương 2', 11, 20, { confidence: 4 }),
  draft('c3', 'Chương 3', 21, 30, { confidence: 3 }),
];

describe('nextDraftId', () => {
  it('lấy số lớn hơn ID lớn nhất đang có', () => {
    expect(nextDraftId(threeChapters())).toBe('c4');
  });

  it('bỏ qua ID không theo định dạng', () => {
    expect(nextDraftId([draft('từ-outline', 'X', 1, 2)])).toBe('c1');
  });

  it('không trùng khi ID có khoảng trống', () => {
    const chapters = [draft('c1', 'A', 1, 2), draft('c7', 'B', 3, 4)];
    expect(nextDraftId(chapters)).toBe('c8');
  });

  it('mảng rỗng trả c1', () => {
    expect(nextDraftId([])).toBe('c1');
  });
});

describe('mergeWithPrevious', () => {
  it('nuốt trọn vùng trang của chương sau', () => {
    const result = mergeWithPrevious(threeChapters(), 'c2');
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ id: 'c1', pageStart: 1, pageEnd: 20 });
    expect(result[1]).toMatchObject({ id: 'c3', pageStart: 21 });
  });

  it('giữ tên chương TRƯỚC, không phải chương bị gộp vào', () => {
    const result = mergeWithPrevious(threeChapters(), 'c2');
    expect(result[0]?.title).toBe('Chương 1');
  });

  it('bỏ confidence vì vùng trang đã khác vùng detector chấm điểm', () => {
    const result = mergeWithPrevious(threeChapters(), 'c2');
    expect(result[0]?.confidence).toBeUndefined();
  });

  it('không làm gì với chương đầu tiên — không có gì phía trước', () => {
    const before = threeChapters();
    expect(mergeWithPrevious(before, 'c1')).toEqual(before);
  });

  it('không làm gì với ID không tồn tại', () => {
    const before = threeChapters();
    expect(mergeWithPrevious(before, 'không-có')).toEqual(before);
  });

  it('không sửa mảng đầu vào', () => {
    const before = threeChapters();
    const snapshot = structuredClone(before);
    mergeWithPrevious(before, 'c2');
    expect(before).toEqual(snapshot);
  });

  it('gộp liên tiếp dồn được nhiều chương về một', () => {
    const once = mergeWithPrevious(threeChapters(), 'c2');
    const twice = mergeWithPrevious(once, 'c3');
    expect(twice).toHaveLength(1);
    expect(twice[0]).toMatchObject({ pageStart: 1, pageEnd: 30 });
  });
});

describe('splitAt', () => {
  it('trang tách thành trang ĐẦU của nửa sau', () => {
    const result = splitAt(threeChapters(), 'c1', 5);
    expect(result[0]).toMatchObject({ pageStart: 1, pageEnd: 4 });
    expect(result[1]).toMatchObject({ pageStart: 5, pageEnd: 10 });
  });

  it('giữ nguyên thứ tự các chương còn lại', () => {
    const result = splitAt(threeChapters(), 'c1', 5);
    expect(result.map((c) => c.pageStart)).toEqual([1, 5, 11, 21]);
  });

  it('nửa sau để tên rỗng để user buộc phải đặt tên', () => {
    const result = splitAt(threeChapters(), 'c1', 5);
    expect(result[1]?.title).toBe('');
  });

  it('nửa sau nhận ID mới không trùng', () => {
    const result = splitAt(threeChapters(), 'c1', 5);
    const ids = result.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('từ chối tách tại pageStart — nửa đầu sẽ rỗng', () => {
    const before = threeChapters();
    expect(splitAt(before, 'c1', 1)).toEqual(before);
  });

  it('từ chối tách ngoài vùng chương', () => {
    const before = threeChapters();
    expect(splitAt(before, 'c1', 11)).toEqual(before);
    expect(splitAt(before, 'c1', 0)).toEqual(before);
  });

  it('tách tại pageEnd cho nửa sau đúng một trang', () => {
    const result = splitAt(threeChapters(), 'c1', 10);
    expect(result[0]).toMatchObject({ pageStart: 1, pageEnd: 9 });
    expect(result[1]).toMatchObject({ pageStart: 10, pageEnd: 10 });
  });

  it('từ chối trang không nguyên', () => {
    const before = threeChapters();
    expect(splitAt(before, 'c1', 5.5)).toEqual(before);
  });

  it('chương một trang không tách được', () => {
    const before = [draft('c1', 'A', 3, 3)];
    expect(splitAt(before, 'c1', 3)).toEqual(before);
  });
});

describe('removeChapter', () => {
  it('KHÔNG nhập trang của chương bị xoá vào chương lân cận', () => {
    const result = removeChapter(threeChapters(), 'c2');
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ pageStart: 1, pageEnd: 10 });
    expect(result[1]).toMatchObject({ pageStart: 21, pageEnd: 30 });
  });

  it('khoảng trống sinh ra được validateDraft báo', () => {
    const issues = validateDraft(removeChapter(threeChapters(), 'c2'), 30);
    expect(issues).toContainEqual(
      expect.objectContaining({ kind: 'gap', message: 'Trang 11–20 không thuộc chương nào.' }),
    );
  });
});

describe('renameChapter / toggleExcluded', () => {
  it('đổi tên đúng chương, không đụng chương khác', () => {
    const result = renameChapter(threeChapters(), 'c2', 'Ngoại truyện');
    expect(result[1]?.title).toBe('Ngoại truyện');
    expect(result[0]?.title).toBe('Chương 1');
  });

  it('toggle hai lần quay về trạng thái cũ', () => {
    const once = toggleExcluded(threeChapters(), 'c2');
    expect(once[1]?.excluded).toBe(true);
    expect(toggleExcluded(once, 'c2')[1]?.excluded).toBe(false);
  });
});

describe('validateDraft', () => {
  it('cấu trúc liền mạch không có vấn đề gì', () => {
    expect(validateDraft(threeChapters(), 30)).toEqual([]);
  });

  it('chặn khi không còn chương nào được giữ', () => {
    const all = threeChapters().map((c) => ({ ...c, excluded: true }));
    const issues = validateDraft(all, 30);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: 'no-chapters', blocking: true });
  });

  it('chương bị loại trừ không tính vào khoảng trống', () => {
    const chapters = threeChapters().map((c) => (c.id === 'c2' ? { ...c, excluded: true } : c));
    const issues = validateDraft(chapters, 30);
    // c1 kết ở 10, c3 bắt đầu ở 21 → có gap, nhưng đó là do user cố ý loại c2
    expect(issues.map((i) => i.kind)).toEqual(['gap']);
    expect(hasBlockingIssue(issues)).toBe(false);
  });

  it('tên rỗng là lỗi chặn', () => {
    const chapters = renameChapter(threeChapters(), 'c2', '   ');
    const issues = validateDraft(chapters, 30);
    expect(issues).toContainEqual(
      expect.objectContaining({ kind: 'empty-title', chapterId: 'c2', blocking: true }),
    );
    expect(hasBlockingIssue(issues)).toBe(true);
  });

  it('trùng tên chỉ cảnh báo — sách thật có "Ngoại truyện" hai lần', () => {
    const chapters = renameChapter(threeChapters(), 'c2', 'Chương 1');
    const issues = validateDraft(chapters, 30);
    expect(issues).toContainEqual(
      expect.objectContaining({ kind: 'duplicate-title', blocking: false }),
    );
    expect(hasBlockingIssue(issues)).toBe(false);
  });

  it('so tên không phân biệt hoa thường và khoảng trắng thừa', () => {
    const chapters = renameChapter(threeChapters(), 'c2', '  chương 1  ');
    const issues = validateDraft(chapters, 30);
    expect(issues.some((i) => i.kind === 'duplicate-title')).toBe(true);
  });

  it('chồng trang là lỗi chặn', () => {
    const chapters = [draft('c1', 'A', 1, 15), draft('c2', 'B', 10, 20)];
    const issues = validateDraft(chapters, 20);
    expect(issues).toContainEqual(
      expect.objectContaining({ kind: 'overlap', chapterId: 'c2', blocking: true }),
    );
    expect(hasBlockingIssue(issues)).toBe(true);
  });

  it('khoảng trống một trang dùng câu chữ số ít', () => {
    const chapters = [draft('c1', 'A', 1, 10), draft('c2', 'B', 12, 20)];
    const issues = validateDraft(chapters, 20);
    expect(issues[0]?.message).toBe('Trang 11 không thuộc chương nào.');
  });

  it('vượt quá số trang của sách là lỗi chặn', () => {
    const issues = validateDraft([draft('c1', 'A', 1, 50)], 30);
    expect(issues).toContainEqual(
      expect.objectContaining({ kind: 'invalid-range', blocking: true }),
    );
  });

  it('pageEnd nhỏ hơn pageStart là lỗi chặn', () => {
    const issues = validateDraft([draft('c1', 'A', 10, 5)], 30);
    expect(issues).toContainEqual(
      expect.objectContaining({ kind: 'invalid-range', blocking: true }),
    );
  });

  it('không bắt buộc chương cuối phủ hết sách', () => {
    // Sách 30 trang nhưng chương cuối kết ở 25 — phần đuôi thường là quảng cáo
    const chapters = [draft('c1', 'A', 1, 10), draft('c2', 'B', 11, 25)];
    expect(validateDraft(chapters, 30)).toEqual([]);
  });

  it('không bắt buộc chương đầu bắt đầu từ trang 1', () => {
    // Bìa + mục lục ở đầu sách là chuyện bình thường
    expect(validateDraft([draft('c1', 'A', 5, 30)], 30)).toEqual([]);
  });

  it('gộp rồi kiểm lại thì hết chồng trang', () => {
    const chapters = [draft('c1', 'A', 1, 15), draft('c2', 'B', 10, 20)];
    const merged = mergeWithPrevious(chapters, 'c2');
    expect(validateDraft(merged, 20)).toEqual([]);
  });
});
