import type { Page, TextLine } from './types.js';

/**
 * Loại header/footer lặp lại: số trang, tên sách chạy đầu trang.
 *
 * Tín hiệu: cùng một **phần chữ** xuất hiện ở **cùng vùng dọc** trên hơn
 * `minRatio` số trang. Bỏ qua phần số để "Trang 12" và "Trang 13" được coi
 * là cùng một mẫu — đây mới là dạng header/footer phổ biến nhất.
 */

export type HeaderFooterOptions = {
  /** Tỉ lệ số trang tối thiểu phải chứa mẫu thì mới coi là header/footer */
  minRatio?: number;
  /** Chiều cao vùng đầu/cuối trang xét, tính theo tỉ lệ chiều cao trang */
  marginRatio?: number;
  /** Sai số vị trí dọc cho phép giữa các trang, tính theo tỉ lệ chiều cao trang */
  positionTolerance?: number;
  /** Bỏ qua sách quá ít trang — thống kê không đủ tin cậy */
  minPages?: number;
  /**
   * Dòng dài hơn ngưỡng này không bao giờ bị coi là header/footer.
   * Running head thực tế rất ngắn (tên sách, số trang); dòng thân bài dài
   * lọt vào vùng lề chỉ vì trang tràn chữ, xoá đi là mất nội dung.
   */
  maxLength?: number;
};

const DEFAULT_MIN_RATIO = 0.6;
const DEFAULT_MARGIN_RATIO = 0.12;
const DEFAULT_POSITION_TOLERANCE = 0.03;
const DEFAULT_MIN_PAGES = 4;
const DEFAULT_MAX_LENGTH = 80;

/** Vùng dọc của một dòng so với trang */
type Zone = 'header' | 'footer' | 'body';

const zoneOf = (line: TextLine, pageHeight: number, marginRatio: number): Zone => {
  const margin = pageHeight * marginRatio;
  if (line.y < margin) return 'header';
  if (line.y + line.height > pageHeight - margin) return 'footer';
  return 'body';
};

const collapseSpaces = (text: string): string => text.replace(/\s+/g, ' ').trim();

/**
 * Chuẩn hoá nội dung để so khớp giữa các trang:
 * - gộp khoảng trắng
 * - thay mọi cụm chữ số bằng `#` (số trang đổi theo trang)
 * - bỏ phân biệt hoa thường
 */
export const normalizeForMatch = (text: string): string =>
  collapseSpaces(text).replace(/\d+/g, '#').toLowerCase();

/**
 * Phần chữ của một dòng — bỏ hẳn các cụm số thay vì thay bằng `#`.
 *
 * Đây mới là thứ dùng để gộp khoá. Chỉ thay `#` là chưa đủ: hai câu thân bài
 * khác nhau vẫn có thể trùng khung số và bị coi là cùng một running head.
 */
const letterPartOf = (text: string): string =>
  collapseSpaces(text.replace(/\d+/g, ' ')).toLowerCase();

const resolveOptions = (options: HeaderFooterOptions): Required<HeaderFooterOptions> => ({
  minRatio: options.minRatio ?? DEFAULT_MIN_RATIO,
  marginRatio: options.marginRatio ?? DEFAULT_MARGIN_RATIO,
  positionTolerance: options.positionTolerance ?? DEFAULT_POSITION_TOLERANCE,
  minPages: options.minPages ?? DEFAULT_MIN_PAGES,
  maxLength: options.maxLength ?? DEFAULT_MAX_LENGTH,
});

/**
 * Dòng có đủ điều kiện để xét làm header/footer không.
 *
 * Lọc trước khi thống kê: dòng thân bài dài lọt vào vùng lề (trang tràn chữ)
 * không được tính phiếu, nếu không cả đoạn văn bị xoá nhầm.
 */
const isCandidate = (
  line: TextLine,
  page: Page,
  options: Required<HeaderFooterOptions>,
): boolean => {
  const normalized = collapseSpaces(line.text);
  if (normalized.length === 0) return false;
  if (normalized.length > options.maxLength) return false;
  return zoneOf(line, page.height, options.marginRatio) !== 'body';
};

/** Khoá gộp một dòng theo phần chữ + vùng + vị trí dọc đã lượng tử hoá */
const keyOf = (line: TextLine, page: Page, options: Required<HeaderFooterOptions>): string => {
  const zone = zoneOf(line, page.height, options.marginRatio);
  const bucketSize = page.height * options.positionTolerance;
  const bucket = bucketSize > 0 ? Math.round(line.y / bucketSize) : 0;
  return [zone, bucket, letterPartOf(line.text)].join(' ');
};

/**
 * Tìm các khoá ứng với header/footer lặp.
 * Tách riêng khỏi `stripHeadersFooters` để test được phần thống kê.
 */
export const findRepeatedKeys = (
  pages: readonly Page[],
  options: HeaderFooterOptions = {},
): Set<string> => {
  const resolved = resolveOptions(options);

  if (pages.length < resolved.minPages) return new Set();

  // Đếm theo **số trang** chứa khoá, không phải số lần xuất hiện: một trang
  // lặp cùng một dòng hai lần không được tính thành hai phiếu.
  const pagesPerKey = new Map<string, Set<number>>();

  for (const page of pages) {
    for (const line of page.lines) {
      if (!isCandidate(line, page, resolved)) continue;

      const key = keyOf(line, page, resolved);
      const seen = pagesPerKey.get(key);
      if (seen === undefined) pagesPerKey.set(key, new Set([page.pageNumber]));
      else seen.add(page.pageNumber);
    }
  }

  const threshold = pages.length * resolved.minRatio;
  const repeated = new Set<string>();
  for (const [key, seenPages] of pagesPerKey) {
    if (seenPages.size >= threshold) repeated.add(key);
  }

  return repeated;
};

/**
 * Trả về bản sao `pages` đã bỏ các dòng header/footer lặp.
 * Không sửa mảng đầu vào.
 */
export const stripHeadersFooters = (
  pages: readonly Page[],
  options: HeaderFooterOptions = {},
): Page[] => {
  const repeated = findRepeatedKeys(pages, options);
  if (repeated.size === 0) return pages.map((page) => ({ ...page, lines: [...page.lines] }));

  const resolved = resolveOptions(options);

  return pages.map((page) => ({
    ...page,
    // Áp đúng bộ lọc đã dùng khi thống kê — nếu không, một dòng thân bài dài
    // vẫn có thể trùng khoá với header ngắn và bị xoá oan.
    lines: page.lines.filter(
      (line) => !(isCandidate(line, page, resolved) && repeated.has(keyOf(line, page, resolved))),
    ),
  }));
};
