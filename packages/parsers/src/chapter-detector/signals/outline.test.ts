import { describe, expect, it } from 'vitest';
import { isUsableEntry, normalizeOutline, scoreOutline } from './outline.js';
import type { OutlineEntry } from '../types.js';

/** Outline thật của file mẫu VI */
const REAL_OUTLINE: OutlineEntry[] = [
  { title: 'Bản quyền', pageNumber: 11 },
  { title: 'Lời tác giả', pageNumber: 14 },
  { title: 'Mở đầu: Vầng trăng ngày ấy', pageNumber: 15 },
  { title: 'Chương Một: Trời mưa, có khả năng xuất hiện ước mơ', pageNumber: 17 },
  { title: 'Chương Hai: Đá văng ảo tưởng', pageNumber: 77 },
  { title: 'Chương Ba: Đêm xanh nơi bầu trời xa xôi mà một ngày nào đó ta sẽ nhớ', pageNumber: 133 },
  { title: 'Chương Bốn: Ngọn gió ngày mai', pageNumber: 203 },
  { title: 'Kết: Vầng trăng hôm nay', pageNumber: 241 },
  { title: 'Lời bạt', pageNumber: 243 },
  { title: 'Truyện ngắn: Nhà vua và sinh nhật', pageNumber: 245 },
];

describe('isUsableEntry', () => {
  it('nhận mục có tiêu đề và trang', () => {
    expect(isUsableEntry({ title: 'Chương Một', pageNumber: 17 })).toBe(true);
  });

  it('loại mục không có đích trang', () => {
    expect(isUsableEntry({ title: 'Chương Một' })).toBe(false);
  });

  it('loại mục tiêu đề rỗng', () => {
    expect(isUsableEntry({ title: '   ', pageNumber: 17 })).toBe(false);
  });

  it('loại số trang không hợp lệ', () => {
    expect(isUsableEntry({ title: 'X', pageNumber: 0 })).toBe(false);
  });
});

describe('normalizeOutline', () => {
  it('giữ nguyên mục không phải chương', () => {
    // "Bản quyền", "Lời bạt" vẫn phải còn — user tự loại ở màn xác nhận
    const result = normalizeOutline(REAL_OUTLINE);
    expect(result.map((e) => e.title)).toContain('Bản quyền');
    expect(result.map((e) => e.title)).toContain('Lời bạt');
    expect(result).toHaveLength(10);
  });

  it('sắp theo số trang', () => {
    const shuffled = [...REAL_OUTLINE].reverse();
    const pages = normalizeOutline(shuffled).map((e) => e.pageNumber);
    expect(pages).toEqual([...pages].sort((a, b) => a - b));
  });

  it('bỏ mục không có đích trang', () => {
    const withBroken = [...REAL_OUTLINE, { title: 'Hỏng' }];
    expect(normalizeOutline(withBroken)).toHaveLength(10);
  });

  it('gộp mục trùng trang, giữ mục đầu', () => {
    const entries: OutlineEntry[] = [
      { title: 'Chương Một', pageNumber: 17 },
      { title: 'Chương Một — phần a', pageNumber: 17 },
    ];
    const result = normalizeOutline(entries);
    expect(result).toHaveLength(1);
    expect(result[0]?.title).toBe('Chương Một');
  });

  it('outline rỗng trả mảng rỗng', () => {
    expect(normalizeOutline([])).toEqual([]);
  });
});

describe('scoreOutline', () => {
  const outline = normalizeOutline(REAL_OUTLINE);

  it('text khớp tiêu đề đạt điểm tối đa', () => {
    expect(scoreOutline('Chương Hai: Đá văng ảo tưởng', 77, outline)).toBe(1);
  });

  it('bỏ qua khác biệt hoa thường và dấu câu cuối', () => {
    expect(scoreOutline('CHƯƠNG HAI: ĐÁ VĂNG ẢO TƯỞNG.', 77, outline)).toBe(1);
  });

  it('tiêu đề dài bị PDF ngắt dòng vẫn khớp', () => {
    // Quan sát thật: trang 17 hiển thị "Chương Một: Trời mưa, có khả năng"
    expect(scoreOutline('Chương Một: Trời mưa, có khả năng', 17, outline)).toBe(1);
  });

  it('đúng trang nhưng khác text vẫn được điểm cao', () => {
    expect(scoreOutline('Một dòng khác hẳn', 77, outline)).toBe(0.8);
  });

  it('trang không có trong outline trả 0', () => {
    expect(scoreOutline('Chương Hai: Đá văng ảo tưởng', 50, outline)).toBe(0);
  });

  it('text rỗng trả 0', () => {
    expect(scoreOutline('   ', 77, outline)).toBe(0);
  });

  it('outline rỗng trả 0', () => {
    expect(scoreOutline('Chương Hai', 77, [])).toBe(0);
  });
});
