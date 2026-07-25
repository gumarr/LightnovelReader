import { describe, expect, it } from 'vitest';
import { bodyFontSize, scoreFontSize } from './font-size.js';
import type { Page, TextLine } from '../../cleaner/types.js';

const line = (text: string, fontSize?: number): TextLine => ({
  text,
  x: 50,
  y: 100,
  width: 300,
  height: 12,
  ...(fontSize === undefined ? {} : { fontSize }),
});

const page = (lines: TextLine[]): Page => ({
  pageNumber: 1,
  width: 432,
  height: 648,
  lines,
});

describe('bodyFontSize', () => {
  it('lấy cỡ chữ chiếm nhiều dòng nhất', () => {
    // Giống file mẫu VI: thân bài 10pt, tiêu đề 18pt
    const lines = [...Array.from({ length: 40 }, () => line('thân bài', 10)), line('Chương Một', 18)];
    expect(bodyFontSize([page(lines)])).toBe(10);
  });

  it('gộp thống kê qua nhiều trang', () => {
    const pages = [
      page(Array.from({ length: 5 }, () => line('a', 13))),
      page(Array.from({ length: 20 }, () => line('b', 10))),
    ];
    expect(bodyFontSize(pages)).toBe(10);
  });

  it('làm tròn cỡ chữ lẻ', () => {
    const lines = Array.from({ length: 10 }, () => line('x', 9.96));
    expect(bodyFontSize([page(lines)])).toBe(10);
  });

  it('bỏ qua dòng trống', () => {
    const lines = [...Array.from({ length: 10 }, () => line('   ', 30)), line('thật', 10)];
    expect(bodyFontSize([page(lines)])).toBe(10);
  });

  it('không có fontSize thì trả undefined', () => {
    expect(bodyFontSize([page([line('a'), line('b')])])).toBeUndefined();
  });

  it('trang rỗng trả undefined', () => {
    expect(bodyFontSize([page([])])).toBeUndefined();
  });
});

describe('scoreFontSize', () => {
  it('tiêu đề lớn hơn hẳn thân bài được điểm tối đa', () => {
    // File mẫu VI: 18pt trên nền 10pt = tỉ lệ 1.8
    expect(scoreFontSize(line('Chương Một', 18), 10)).toBe(1);
  });

  it('cỡ chữ bằng thân bài không được điểm', () => {
    // File mẫu EN: tiêu đề 13pt y hệt thân bài
    expect(scoreFontSize(line('Chapter 1 :', 13), 13)).toBe(0);
  });

  it('chênh lệch nhỏ coi như nhiễu', () => {
    expect(scoreFontSize(line('x', 10.5), 10)).toBe(0);
  });

  it('chấm điểm tuyến tính ở khoảng giữa', () => {
    // 1.25 nằm giữa 1.1 và 1.4 → khoảng 0.5
    expect(scoreFontSize(line('x', 12.5), 10)).toBeCloseTo(0.5, 1);
  });

  it('chữ nhỏ hơn thân bài không được điểm', () => {
    expect(scoreFontSize(line('footer', 8), 10)).toBe(0);
  });

  it('thiếu fontSize trả 0, không ném lỗi', () => {
    expect(scoreFontSize(line('x'), 10)).toBe(0);
    expect(scoreFontSize(line('x', 18), undefined)).toBe(0);
  });

  it('bodySize không hợp lệ trả 0', () => {
    expect(scoreFontSize(line('x', 18), 0)).toBe(0);
    expect(scoreFontSize(line('x', 18), -5)).toBe(0);
  });
});
