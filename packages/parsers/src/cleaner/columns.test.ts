import { describe, expect, it } from 'vitest';
import { detectColumnLayout, reorderColumns } from './columns.js';
import type { Page, TextLine } from './types.js';

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;

const line = (text: string, x: number, y: number, width: number): TextLine => ({
  text,
  x,
  y,
  width,
  height: 12,
});

const page = (lines: TextLine[]): Page => ({
  pageNumber: 1,
  width: PAGE_WIDTH,
  height: PAGE_HEIGHT,
  lines,
});

/** Trang hai cột: cột trái x=50 rộng 200, cột phải x=320 rộng 200, rãnh 70pt */
const twoColumnPage = (rows: number): Page => {
  const lines: TextLine[] = [];
  for (let i = 0; i < rows; i += 1) {
    const y = 100 + i * 20;
    lines.push(line(`trái ${i}`, 50, y, 200));
    lines.push(line(`phải ${i}`, 320, y, 200));
  }
  return page(lines);
};

/** Trang một cột: mọi dòng bắt đầu x=50, rộng gần hết vùng text */
const singleColumnPage = (rows: number): Page =>
  page(Array.from({ length: rows }, (_, i) => line(`dòng ${i}`, 50, 100 + i * 20, 470)));

describe('detectColumnLayout', () => {
  it('nhận ra trang hai cột', () => {
    const layout = detectColumnLayout(twoColumnPage(12));
    expect(layout.kind).toBe('two-column');
    if (layout.kind === 'two-column') {
      expect(layout.splitX).toBeGreaterThan(250);
      expect(layout.splitX).toBeLessThan(320);
    }
  });

  it('trang một cột không bị nhận nhầm', () => {
    expect(detectColumnLayout(singleColumnPage(12)).kind).toBe('single');
  });

  it('trang một cột có thụt đầu dòng vẫn là một cột', () => {
    const lines = Array.from({ length: 12 }, (_, i) =>
      line(`dòng ${i}`, i % 3 === 0 ? 70 : 50, 100 + i * 20, 450),
    );
    expect(detectColumnLayout(page(lines)).kind).toBe('single');
  });

  it('quá ít dòng thì không suy luận', () => {
    expect(detectColumnLayout(twoColumnPage(2)).kind).toBe('single');
  });

  it('rãnh quá hẹp không tính là hai cột', () => {
    // Rãnh 10pt < 4% × 595 ≈ 24pt
    const lines: TextLine[] = [];
    for (let i = 0; i < 12; i += 1) {
      const y = 100 + i * 20;
      lines.push(line('trái', 50, y, 200));
      lines.push(line('phải', 260, y, 200));
    }
    expect(detectColumnLayout(page(lines)).kind).toBe('single');
  });

  it('một bên quá ít dòng thì không tính là hai cột', () => {
    // Chỉ 1/13 dòng nằm bên phải — là ảnh chú thích, không phải cột
    const lines = Array.from({ length: 12 }, (_, i) => line('trái', 50, 100 + i * 20, 200));
    lines.push(line('chú thích', 400, 300, 100));
    expect(detectColumnLayout(page(lines)).kind).toBe('single');
  });

  it('tiêu đề chạy ngang hết trang không phá được nhận diện cột', () => {
    const target = twoColumnPage(12);
    const withTitle = page([line('CHƯƠNG MỘT', 50, 60, 470), ...target.lines]);
    expect(detectColumnLayout(withTitle).kind).toBe('two-column');
  });

  it('trang trống trả về một cột', () => {
    expect(detectColumnLayout(page([])).kind).toBe('single');
  });

  it('bỏ qua dòng chỉ có khoảng trắng', () => {
    const blanks = Array.from({ length: 20 }, (_, i) => line('   ', 50, 100 + i * 5, 200));
    expect(detectColumnLayout(page(blanks)).kind).toBe('single');
  });
});

describe('reorderColumns', () => {
  it('đọc hết cột trái rồi mới sang cột phải', () => {
    const result = reorderColumns(twoColumnPage(4));
    expect(result.lines.map((l) => l.text)).toEqual([
      'trái 0',
      'trái 1',
      'trái 2',
      'trái 3',
      'phải 0',
      'phải 1',
      'phải 2',
      'phải 3',
    ]);
  });

  it('sắp lại đúng kể cả khi thứ tự vẽ ban đầu lộn xộn', () => {
    const source = twoColumnPage(4);
    const shuffled = page([...source.lines].reverse());
    expect(reorderColumns(shuffled).lines.map((l) => l.text)).toEqual([
      'trái 0',
      'trái 1',
      'trái 2',
      'trái 3',
      'phải 0',
      'phải 1',
      'phải 2',
      'phải 3',
    ]);
  });

  it('tiêu đề chạy ngang đứng trước cả hai cột', () => {
    const body = twoColumnPage(6);
    const withTitle = page([...body.lines, line('CHƯƠNG MỘT', 50, 60, 470)]);
    expect(reorderColumns(withTitle).lines[0]?.text).toBe('CHƯƠNG MỘT');
  });

  it('trang một cột giữ nguyên thứ tự', () => {
    const source = singleColumnPage(12);
    expect(reorderColumns(source).lines.map((l) => l.text)).toEqual(
      source.lines.map((l) => l.text),
    );
  });

  it('không sửa trang đầu vào', () => {
    const source = twoColumnPage(4);
    const before = source.lines.map((l) => l.text);
    reorderColumns(source);
    expect(source.lines.map((l) => l.text)).toEqual(before);
  });

  it('không mất dòng nào', () => {
    const source = twoColumnPage(10);
    expect(reorderColumns(source).lines).toHaveLength(source.lines.length);
  });
});
