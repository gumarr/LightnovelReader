import { describe, expect, it } from 'vitest';
import type { WordTiming } from '@ln/shared';
import { subtitleWords, wordIndexForTiming } from './subtitle';

/**
 * Test logic cắt từ và map timing → từ trên màn.
 *
 * Ca quan trọng nhất là **nhiều timing cùng trỏ một khoảng gốc** (hệ quả của
 * P3.5: `Tokyo` đọc thành ba mảnh `Tô-ki-ô`). Map sai chỗ này thì highlight
 * đứng im giữa tên riêng — mà tên riêng thì trang nào cũng có.
 */

const timing = (
  w: string,
  startMs: number,
  endMs: number,
  charStart: number,
  charEnd: number,
): WordTiming => ({ w, startMs, endMs, charStart, charEnd });

describe('subtitleWords', () => {
  it('cắt theo khoảng trắng, giữ vị trí ký tự trong text gốc', () => {
    expect(subtitleWords('Xin chào bạn')).toEqual([
      { text: 'Xin', charStart: 0, charEnd: 3 },
      { text: 'chào', charStart: 4, charEnd: 8 },
      { text: 'bạn', charStart: 9, charEnd: 12 },
    ]);
  });

  it('giữ nguyên dấu câu dính vào từ', () => {
    // Tách dấu câu ra thì highlight nhảy sang một `<span>` chỉ có dấu phẩy —
    // mắt user thấy như highlight biến mất.
    const words = subtitleWords('Ừ, được.');
    expect(words.map((w) => w.text)).toEqual(['Ừ,', 'được.']);
  });

  it('text rỗng cho danh sách rỗng', () => {
    expect(subtitleWords('')).toEqual([]);
    expect(subtitleWords('   ')).toEqual([]);
  });

  it('nhiều khoảng trắng liên tiếp không sinh từ rỗng', () => {
    const words = subtitleWords('a  b');
    expect(words.map((w) => w.text)).toEqual(['a', 'b']);
  });
});

describe('wordIndexForTiming', () => {
  const words = subtitleWords('Chuyến Shinkansen tới Tokyo.');

  it('timing khớp đúng từ tương ứng', () => {
    // 'Chuyến' = [0,7)
    expect(wordIndexForTiming(words, timing('Chuyến', 0, 400, 0, 7))).toBe(0);
    // 'tới' = [18,21)
    expect(wordIndexForTiming(words, timing('tới', 900, 1100, 18, 21))).toBe(2);
  });

  it('nhiều timing cùng trỏ một khoảng gốc đều ra cùng một từ', () => {
    // Hệ quả P3.5: `Tokyo` đọc thành `Tô-ki-ô`, sidecar trả ba timing mà cả ba
    // `charStart`/`charEnd` đều quy về khoảng của `Tokyo` = [22,28).
    const tokyo = [
      timing('Tô', 1100, 1250, 22, 28),
      timing('ki', 1250, 1400, 22, 28),
      timing('ô', 1400, 1550, 22, 28),
    ];
    for (const piece of tokyo) {
      expect(wordIndexForTiming(words, piece)).toBe(3);
    }
  });

  it('timing chồng một phần vẫn khớp — đoạn aligned có thể gộp/tách khác', () => {
    // CTC aligner gộp `tới Tokyo.` thành một mốc: giao khoảng vẫn trả từ đầu.
    expect(wordIndexForTiming(words, timing('tới Tô-ki-ô', 900, 1500, 18, 28))).toBe(2);
  });

  it('undefined (chưa tới từ nào) trả -1', () => {
    expect(wordIndexForTiming(words, undefined)).toBe(-1);
  });

  it('timing nằm ngoài mọi từ trả -1', () => {
    expect(wordIndexForTiming(words, timing('x', 0, 10, 900, 910))).toBe(-1);
  });

  it('danh sách từ rỗng trả -1, không ném', () => {
    expect(wordIndexForTiming([], timing('a', 0, 10, 0, 1))).toBe(-1);
  });

  it('khoảng chạm mép không tính là giao — nửa mở [start, end)', () => {
    // 'Chuyến' = [0,7), timing [7,10) là từ kế tiếp chứ không phải từ này.
    expect(wordIndexForTiming(words, timing('x', 0, 10, 7, 10))).not.toBe(0);
  });
});
