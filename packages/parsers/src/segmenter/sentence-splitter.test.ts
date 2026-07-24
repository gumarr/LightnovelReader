import { describe, expect, it } from 'vitest';
import { splitSentences } from './sentence-splitter.js';

const texts = (input: string): string[] => splitSentences(input).map((s) => s.text);

describe('tách câu cơ bản', () => {
  it('trả mảng rỗng với chuỗi rỗng hoặc chỉ khoảng trắng', () => {
    expect(splitSentences('')).toEqual([]);
    expect(splitSentences('   \n\t ')).toEqual([]);
  });

  it('tách theo dấu chấm', () => {
    expect(texts('Trời mưa. Tôi ở nhà.')).toEqual(['Trời mưa.', 'Tôi ở nhà.']);
  });

  it('tách theo dấu hỏi và chấm than', () => {
    expect(texts('Cậu khỏe không? Tớ ổn!')).toEqual(['Cậu khỏe không?', 'Tớ ổn!']);
  });

  it('giữ câu cuối không có dấu kết thúc', () => {
    expect(texts('Câu một. Câu hai chưa xong')).toEqual(['Câu một.', 'Câu hai chưa xong']);
  });

  it('gộp dấu kết thúc lặp vào cùng câu', () => {
    expect(texts('Thật sao?! Không thể nào...')).toEqual(['Thật sao?!', 'Không thể nào...']);
  });

  it('xử lý dấu ba chấm một ký tự', () => {
    expect(texts('Ừm… Được rồi.')).toEqual(['Ừm…', 'Được rồi.']);
  });

  it('bỏ qua khoảng trắng thừa giữa các câu', () => {
    expect(texts('Một.    Hai.\n\nBa.')).toEqual(['Một.', 'Hai.', 'Ba.']);
  });
});

describe('không tách nhầm', () => {
  it('số thập phân', () => {
    expect(texts('Giá là 3.14 đồng.')).toEqual(['Giá là 3.14 đồng.']);
  });

  it('số có phân cách nghìn', () => {
    expect(texts('Dân số 1.000.000 người.')).toEqual(['Dân số 1.000.000 người.']);
  });

  it('viết tắt tiếng Việt', () => {
    expect(texts('Anh ấy sống ở TP. Hồ Chí Minh.')).toEqual(['Anh ấy sống ở TP. Hồ Chí Minh.']);
    expect(texts('TS. Nguyễn Văn A giảng dạy.')).toEqual(['TS. Nguyễn Văn A giảng dạy.']);
  });

  it('viết tắt tiếng Anh', () => {
    expect(texts('Mr. Smith arrived.')).toEqual(['Mr. Smith arrived.']);
    expect(texts('See Dr. Jones today.')).toEqual(['See Dr. Jones today.']);
  });

  it('chữ cái viết tắt tên riêng', () => {
    expect(texts('J. R. R. Tolkien viết sách.')).toEqual(['J. R. R. Tolkien viết sách.']);
  });

  it('viết tắt không phân biệt hoa thường', () => {
    expect(texts('gặp mr. smith nhé.')).toEqual(['gặp mr. smith nhé.']);
  });
});

describe('thán từ một chữ trong hội thoại LN', () => {
  it.each([
    ['Ừ. Được rồi.', ['Ừ.', 'Được rồi.']],
    ['À. Tôi nhớ ra.', ['À.', 'Tôi nhớ ra.']],
    ['Ồ. Thật sao?', ['Ồ.', 'Thật sao?']],
    ['Ơ. Lạ nhỉ.', ['Ơ.', 'Lạ nhỉ.']],
  ])('tách %j thành hai câu', (input, expected) => {
    expect(texts(input)).toEqual(expected);
  });

  it('vẫn coi chữ Latin hoa đơn là viết tắt tên riêng', () => {
    expect(texts('J. R. R. Tolkien viết sách.')).toEqual(['J. R. R. Tolkien viết sách.']);
  });

  it('chữ thường đơn không phải viết tắt', () => {
    expect(texts('a. b.')).toEqual(['a.', 'b.']);
  });
});

describe('hội thoại và dấu ngoặc', () => {
  it('giữ dấu ngoặc kép đóng ở cuối câu', () => {
    expect(texts('"Đi thôi." Cậu ấy nói.')).toEqual(['"Đi thôi."', 'Cậu ấy nói.']);
  });

  it('giữ ngoặc kép kiểu Nhật 「」 thường gặp trong LN', () => {
    expect(texts('「Chào cậu.」 Tôi đáp lại.')).toEqual(['「Chào cậu.」', 'Tôi đáp lại.']);
  });

  it('giữ ngoặc 『』', () => {
    expect(texts('『Thật à?』 Cô ấy hỏi.')).toEqual(['『Thật à?』', 'Cô ấy hỏi.']);
  });

  it('giữ dấu ngoặc kép cong', () => {
    expect(texts('“Ừ.” Rồi im lặng.')).toEqual(['“Ừ.”', 'Rồi im lặng.']);
  });

  it('giữ ngoặc đơn đóng', () => {
    expect(texts('(ghi chú.) Tiếp tục.')).toEqual(['(ghi chú.)', 'Tiếp tục.']);
  });

  it('tách dấu chấm câu full-width 。', () => {
    expect(texts('こんにちは。Xin chào.')).toEqual(['こんにちは。', 'Xin chào.']);
  });
});

describe('vị trí start/end', () => {
  it('trỏ đúng vào chuỗi gốc', () => {
    const input = 'Một. Hai.';
    for (const s of splitSentences(input)) {
      expect(input.slice(s.start, s.end)).toBe(s.text);
    }
  });

  it('bỏ qua khoảng trắng đầu câu khi tính start', () => {
    const input = '   Một.   Hai.';
    const result = splitSentences(input);
    expect(result[0]?.start).toBe(3);
    expect(input.slice(result[1]?.start, result[1]?.end)).toBe('Hai.');
  });

  it('vị trí tăng dần và không chồng lấn', () => {
    const input = 'A rồi. B nữa! C chứ? D cuối';
    const result = splitSentences(input);
    for (let i = 1; i < result.length; i += 1) {
      const prev = result[i - 1];
      const curr = result[i];
      if (prev === undefined || curr === undefined) expect.unreachable('phải có phần tử');
      expect(curr.start).toBeGreaterThanOrEqual(prev.end);
    }
  });

  it('ghép lại các câu phải phủ hết nội dung có nghĩa', () => {
    const input = 'Trời mưa. Tôi ở nhà. Đọc sách.';
    const joined = splitSentences(input)
      .map((s) => s.text)
      .join(' ');
    expect(joined).toBe(input);
  });
});

describe('trường hợp biên', () => {
  it('chỉ một dấu câu', () => {
    expect(texts('.')).toEqual(['.']);
  });

  it('một câu duy nhất không dấu', () => {
    expect(texts('chỉ một câu thôi')).toEqual(['chỉ một câu thôi']);
  });

  it('nhiều dòng trong một câu', () => {
    expect(texts('Dòng một\ndòng hai.')).toEqual(['Dòng một\ndòng hai.']);
  });

  it('văn bản dài không throw', () => {
    const long = 'Câu văn dài. '.repeat(1000);
    expect(splitSentences(long)).toHaveLength(1000);
  });
});
