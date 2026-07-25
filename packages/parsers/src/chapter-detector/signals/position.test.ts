import { describe, expect, it } from 'vitest';
import { scorePosition, scoreSparsePage } from './position.js';
import type { Page, TextLine } from '../../cleaner/types.js';

const line = (text: string, y: number, height = 12): TextLine => ({
  text,
  x: 72,
  y,
  width: 400,
  height,
});

const page = (lines: TextLine[], pageNumber = 1): Page => ({
  pageNumber,
  width: 612,
  height: 792,
  lines,
});

/** Trang thân bài bình thường: dòng cách đều 17pt (giống file mẫu EN) */
const denseLines = (count: number, from = 84): TextLine[] =>
  Array.from({ length: count }, (_, i) => line(`dòng ${i}`, from + i * 17));

describe('scorePosition — đầu trang', () => {
  it('dòng đầu tiên của trang được điểm', () => {
    const p = page(denseLines(30));
    expect(scorePosition(p, 0)).toBeGreaterThanOrEqual(0.6);
  });

  it('dòng giữa trang không được điểm đầu trang', () => {
    const p = page(denseLines(30));
    expect(scorePosition(p, 20)).toBe(0);
  });

  it('dòng gần đỉnh vẫn tính là đầu trang', () => {
    const p = page(denseLines(30));
    // Dòng thứ 2 vẫn nằm trong 25% trên cùng
    expect(scorePosition(p, 1)).toBeGreaterThanOrEqual(0.6);
  });

  it('lineIndex ngoài phạm vi trả 0', () => {
    expect(scorePosition(page(denseLines(5)), 99)).toBe(0);
  });

  it('trang rỗng trả 0', () => {
    expect(scorePosition(page([]), 0)).toBe(0);
  });
});

describe('scorePosition — khoảng trắng phía trên', () => {
  it('dòng có khoảng hở lớn phía trên được cộng điểm', () => {
    // 20 dòng đều nhau, rồi một dòng cách xa hẳn
    const lines = [...denseLines(20), line('Chương Hai', 84 + 20 * 17 + 80)];
    const p = page(lines);
    expect(scorePosition(p, 20)).toBeGreaterThan(0);
  });

  it('dòng cách đều không được điểm khoảng trắng', () => {
    const p = page(denseLines(30));
    // Dòng giữa: không đầu trang, không khoảng hở → 0
    expect(scorePosition(p, 15)).toBe(0);
  });

  it('vừa đầu trang vừa có khoảng trắng lớn thì đạt tối đa', () => {
    // Dòng đầu ở y=84, dòng kế cách xa → nhưng dòng đầu không có gì phía trên
    const lines = [line('Chapter 1 :', 84), ...denseLines(20, 300)];
    const p = page(lines);
    // Dòng 0 là đầu trang (0.6), không có dòng trên nên không cộng 0.4
    expect(scorePosition(p, 0)).toBeCloseTo(0.6, 5);
  });

  it('sách giãn dòng thưa đều không bị cho điểm tràn lan', () => {
    // Mọi dòng cách nhau 40pt — thưa nhưng ĐỀU, không có tiêu đề
    const lines = Array.from({ length: 20 }, (_, i) => line(`dòng ${i}`, 84 + i * 52));
    const p = page(lines);
    expect(scorePosition(p, 10)).toBe(0);
  });

  it('điểm không bao giờ vượt 1', () => {
    const lines = [...denseLines(3), line('x', 500)];
    for (let i = 0; i < lines.length; i += 1) {
      expect(scorePosition(page(lines), i)).toBeLessThanOrEqual(1);
    }
  });
});

describe('scoreSparsePage', () => {
  const book = (): Page[] => [
    page(denseLines(37), 1),
    page(denseLines(37), 2),
    page(denseLines(5), 3), // trang mở chương
    page(denseLines(37), 4),
    page(denseLines(37), 5),
  ];

  it('trang ít dòng bất thường được điểm cao', () => {
    expect(scoreSparsePage(book(), 3)).toBeGreaterThan(0.8);
  });

  it('trang đầy đủ không được điểm', () => {
    expect(scoreSparsePage(book(), 1)).toBe(0);
  });

  it('trang trống hẳn không tính là mở chương', () => {
    // Trang ngăn cách hoàn toàn trống — không phải trang tiêu đề
    const pages = [...book(), page([], 6)];
    expect(scoreSparsePage(pages, 6)).toBe(0);
  });

  it('trang không tồn tại trả 0', () => {
    expect(scoreSparsePage(book(), 99)).toBe(0);
  });

  it('sách rỗng trả 0', () => {
    expect(scoreSparsePage([], 1)).toBe(0);
  });

  it('mọi trang đều thưa như nhau thì không trang nào nổi bật', () => {
    const pages = Array.from({ length: 5 }, (_, i) => page(denseLines(4), i + 1));
    expect(scoreSparsePage(pages, 1)).toBe(0);
  });
});
