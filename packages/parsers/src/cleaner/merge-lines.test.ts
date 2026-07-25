import { describe, expect, it } from 'vitest';
import { endsSentence, mergeLines, startsNewBlock } from './merge-lines.js';

describe('endsSentence', () => {
  it('nhận dấu chấm, hỏi, than', () => {
    expect(endsSentence('Hắn đi rồi.')).toBe(true);
    expect(endsSentence('Thật sao?')).toBe(true);
    expect(endsSentence('Không thể nào!')).toBe(true);
  });

  it('nhận dấu ba chấm và dạng full-width', () => {
    expect(endsSentence('Ta…')).toBe(true);
    expect(endsSentence('そうか。')).toBe(true);
  });

  it('nhận dấu câu đứng trước dấu đóng ngoặc kép kiểu Nhật', () => {
    expect(endsSentence('「Ta sẽ trở lại.」')).toBe(true);
  });

  it('không nhận dòng kết thúc bằng chữ', () => {
    expect(endsSentence('Hắn nhìn về phía')).toBe(false);
  });

  it('không nhận dòng kết thúc bằng dấu phẩy', () => {
    expect(endsSentence('Hắn nhìn về phía xa,')).toBe(false);
  });

  it('bỏ qua khoảng trắng thừa cuối dòng', () => {
    expect(endsSentence('Hắn đi rồi.   ')).toBe(true);
  });
});

describe('startsNewBlock', () => {
  it('nhận ngoặc kép kiểu Nhật', () => {
    expect(startsNewBlock('「Ta là ai?」')).toBe(true);
  });

  it('nhận gạch đầu dòng hội thoại', () => {
    expect(startsNewBlock('— Ngươi là ai?')).toBe(true);
  });

  it('không nhận dòng văn thường', () => {
    expect(startsNewBlock('Hắn bước vào phòng.')).toBe(false);
  });
});

describe('nối dòng bị PDF ngắt', () => {
  it('nối dòng không kết thúc bằng dấu câu', () => {
    const input = 'Hắn bước chậm rãi vào trong căn phòng tối om và\nnhìn quanh một lượt.';
    expect(mergeLines(input)).toBe(
      'Hắn bước chậm rãi vào trong căn phòng tối om và nhìn quanh một lượt.',
    );
  });

  it('không nối khi dòng trước đã kết thúc câu', () => {
    const input =
      'Hắn bước chậm rãi vào trong căn phòng tối om.\nBên ngoài trời vẫn đang mưa rất to.';
    expect(mergeLines(input)).toBe(input);
  });

  it('giữ dòng trống làm ranh giới đoạn', () => {
    const input = 'Đoạn một chưa hết nên còn\nnối tiếp ở đây.\n\nĐoạn hai bắt đầu.';
    expect(mergeLines(input)).toBe('Đoạn một chưa hết nên còn nối tiếp ở đây.\nĐoạn hai bắt đầu.');
  });

  it('không nối vào dòng mở đầu hội thoại', () => {
    const input =
      'Hắn quay lại nhìn cô gái đứng phía sau lưng mình và\n「Ngươi đến đây làm gì?」';
    const result = mergeLines(input).split('\n');
    expect(result).toHaveLength(2);
    expect(result[1]).toBe('「Ngươi đến đây làm gì?」');
  });

  it('nối nhiều dòng liên tiếp thành một câu', () => {
    const input = 'Một câu rất dài bị ngắt\nthành ba dòng khác nhau\nvà kết thúc ở đây.';
    expect(mergeLines(input)).toBe('Một câu rất dài bị ngắt thành ba dòng khác nhau và kết thúc ở đây.');
  });

  it('chèn đúng một khoảng trắng khi nối', () => {
    expect(mergeLines('abc và\ndef')).toBe('abc và def');
    expect(mergeLines('abc và \n   def')).toBe('abc và def');
  });

  it('bỏ dòng chỉ có khoảng trắng', () => {
    expect(mergeLines('Câu một.\n   \nCâu hai.')).toBe('Câu một.\nCâu hai.');
  });

  it('tiêu đề ngắn sau một câu đã hết thì đứng riêng', () => {
    // Đoạn trước đã chấm câu → dòng ngắn kế tiếp là tiêu đề thật
    const body = 'Đây là một dòng văn xuôi dài bình thường trong sách và đã hết ý.';
    const input = `${body}\n${body}\nChương Hai\n${body}\n${body}`;
    expect(mergeLines(input).split('\n')).toContain('Chương Hai');
  });

  it('dòng ngắn cuối đoạn vẫn được nối vào câu đang dở', () => {
    // Ca lỗi thật gặp trên PDF mẫu: câu chưa hết mà bị xé làm đôi
    //   "…Tất cả vẫn ngồi" / "trong lớp chờ đợi."
    const long = 'Nhưng dù bình thường giờ học đã xong, chẳng ai đi trực nhật hay sinh hoạt';
    const input = [long, 'cuối ngày. Tất cả vẫn ngồi', 'trong lớp chờ đợi.', long, long].join('\n');

    expect(mergeLines(input)).toContain('Tất cả vẫn ngồi trong lớp chờ đợi.');
  });

  it('text một dòng giữ nguyên', () => {
    expect(mergeLines('Chỉ một dòng duy nhất.')).toBe('Chỉ một dòng duy nhất.');
  });

  it('text rỗng trả về rỗng', () => {
    expect(mergeLines('')).toBe('');
    expect(mergeLines('   \n  \n ')).toBe('');
  });

  it('nhận CRLF', () => {
    expect(mergeLines('abc và\r\ndef')).toBe('abc và def');
  });

  it('shortLineRatio = 0 thì tắt luật dòng ngắn', () => {
    const body = 'Đây là một dòng văn xuôi dài bình thường trong sách và đã hết ý.';
    const input = [body, body, 'Ngắn', body, body].join('\n');

    // Bật (mặc định): dòng ngắn đứng riêng
    expect(mergeLines(input).split('\n')).toContain('Ngắn');
    // Tắt: 'Ngắn' không còn là khối riêng mà dính vào dòng sau
    expect(mergeLines(input, { shortLineRatio: 0 }).split('\n')).not.toContain('Ngắn');
  });

  it('quá ít dòng thì không suy luận thống kê độ dài', () => {
    // Chỉ 2 dòng: dòng sau ngắn tự nhiên vì là cuối câu, không phải tiêu đề
    const input = 'Hắn bước chậm rãi vào trong căn phòng tối om và\nnhìn quanh.';
    expect(mergeLines(input)).toBe('Hắn bước chậm rãi vào trong căn phòng tối om và nhìn quanh.');
  });

  it('trung vị không bị một tiêu đề ngắn kéo lệch', () => {
    // Trung bình bị 'X' kéo xuống, trung vị thì không → thân bài vẫn nối được
    const body = 'Đây là một dòng văn xuôi dài bình thường trong sách và chưa hết ý';
    const input = ['X', 'X', body, body, body, body, body].join('\n');
    const result = mergeLines(input).split('\n');

    expect(result).toContain('X');
    // Năm dòng thân bài đã nối thành một khối
    expect(result.some((l) => l.length > body.length * 4)).toBe(true);
  });
});
