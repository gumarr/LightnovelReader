import type { Page, TextLine } from '../../cleaner/types.js';

/**
 * Tín hiệu vị trí: tiêu đề chương nằm ở đầu trang, hoặc có khoảng trắng dọc
 * lớn phía trên.
 *
 * Đo trên file mẫu EN: tiêu đề `"Chapter 1 :"` nằm ở `y=84` — đúng dòng đầu
 * tiên của trang. Đây là tín hiệu cần thiết để chặn false positive của regex
 * khớp nhầm giữa đoạn văn.
 */

export type PositionOptions = {
  /** Dòng nằm trong tỉ lệ này tính từ đỉnh vùng text được coi là "đầu trang" */
  topRatio?: number;
  /** Khoảng trắng phía trên ≥ bội số này của chiều cao dòng thì tính điểm */
  gapMultiplier?: number;
};

const DEFAULT_TOP_RATIO = 0.25;
const DEFAULT_GAP_MULTIPLIER = 2;

/**
 * Chấm điểm vị trí, trả 0–1. Cộng dồn hai tín hiệu con:
 * - 0.6 nếu là dòng đầu tiên có nội dung của trang
 * - 0.4 nếu phía trên có khoảng trắng lớn bất thường
 *
 * Dòng vừa đầu trang vừa có khoảng trắng lớn → 1.
 */
export const scorePosition = (
  page: Page,
  lineIndex: number,
  options: PositionOptions = {},
): number => {
  const topRatio = options.topRatio ?? DEFAULT_TOP_RATIO;
  const gapMultiplier = options.gapMultiplier ?? DEFAULT_GAP_MULTIPLIER;

  const line = page.lines[lineIndex];
  if (line === undefined) return 0;

  const contentLines = page.lines.filter((l) => l.text.trim().length > 0);
  if (contentLines.length === 0) return 0;

  let score = 0;

  // --- Đầu trang ---
  const top = Math.min(...contentLines.map((l) => l.y));
  const bottom = Math.max(...contentLines.map((l) => l.y + l.height));
  const span = bottom - top;
  const isFirst = contentLines[0] === line;
  const withinTop = span <= 0 || (line.y - top) / span <= topRatio;
  if (isFirst || withinTop) score += 0.6;

  // --- Khoảng trắng phía trên ---
  if (hasLargeGapAbove(page, lineIndex, gapMultiplier)) score += 0.4;

  return Math.min(score, 1);
};

/**
 * Phía trên dòng có khoảng trắng lớn bất thường không.
 *
 * So với khoảng cách dòng **thường gặp** trong trang (trung vị), không phải
 * chiều cao chữ: sách giãn dòng thưa thì mọi dòng đều cách xa nhau, lấy
 * chiều cao chữ làm chuẩn sẽ cho điểm tràn lan.
 */
const hasLargeGapAbove = (page: Page, lineIndex: number, multiplier: number): boolean => {
  const line = page.lines[lineIndex];
  if (line === undefined) return false;

  // Dòng đầu trang không có gì phía trên để so
  const above = previousContentLine(page.lines, lineIndex);
  if (above === undefined) return false;

  const gaps = lineGaps(page.lines);
  if (gaps.length === 0) return false;

  const typical = median(gaps);
  if (typical <= 0) return false;

  const gap = line.y - (above.y + above.height);
  return gap >= typical * multiplier;
};

const previousContentLine = (lines: readonly TextLine[], index: number): TextLine | undefined => {
  for (let i = index - 1; i >= 0; i -= 1) {
    const candidate = lines[i];
    if (candidate !== undefined && candidate.text.trim().length > 0) return candidate;
  }
  return undefined;
};

/** Khoảng hở dọc giữa các dòng liên tiếp */
const lineGaps = (lines: readonly TextLine[]): number[] => {
  const content = lines.filter((l) => l.text.trim().length > 0).sort((a, b) => a.y - b.y);
  const gaps: number[] = [];

  for (let i = 1; i < content.length; i += 1) {
    const previous = content[i - 1];
    const current = content[i];
    if (previous === undefined || current === undefined) continue;
    const gap = current.y - (previous.y + previous.height);
    if (gap >= 0) gaps.push(gap);
  }

  return gaps;
};

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
};

/**
 * Tín hiệu trang thưa: trang mở chương thường bỏ trống phần lớn diện tích.
 *
 * Trả 0–1 theo mức độ thưa so với trung vị toàn sách. Cần **toàn bộ** sách
 * để so, nên nhận `pages` chứ không chỉ một trang.
 */
export const scoreSparsePage = (pages: readonly Page[], pageNumber: number): number => {
  const counts = pages.map((p) => p.lines.filter((l) => l.text.trim().length > 0).length);
  const nonEmpty = counts.filter((n) => n > 0);
  if (nonEmpty.length === 0) return 0;

  const typical = median(nonEmpty);
  if (typical <= 0) return 0;

  const page = pages.find((p) => p.pageNumber === pageNumber);
  if (page === undefined) return 0;

  const count = page.lines.filter((l) => l.text.trim().length > 0).length;
  // Trang trống hẳn không phải trang mở chương — nó là trang ngăn cách
  if (count === 0) return 0;

  const ratio = count / typical;
  if (ratio >= 0.6) return 0;
  if (ratio <= 0.15) return 1;

  // 0.6 → 0, 0.15 → 1
  return (0.6 - ratio) / 0.45;
};
