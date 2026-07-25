import { describe, expect, it } from 'vitest';
import { cleanPages, cleanText } from './cleaner.js';
import type { Page, TextLine } from './types.js';

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;

const line = (text: string, x: number, y: number, width = 400): TextLine => ({
  text,
  x,
  y,
  width,
  height: 12,
});

describe('cleanText — khối text không toạ độ', () => {
  it('de-hyphenate chạy trước merge dòng', () => {
    // Nếu merge chạy trước, dấu `\n` biến mất và gạch nối cuối dòng còn lại
    const input = 'Cô ấy là một thiếu-\nnữ xinh đẹp nhất trong vùng này.';
    expect(cleanText(input)).toBe('Cô ấy là một thiếunữ xinh đẹp nhất trong vùng này.');
  });

  it('nối cả từ ngắt lẫn dòng ngắt trong cùng đoạn', () => {
    const input = ['Hắn rút thanh kiếm ra khỏi vỏ rồi chậm', 'rãi tiến về phía trước mà không', 'nói thêm lời nào nữa.'].join(
      '\n',
    );
    expect(cleanText(input)).toBe(
      'Hắn rút thanh kiếm ra khỏi vỏ rồi chậm rãi tiến về phía trước mà không nói thêm lời nào nữa.',
    );
  });

  it('giữ ranh giới đoạn', () => {
    const input = 'Đoạn một kết thúc ở đây.\n\nĐoạn hai bắt đầu ở đây.';
    expect(cleanText(input).split('\n')).toHaveLength(2);
  });
});

describe('cleanPages — pipeline đầy đủ', () => {
  it('bỏ header/footer, sắp lại cột, rồi nối dòng', () => {
    // 6 trang hai cột, mỗi trang có tên sách ở đầu và số trang ở cuối
    const pages: Page[] = Array.from({ length: 6 }, (_, i) => {
      const n = i + 1;
      const lines: TextLine[] = [
        line('Kiếm Vực Thần Đế', 60, 20, 200),
        line(`- ${n} -`, 280, 815, 40),
      ];
      for (let row = 0; row < 6; row += 1) {
        // Bắt đầu dưới vùng lề trên (12% × 842 ≈ 101pt) để không lẫn header
        const y = 140 + row * 20;
        lines.push(line(`trái${n}-${row} còn tiếp`, 50, y, 200));
        lines.push(line(`phải${n}-${row} còn tiếp`, 320, y, 200));
      }
      return { pageNumber: n, width: PAGE_WIDTH, height: PAGE_HEIGHT, lines };
    });

    const cleaned = cleanPages(pages);

    expect(cleaned).toHaveLength(6);

    const first = cleaned[0]?.text ?? '';
    // Header/footer đã bị loại
    expect(first).not.toContain('Kiếm Vực Thần Đế');
    expect(first).not.toContain('- 1 -');
    // Cột trái đọc hết trước cột phải
    expect(first.indexOf('trái1-5')).toBeLessThan(first.indexOf('phải1-0'));
    // Các dòng chưa hết câu đã được nối lại
    expect(first).toContain('trái1-0 còn tiếp trái1-1');
  });

  it('giữ nguyên số trang để chapter detector còn ánh xạ được', () => {
    const pages: Page[] = [7, 8, 9].map((n) => ({
      pageNumber: n,
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT,
      lines: [line(`Nội dung trang ${n}.`, 50, 400)],
    }));

    expect(cleanPages(pages).map((p) => p.pageNumber)).toEqual([7, 8, 9]);
  });

  it('trang không có dòng nào cho ra text rỗng', () => {
    const pages: Page[] = [{ pageNumber: 1, width: PAGE_WIDTH, height: PAGE_HEIGHT, lines: [] }];
    expect(cleanPages(pages)[0]?.text).toBe('');
  });

  it('không sửa dữ liệu đầu vào', () => {
    const pages: Page[] = Array.from({ length: 6 }, (_, i) => ({
      pageNumber: i + 1,
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT,
      lines: [line('Header sách', 60, 20, 200), line('Thân bài chưa hết', 50, 400)],
    }));
    const before = pages.map((p) => p.lines.length);

    cleanPages(pages);

    expect(pages.map((p) => p.lines.length)).toEqual(before);
  });
});
