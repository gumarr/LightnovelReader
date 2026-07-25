import { describe, expect, it } from 'vitest';
import { scorePattern } from './pattern.js';

describe('khớp mẫu tiêu đề — tiếng Việt', () => {
  it('chương đánh số bằng chữ (dạng gặp trong file mẫu thật)', () => {
    expect(scorePattern('Chương Một: Trời mưa, có khả năng xuất hiện ước mơ')).toBe(1);
    expect(scorePattern('Chương Hai: Đá văng ảo tưởng')).toBe(1);
    expect(scorePattern('Chương Bốn: Ngọn gió ngày mai')).toBe(1);
  });

  it('chương đánh số bằng chữ số', () => {
    expect(scorePattern('Chương 1: Khởi đầu')).toBe(1);
    expect(scorePattern('Chương 12')).toBe(1);
  });

  it('mục không đánh số cho điểm thấp hơn', () => {
    expect(scorePattern('Mở đầu: Vầng trăng ngày ấy')).toBe(0.7);
    expect(scorePattern('Kết: Vầng trăng hôm nay')).toBe(0.7);
    expect(scorePattern('Lời bạt')).toBe(0.7);
  });

  it('nhận phần, quyển, hồi', () => {
    expect(scorePattern('Phần 2: Hồi ức')).toBe(1);
    expect(scorePattern('Quyển Ba')).toBe(1);
  });

  it('không phân biệt hoa thường', () => {
    expect(scorePattern('CHƯƠNG MỘT: KHỞI ĐẦU')).toBe(1);
    expect(scorePattern('chương một')).toBe(1);
  });
});

describe('khớp mẫu tiêu đề — tiếng Anh', () => {
  it('dạng gặp trong file mẫu thật', () => {
    expect(scorePattern('Chapter 1 :')).toBe(1);
    expect(scorePattern('Chapter 2 : Our Blue')).toBe(1);
    expect(scorePattern('Prologue :')).toBe(0.7);
  });

  it('nhận chữ số La Mã', () => {
    expect(scorePattern('Chapter IV: The Return')).toBe(1);
  });

  it('nhận epilogue / interlude / side story', () => {
    expect(scorePattern('Epilogue')).toBe(0.7);
    expect(scorePattern('Interlude: A Quiet Night')).toBe(0.7);
    expect(scorePattern('Side Story: The Cat')).toBe(0.7);
  });
});

describe('không khớp nhầm văn xuôi', () => {
  it('từ khoá nằm giữa câu không tính', () => {
    // Lỗi thật gặp khi thử regex không neo `^` trên file mẫu EN
    expect(scorePattern('part left, most of the important decisions have been made.”')).toBe(0);
    expect(scorePattern('Tôi đọc chương một cách chăm chú.')).toBe(0);
  });

  it('câu văn mở đầu bằng từ khoá vẫn không tính', () => {
    expect(scorePattern('Chapter books were stacked on the desk, and she read them all.')).toBe(0);
  });

  it('dòng quá dài không phải tiêu đề', () => {
    const long = `Chương Một: ${'x'.repeat(200)}`;
    expect(scorePattern(long)).toBe(0);
  });

  it('văn xuôi thường không khớp', () => {
    expect(scorePattern('Hắn rút thanh kiếm ra khỏi vỏ.')).toBe(0);
    expect(scorePattern('“Sao, ghen à?”')).toBe(0);
  });

  it('chuỗi rỗng trả 0', () => {
    expect(scorePattern('')).toBe(0);
    expect(scorePattern('   ')).toBe(0);
  });

  it('số trang đơn lẻ không khớp', () => {
    expect(scorePattern('12')).toBe(0);
  });
});
