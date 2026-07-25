import { describe, expect, it } from 'vitest';
import { confidenceLevel, rangeLabel, rangeSize } from './confidence';

describe('confidenceLevel — sách CÓ outline', () => {
  it('điểm outline thật (5.15–6.36) là chắc chắn', () => {
    // Số lấy từ đo đạc thật trên file mẫu VI — PROGRESS.md mục 2
    expect(confidenceLevel(5.15, true)).toBe('certain');
    expect(confidenceLevel(6.36, true)).toBe('certain');
  });

  it('chương không khớp outline vẫn bị đánh dấu để user soi', () => {
    expect(confidenceLevel(1.86, true)).toBe('unsure');
  });

  it('vùng giữa là có thể đúng', () => {
    expect(confidenceLevel(2.5, true)).toBe('likely');
  });

  it('ngưỡng là bao gồm', () => {
    expect(confidenceLevel(3, true)).toBe('certain');
    expect(confidenceLevel(2, true)).toBe('likely');
  });
});

describe('confidenceLevel — sách KHÔNG outline', () => {
  /**
   * Không có outline thì mất luôn hai tín hiệu mạnh nhất (outline 3.0, font
   * lớn 1.5), trần thực tế chỉ còn 2.5. Dùng chung mốc với sách có outline sẽ
   * gắn "Nên kiểm lại" lên **mọi** chương — lỗi thật thấy trên ảnh chụp bản
   * đóng gói, khi cả 5/5 chương của file EN đều đỏ.
   */
  it('regex khớp rõ (1.86) KHÔNG bị coi là đáng ngờ', () => {
    expect(confidenceLevel(1.86, false)).toBe('certain');
  });

  it('vừa đủ qua ngưỡng nhận (1.41) mới là nên kiểm lại', () => {
    expect(confidenceLevel(1.41, false)).toBe('unsure');
  });

  it('không phải chương nào cũng đỏ — có phân biệt giữa các mức', () => {
    const scores = [1.41, 1.5, 1.86, 2.5];
    const levels = scores.map((s) => confidenceLevel(s, false));
    expect(new Set(levels).size).toBeGreaterThan(1);
  });
});

describe('confidenceLevel — không phụ thuộc outline', () => {
  it('fallback chia theo trang (0 điểm) luôn là nên kiểm lại', () => {
    expect(confidenceLevel(0, true)).toBe('unsure');
    expect(confidenceLevel(0, false)).toBe('unsure');
  });

  it('chương do user tự tạo không mang nhãn tin cậy của detector', () => {
    expect(confidenceLevel(undefined, true)).toBe('manual');
    expect(confidenceLevel(undefined, false)).toBe('manual');
  });

  it('mặc định coi như có outline — mốc chặt hơn', () => {
    expect(confidenceLevel(1.86)).toBe('unsure');
  });
});

describe('rangeLabel', () => {
  it('PDF dùng "Trang"', () => {
    expect(rangeLabel(1, 10, true)).toBe('Trang 1–10');
  });

  it('DOCX dùng "Đoạn" vì không có trang giấy', () => {
    expect(rangeLabel(1, 10, false)).toBe('Đoạn 1–10');
  });

  it('một trang thì không hiện khoảng', () => {
    expect(rangeLabel(7, 7, true)).toBe('Trang 7');
  });
});

describe('rangeSize', () => {
  it('tính cả hai đầu', () => {
    expect(rangeSize(1, 10)).toBe(10);
    expect(rangeSize(5, 5)).toBe(1);
  });

  it('khoảng ngược trả 0 thay vì số âm', () => {
    expect(rangeSize(10, 5)).toBe(0);
  });
});
