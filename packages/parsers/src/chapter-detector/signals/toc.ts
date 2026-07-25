import type { Page } from '../../cleaner/types.js';

/**
 * Nhận diện trang mục lục.
 *
 * Mục lục có font tiêu đề lớn và nằm đầu trang nên ăn điểm y hệt tiêu đề
 * chương thật — file mẫu VI cho `"Mục lục"` 19pt ở trang 2 điểm 1.99, vượt
 * ngưỡng. Nhưng nó không phải nội dung, sinh ra một "chương" rỗng vô nghĩa.
 *
 * Tín hiệu nhận biết: nhiều dòng **kết thúc bằng số trang**. Quan sát thật:
 * `"Chương Hai: Đá văng ảo tưởng77"` — số dính liền, không có khoảng trắng.
 */

export type TocOptions = {
  /** Tỉ lệ dòng phải kết thúc bằng số thì trang mới bị coi là mục lục */
  minEntryRatio?: number;
  /** Trang phải có ít nhất chừng này dòng — vài dòng thì thống kê vô nghĩa */
  minLines?: number;
};

const DEFAULT_MIN_ENTRY_RATIO = 0.5;
const DEFAULT_MIN_LINES = 4;

/**
 * Dòng có dạng "mục lục": kết thúc bằng số trang, có thể dính liền chữ
 * (`…ảo tưởng77`) hoặc cách bằng khoảng trắng/dấu chấm (`… . . . 77`).
 */
export const looksLikeTocEntry = (text: string): boolean => {
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;

  // Phải kết thúc bằng chữ số
  const match = /(\d{1,4})$/.exec(trimmed);
  if (match === null) return false;

  // Phần trước số phải có chữ — dòng chỉ toàn số là số trang, không phải mục
  const before = trimmed.slice(0, trimmed.length - match[1]!.length);
  return /\p{L}/u.test(before);
};

/**
 * Trang này có phải mục lục không.
 *
 * Không trả điểm số như các tín hiệu khác vì đây là **bộ lọc loại trừ**, kết
 * quả chỉ có đúng/sai: hoặc trang là mục lục (bỏ mọi ứng viên trên đó), hoặc
 * không.
 */
export const isTableOfContents = (page: Page, options: TocOptions = {}): boolean => {
  const minEntryRatio = options.minEntryRatio ?? DEFAULT_MIN_ENTRY_RATIO;
  const minLines = options.minLines ?? DEFAULT_MIN_LINES;

  const lines = page.lines.filter((l) => l.text.trim().length > 0);
  if (lines.length < minLines) return false;

  const entries = lines.filter((l) => looksLikeTocEntry(l.text)).length;
  return entries / lines.length >= minEntryRatio;
};
