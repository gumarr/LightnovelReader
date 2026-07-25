import type { Page, TextLine } from './types.js';

/**
 * Phát hiện bố cục hai cột và sắp lại thứ tự đọc.
 *
 * PDF trả text theo thứ tự vẽ, với trang hai cột thứ tự đó thường là
 * trái-phải xen kẽ theo dòng → đọc lên thành câu vô nghĩa. Cần nhận ra
 * "rãnh" (gutter) giữa hai cột rồi đọc hết cột trái mới sang cột phải.
 */

export type ColumnOptions = {
  /**
   * Bề rộng rãnh tối thiểu, theo tỉ lệ chiều rộng trang. Rãnh hẹp hơn có
   * thể chỉ là khoảng cách giữa các từ.
   */
  minGutterRatio?: number;
  /** Mỗi cột phải chứa ít nhất tỉ lệ này của tổng số dòng */
  minColumnShare?: number;
  /** Dưới số dòng này thì thống kê không đủ tin cậy → coi như một cột */
  minLines?: number;
  /**
   * Dòng rộng hơn tỉ lệ này của chiều rộng vùng text được coi là dòng chạy
   * ngang hết trang (tiêu đề) — không tính vào thống kê cột.
   */
  fullWidthRatio?: number;
};

const DEFAULT_MIN_GUTTER_RATIO = 0.04;
const DEFAULT_MIN_COLUMN_SHARE = 0.25;
const DEFAULT_MIN_LINES = 8;
const DEFAULT_FULL_WIDTH_RATIO = 0.7;

export type ColumnLayout =
  | { kind: 'single' }
  /** `splitX`: hoành độ ranh giới; dòng có `x` nhỏ hơn thuộc cột trái */
  | { kind: 'two-column'; splitX: number };

/**
 * Tìm bố cục cột của một trang.
 *
 * Thuật toán: chiếu các dòng lên trục x, tìm khoảng trống dọc rộng nhất
 * nằm ở vùng giữa trang mà không dòng nào (trừ dòng full-width) cắt qua.
 */
export const detectColumnLayout = (page: Page, options: ColumnOptions = {}): ColumnLayout => {
  const minGutterRatio = options.minGutterRatio ?? DEFAULT_MIN_GUTTER_RATIO;
  const minColumnShare = options.minColumnShare ?? DEFAULT_MIN_COLUMN_SHARE;
  const minLines = options.minLines ?? DEFAULT_MIN_LINES;
  const fullWidthRatio = options.fullWidthRatio ?? DEFAULT_FULL_WIDTH_RATIO;

  const lines = page.lines.filter((line) => line.text.trim().length > 0);
  if (lines.length < minLines) return { kind: 'single' };

  const textLeft = Math.min(...lines.map((l) => l.x));
  const textRight = Math.max(...lines.map((l) => l.x + l.width));
  const textWidth = textRight - textLeft;
  if (textWidth <= 0) return { kind: 'single' };

  // Tiêu đề chạy ngang hết trang không phản ánh cấu trúc cột
  const bodyLines = lines.filter((line) => line.width < textWidth * fullWidthRatio);
  if (bodyLines.length < minLines) return { kind: 'single' };

  const gutter = findWidestGutter(bodyLines, textLeft, textRight);
  if (gutter === undefined) return { kind: 'single' };
  if (gutter.end - gutter.start < page.width * minGutterRatio) return { kind: 'single' };

  const splitX = (gutter.start + gutter.end) / 2;

  // Rãnh phải chia thật sự hai bên, không phải lề của một cột lệch
  const leftCount = bodyLines.filter((l) => l.x < splitX).length;
  const rightCount = bodyLines.length - leftCount;
  const minCount = bodyLines.length * minColumnShare;
  if (leftCount < minCount || rightCount < minCount) return { kind: 'single' };

  return { kind: 'two-column', splitX };
};

type Gutter = { start: number; end: number };

/**
 * Tìm khoảng trống dọc rộng nhất trên trục x mà không dòng nào phủ.
 * Dùng quét khoảng: sắp xếp theo mép trái rồi theo dõi mép phải xa nhất.
 */
const findWidestGutter = (
  lines: readonly TextLine[],
  textLeft: number,
  textRight: number,
): Gutter | undefined => {
  const spans = [...lines]
    .map((line) => ({ start: line.x, end: line.x + line.width }))
    .sort((a, b) => a.start - b.start);

  let best: Gutter | undefined;
  let reach = textLeft;

  for (const span of spans) {
    if (span.start > reach) {
      const width = span.start - reach;
      if (best === undefined || width > best.end - best.start) {
        best = { start: reach, end: span.start };
      }
    }
    reach = Math.max(reach, span.end);
  }

  // Khoảng trống sát mép phải là lề trang, không phải rãnh giữa cột
  if (best === undefined) return undefined;
  if (best.end >= textRight) return undefined;

  return best;
};

/**
 * Sắp lại thứ tự đọc của một trang: cột trái từ trên xuống, rồi cột phải.
 *
 * Dòng chạy ngang qua ranh giới (tiêu đề) được giữ **trước** cả hai cột theo
 * đúng vị trí dọc của nó — tiêu đề luôn đứng trên phần thân.
 */
export const reorderColumns = (page: Page, options: ColumnOptions = {}): Page => {
  const layout = detectColumnLayout(page, options);
  if (layout.kind === 'single') return { ...page, lines: [...page.lines] };

  const spanning: TextLine[] = [];
  const left: TextLine[] = [];
  const right: TextLine[] = [];

  for (const line of page.lines) {
    // Dòng bắt đầu bên trái nhưng kéo qua ranh giới → chạy ngang cả trang
    if (line.x < layout.splitX && line.x + line.width > layout.splitX) spanning.push(line);
    else if (line.x < layout.splitX) left.push(line);
    else right.push(line);
  }

  const byVertical = (a: TextLine, b: TextLine): number => a.y - b.y;

  return {
    ...page,
    lines: [
      ...spanning.sort(byVertical),
      ...left.sort(byVertical),
      ...right.sort(byVertical),
    ],
  };
};
