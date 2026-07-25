import { describe, expect, it } from 'vitest';
import { SEGMENT_MAX_CHARS } from '@ln/shared';
import { segmentText } from './segmenter.js';

const texts = (input: string, options = {}): string[] =>
  segmentText(input, options).map((s) => s.text);

describe('bất biến — không segment nào vượt ngưỡng', () => {
  it('mặc định mọi segment ≤ SEGMENT_MAX_CHARS', () => {
    const input = 'Đây là một câu văn dài. '.repeat(200);
    for (const segment of segmentText(input)) {
      expect(segment.text.length).toBeLessThanOrEqual(SEGMENT_MAX_CHARS);
    }
  });

  it('tôn trọng maxChars tuỳ chỉnh', () => {
    const input = 'Một câu ngắn. Câu nữa đây. Và câu thứ ba nhé.';
    for (const segment of segmentText(input, { maxChars: 30 })) {
      expect(segment.text.length).toBeLessThanOrEqual(30);
    }
  });

  it('câu đơn dài hơn ngưỡng vẫn bị cắt xuống dưới ngưỡng', () => {
    const input = `${'từ '.repeat(200)}kết thúc.`;
    for (const segment of segmentText(input)) {
      expect(segment.text.length).toBeLessThanOrEqual(SEGMENT_MAX_CHARS);
    }
  });

  it('chuỗi dài không có khoảng trắng vẫn bị cắt cứng', () => {
    const input = 'x'.repeat(1000);
    const result = segmentText(input);
    expect(result.length).toBeGreaterThan(1);
    for (const segment of result) {
      expect(segment.text.length).toBeLessThanOrEqual(SEGMENT_MAX_CHARS);
    }
  });
});

describe('gom câu', () => {
  it('gom nhiều câu ngắn vào một segment', () => {
    const result = texts('Một. Hai. Ba.');
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('Một. Hai. Ba.');
  });

  it('không gom quá maxSentences câu', () => {
    const result = texts('A rồi. B rồi. C rồi. D rồi. E rồi. F rồi.', {
      maxSentences: 2,
      minChars: 0,
    });
    expect(result).toEqual(['A rồi. B rồi.', 'C rồi. D rồi.', 'E rồi. F rồi.']);
  });

  it('mặc định gom tối đa 3 câu', () => {
    const sentence = 'Câu văn vừa phải ở đây. ';
    const result = segmentText(sentence.repeat(6).trim());
    for (const segment of result) {
      const count = segment.text.split(/(?<=\.)\s+/).length;
      expect(count).toBeLessThanOrEqual(3);
    }
  });

  it('xuống segment mới khi thêm câu sẽ vượt maxChars', () => {
    const result = texts('Câu dài khoảng ba mươi ký tự. Câu thứ hai dài tương tự vậy.', {
      maxChars: 40,
      minChars: 0,
    });
    expect(result).toHaveLength(2);
  });
});

describe('cắt câu dài', () => {
  it('ưu tiên cắt tại dấu phẩy', () => {
    const input = `${'a'.repeat(60)}, ${'b'.repeat(60)}.`;
    const result = texts(input, { maxChars: 80, minChars: 0 });
    expect(result[0]?.endsWith(',')).toBe(true);
  });

  it('ưu tiên dấu chấm phẩy hơn dấu phẩy', () => {
    const input = `${'a'.repeat(30)}, ${'b'.repeat(20)}; ${'c'.repeat(30)}.`;
    const result = texts(input, { maxChars: 60, minChars: 0 });
    expect(result[0]?.endsWith(';')).toBe(true);
  });

  it('lùi về khoảng trắng khi không có dấu câu', () => {
    const input = `${'từ '.repeat(50)}hết.`;
    const result = texts(input, { maxChars: 50, minChars: 0 });
    for (const segment of result) {
      expect(segment.length).toBeLessThanOrEqual(50);
    }
    expect(result.length).toBeGreaterThan(1);
  });

  it('không cắt quá sát đầu câu', () => {
    // Dấu phẩy ở vị trí rất sớm — không nên cắt ngay ở đó
    const input = `ab, ${'c'.repeat(90)}.`;
    const result = texts(input, { maxChars: 50, minChars: 0 });
    expect(result[0]?.length).toBeGreaterThan(10);
  });
});

describe('gộp segment ngắn', () => {
  it('gộp mảnh quá ngắn vào segment trước', () => {
    const result = texts('Đây là câu văn có độ dài bình thường. Ừ.', { maxChars: 300 });
    expect(result).toHaveLength(1);
  });

  it('không gộp nếu vượt maxChars', () => {
    // Câu đầu 299 ký tự — thêm "Ừ." nữa sẽ vượt 300 nên phải tách riêng
    const result = texts(`${'a'.repeat(298)}. Ừ.`, { maxChars: 300 });
    expect(result).toHaveLength(2);
  });

  it('không gộp vượt quá maxSentences', () => {
    // Bước gom đã tách theo maxSentences, bước gộp không được phá vỡ
    const result = segmentText('Ừ. Ok. Rồi. Xong.', { maxSentences: 2, minChars: 20 });
    for (const segment of result) {
      const count = segment.text.split(/(?<=\.)\s+/).length;
      expect(count).toBeLessThanOrEqual(2);
    }
  });

  it('minChars = 0 thì không gộp gì', () => {
    const result = texts('Ừ. Ok.', { minChars: 0, maxSentences: 1 });
    expect(result).toEqual(['Ừ.', 'Ok.']);
  });
});

describe('vị trí start/end', () => {
  it('trỏ đúng vào chuỗi gốc', () => {
    const input = 'Câu một ở đây. Câu hai ở đây. Câu ba ở đây.';
    for (const segment of segmentText(input, { maxSentences: 1, minChars: 0 })) {
      expect(input.slice(segment.start, segment.end)).toBe(segment.text);
    }
  });

  it('vị trí tăng dần', () => {
    const input = 'Một câu. Hai câu. Ba câu. Bốn câu.';
    const result = segmentText(input, { maxSentences: 1, minChars: 0 });
    for (let i = 1; i < result.length; i += 1) {
      const prev = result[i - 1];
      const curr = result[i];
      if (prev === undefined || curr === undefined) expect.unreachable('phải có phần tử');
      expect(curr.start).toBeGreaterThanOrEqual(prev.end);
    }
  });

  it('start/end đúng cả khi cắt câu dài', () => {
    const input = `${'a'.repeat(60)}, ${'b'.repeat(60)}.`;
    for (const segment of segmentText(input, { maxChars: 80, minChars: 0 })) {
      expect(input.slice(segment.start, segment.end)).toBe(segment.text);
    }
  });
});

describe('ranh giới đoạn', () => {
  it('không gộp hai đoạn vào cùng một segment', () => {
    // Sau cleaner, `\n` là ranh giới đoạn đã xác định
    const input = 'Chương Một: Trời mưa\nHắn bước vào phòng.';
    expect(texts(input)).toEqual(['Chương Một: Trời mưa', 'Hắn bước vào phòng.']);
  });

  it('segment không bao giờ chứa ký tự xuống dòng', () => {
    // Lỗi thật gặp khi nối parser vào cleaner: segment ôm cả khối nhiều dòng
    const input = ['Mục lục', 'Bản quyền11', 'Lời tác giả14', 'Mở đầu15'].join('\n');
    for (const segment of segmentText(input)) {
      expect(segment.text).not.toContain('\n');
    }
  });

  it('đoạn ngắn không bị gộp ngược lại ở bước merge', () => {
    // mergeShortSegments phải tôn trọng ranh giới, nếu không nó dán lại
    // đúng cái mà bước gom vừa tách ra
    const input = 'A.\nB.\nC.';
    expect(texts(input)).toEqual(['A.', 'B.', 'C.']);
  });

  it('vẫn gom bình thường trong cùng một đoạn', () => {
    const input = 'Câu một. Câu hai. Câu ba.';
    expect(texts(input)).toHaveLength(1);
  });

  it('nhận CRLF như ranh giới đoạn', () => {
    expect(texts('Đoạn một.\r\nĐoạn hai.')).toEqual(['Đoạn một.', 'Đoạn hai.']);
  });
});

describe('trường hợp biên', () => {
  it('chuỗi rỗng cho mảng rỗng', () => {
    expect(segmentText('')).toEqual([]);
    expect(segmentText('   \n  ')).toEqual([]);
  });

  it('một câu ngắn cho một segment', () => {
    expect(texts('Xin chào.')).toEqual(['Xin chào.']);
  });

  it('không sinh segment rỗng hay chỉ khoảng trắng', () => {
    const input = 'Một.   \n\n   Hai.    Ba.';
    for (const segment of segmentText(input)) {
      expect(segment.text.trim()).toBe(segment.text);
      expect(segment.text.length).toBeGreaterThan(0);
    }
  });

  it('từ chối maxChars không hợp lệ', () => {
    expect(() => segmentText('abc', { maxChars: 0 })).toThrow(/maxChars/);
    expect(() => segmentText('abc', { maxSentences: 0 })).toThrow(/maxSentences/);
  });

  it('giữ nguyên hội thoại kiểu LN', () => {
    const input = '「Cậu đi đâu đấy?」 Tôi hỏi. 「Về nhà.」 Cậu ấy đáp.';
    const result = segmentText(input);
    expect(result.map((s) => s.text).join(' ')).toBe(input);
  });

  it('chương dài xử lý được trong thời gian hợp lý', () => {
    const chapter = 'Đây là một câu văn có độ dài trung bình trong tiểu thuyết. '.repeat(2000);
    const started = Date.now();
    const result = segmentText(chapter);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(result.length).toBeGreaterThan(100);
  });
});
