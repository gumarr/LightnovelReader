/**
 * Tính lát cắt cần render cho danh sách dài (windowing).
 *
 * Tự viết thay vì thêm dependency: phần khó duy nhất là cộng dồn chiều cao, mà
 * cả trang PDF (cao không đều) lẫn danh sách segment (cao đều) đều quy về cùng
 * một mảng offset. Toàn bộ file là hàm thuần — test không cần DOM.
 */

export type WindowRange = {
  /** Chỉ số phần tử đầu tiên được render */
  start: number;
  /** Chỉ số **sau** phần tử cuối cùng được render (nửa mở, như `slice`) */
  end: number;
  /** Chiều cao tổng để dựng thanh cuộn đúng tầm */
  totalHeight: number;
  /** Khoảng trống phải chèn phía trên lát cắt */
  offsetTop: number;
};

/**
 * Mốc đầu của từng phần tử, cộng dồn. Phần tử `i` nằm ở
 * `[offsets[i], offsets[i + 1])`, nên mảng dài hơn danh sách đúng 1.
 */
export const cumulativeOffsets = (heights: readonly number[]): number[] => {
  const offsets = new Array<number>(heights.length + 1);
  offsets[0] = 0;

  for (let i = 0; i < heights.length; i += 1) {
    // Chiều cao âm hoặc NaN sẽ làm hỏng thứ tự tăng dần mà tìm nhị phân dựa vào
    const height = heights[i];
    const safe = typeof height === 'number' && Number.isFinite(height) && height > 0 ? height : 0;
    offsets[i + 1] = (offsets[i] ?? 0) + safe;
  }

  return offsets;
};

/**
 * Tìm phần tử chứa toạ độ `y`.
 *
 * Tìm nhị phân chứ không quét tuyến tính: hàm này chạy mỗi lần cuộn, mà chương
 * lớn nhất có 1353 segment.
 */
export const findIndexAt = (offsets: readonly number[], y: number): number => {
  const count = offsets.length - 1;
  if (count <= 0) return 0;

  let low = 0;
  let high = count - 1;

  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if ((offsets[mid] ?? 0) <= y) low = mid;
    else high = mid - 1;
  }

  return low;
};

export type WindowInput = {
  offsets: readonly number[];
  scrollTop: number;
  viewportHeight: number;
  /** Số phần tử render thêm mỗi phía để cuộn nhanh không thấy ô trắng */
  overscan?: number;
};

export const visibleRange = ({
  offsets,
  scrollTop,
  viewportHeight,
  overscan = 1,
}: WindowInput): WindowRange => {
  const count = Math.max(0, offsets.length - 1);
  const totalHeight = offsets[count] ?? 0;

  if (count === 0) return { start: 0, end: 0, totalHeight: 0, offsetTop: 0 };

  // Kẹp `scrollTop`: cuộn đà (overscroll) của Chromium trả cả giá trị âm lẫn
  // giá trị vượt quá tổng chiều cao.
  const top = Math.min(Math.max(scrollTop, 0), totalHeight);
  const bottom = Math.min(top + Math.max(viewportHeight, 0), totalHeight);

  const first = findIndexAt(offsets, top);
  const last = findIndexAt(offsets, bottom);

  const start = Math.max(0, first - overscan);
  const end = Math.min(count, last + 1 + overscan);

  return { start, end, totalHeight, offsetTop: offsets[start] ?? 0 };
};

/**
 * Vị trí cuộn để phần tử `index` nằm gọn trong khung nhìn.
 *
 * Chỉ cuộn khi phần tử thực sự nằm ngoài — đang đọc dở mà khung nhảy về đầu
 * mỗi lần audio sang segment kế thì không đọc nổi.
 */
export const scrollTopFor = (
  offsets: readonly number[],
  index: number,
  viewportHeight: number,
  currentScrollTop: number,
  /** Chừa một khoảng phía trên để phần tử không dính sát mép */
  padding = 24,
): number | undefined => {
  const count = offsets.length - 1;
  if (index < 0 || index >= count) return undefined;

  const itemTop = offsets[index] ?? 0;
  const itemBottom = offsets[index + 1] ?? itemTop;

  const viewTop = currentScrollTop;
  const viewBottom = currentScrollTop + viewportHeight;

  if (itemTop >= viewTop + padding && itemBottom <= viewBottom) return undefined;

  // Phần tử cao hơn cả khung nhìn thì canh mép trên — canh giữa sẽ cắt mất đầu
  if (itemBottom - itemTop >= viewportHeight) return Math.max(0, itemTop - padding);

  // Canh giữa để còn thấy ngữ cảnh hai bên
  const centered = itemTop - (viewportHeight - (itemBottom - itemTop)) / 2;
  const maxScroll = Math.max(0, (offsets[count] ?? 0) - viewportHeight);

  return Math.min(Math.max(0, centered), maxScroll);
};
