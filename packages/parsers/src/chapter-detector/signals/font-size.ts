import type { Page, TextLine } from '../../cleaner/types.js';

/**
 * Tín hiệu: dòng có cỡ chữ lớn hơn thân bài.
 *
 * Đo trên file mẫu: sách VI có tiêu đề 18pt trên nền thân bài 10pt — tín
 * hiệu rất mạnh. Nhưng sách EN mẫu **không có dòng nào lớn hơn thân bài**
 * (97.1% là 13pt), nên tín hiệu này phải trả 0 một cách êm, không được coi
 * là "không tìm thấy chương".
 */

/** Cỡ chữ chiếm nhiều dòng nhất = cỡ thân bài */
export const bodyFontSize = (pages: readonly Page[]): number | undefined => {
  const count = new Map<number, number>();

  for (const page of pages) {
    for (const line of page.lines) {
      if (line.fontSize === undefined) continue;
      if (line.text.trim().length === 0) continue;
      const size = Math.round(line.fontSize);
      count.set(size, (count.get(size) ?? 0) + 1);
    }
  }

  if (count.size === 0) return undefined;

  let best: number | undefined;
  let bestCount = 0;
  for (const [size, n] of count) {
    if (n > bestCount) {
      best = size;
      bestCount = n;
    }
  }

  return best;
};

/**
 * Chấm điểm theo cỡ chữ, trả 0–1.
 *
 * Thang tuyến tính theo tỉ lệ vượt: lớn hơn thân bài 20% → 0.5,
 * từ 40% trở lên → 1. Dưới 10% coi như nhiễu do làm tròn.
 *
 * Trả 0 khi thiếu `fontSize` — sách không đo được cỡ chữ vẫn phải dùng được
 * các tín hiệu khác.
 */
export const scoreFontSize = (line: TextLine, bodySize: number | undefined): number => {
  if (line.fontSize === undefined || bodySize === undefined || bodySize <= 0) return 0;

  const ratio = line.fontSize / bodySize;
  if (ratio < 1.1) return 0;
  if (ratio >= 1.4) return 1;

  // 1.1 → 0, 1.4 → 1
  return (ratio - 1.1) / 0.3;
};
