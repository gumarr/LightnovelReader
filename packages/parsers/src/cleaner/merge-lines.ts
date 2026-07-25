/**
 * Nối các dòng bị PDF ngắt giữa câu.
 *
 * PDF không có khái niệm đoạn văn — mỗi dòng hiển thị là một dòng text riêng.
 * Nếu cứ giữ nguyên `\n`, segmenter sẽ coi mỗi dòng là một đơn vị và audio
 * bị vụn. Ngược lại, nối tất cả sẽ mất ranh giới đoạn và hội thoại.
 *
 * Quy tắc: nối dòng hiện tại với dòng sau **trừ khi** có tín hiệu kết đoạn.
 */

/** Dấu kết thúc câu, gồm cả dạng full-width trong LN dịch từ tiếng Nhật */
const TERMINATORS = new Set(['.', '!', '?', '…', '。', '！', '？', ':', '：']);

/** Dấu đóng đứng sau dấu kết câu mà vẫn thuộc câu đó */
const CLOSERS = new Set(['"', "'", '”', '’', ')', ']', '»', '」', '』', '】', '〉']);

/** Ký tự mở hội thoại — dòng bắt đầu bằng chúng luôn là dòng mới */
const DIALOGUE_OPENERS = new Set(['「', '『', '"', '“', '—', '–', '-', '*', '•']);

export type MergeLinesOptions = {
  /**
   * Dòng ngắn hơn `shortLineRatio` × độ dài dòng **trung vị** được coi là
   * dòng cuối đoạn, không nối với dòng sau. Đặt 0 để tắt luật này.
   */
  shortLineRatio?: number;
  /** Dưới số dòng này thì không suy luận thống kê độ dài */
  minLinesForStats?: number;
};

const DEFAULT_SHORT_LINE_RATIO = 0.6;

/**
 * Cần đủ dòng thì trung vị mới có nghĩa. Với 2–3 dòng, một dòng cuối câu
 * ngắn tự nhiên đã kéo lệch thống kê và bị cắt oan.
 */
const DEFAULT_MIN_LINES_FOR_STATS = 5;

/**
 * Trung vị thay vì trung bình: chỉ một tiêu đề ngắn cũng đủ kéo trung bình
 * xuống, khiến các dòng thân bài bình thường bị coi là ngắn.
 */
const medianOf = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
};

/** Bỏ các dấu đóng ở cuối để lấy ký tự nội dung cuối cùng */
const lastMeaningfulChar = (line: string): string | undefined => {
  for (let i = line.length - 1; i >= 0; i -= 1) {
    const ch = line[i];
    if (ch === undefined) return undefined;
    if (!CLOSERS.has(ch)) return ch;
  }
  return undefined;
};

/** Dòng kết thúc bằng dấu câu → đã trọn ý, không nối */
export const endsSentence = (line: string): boolean => {
  const ch = lastMeaningfulChar(line.trimEnd());
  return ch !== undefined && TERMINATORS.has(ch);
};

/** Dòng mở đầu bằng dấu hội thoại hoặc gạch đầu dòng → luôn là dòng mới */
export const startsNewBlock = (line: string): boolean => {
  const ch = line.trimStart()[0];
  return ch !== undefined && DIALOGUE_OPENERS.has(ch);
};

/**
 * Nối hai dòng. Nếu dòng trước kết thúc bằng ký tự chữ và dòng sau bắt đầu
 * bằng ký tự chữ thì cần một khoảng trắng; các trường hợp khác giữ nguyên
 * để không chèn khoảng trắng trước dấu câu.
 */
const joinLines = (left: string, right: string): string => {
  const trimmedRight = right.trimStart();
  if (trimmedRight.length === 0) return left;
  if (left.endsWith(' ')) return `${left}${trimmedRight}`;
  return `${left} ${trimmedRight}`;
};

/**
 * Nối dòng trong một khối text đã de-hyphenate.
 *
 * Dòng trống được giữ làm ranh giới đoạn — đây là tín hiệu chia đoạn đáng
 * tin nhất còn sót lại sau khi PDF mất cấu trúc.
 */
export const mergeLines = (text: string, options: MergeLinesOptions = {}): string => {
  const shortLineRatio = options.shortLineRatio ?? DEFAULT_SHORT_LINE_RATIO;
  const minLinesForStats = options.minLinesForStats ?? DEFAULT_MIN_LINES_FOR_STATS;

  const lines = text.split(/\r?\n/);
  const contentLengths = lines.map((l) => l.trim().length).filter((n) => n > 0);
  const shortThreshold =
    contentLengths.length < minLinesForStats ? 0 : medianOf(contentLengths) * shortLineRatio;

  const output: string[] = [];
  let current = '';

  const flush = (): void => {
    if (current.trim().length > 0) output.push(current.trim());
    current = '';
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Dòng trống = ranh giới đoạn, giữ lại
    if (line.length === 0) {
      flush();
      continue;
    }

    // Dòng ngắn bất thường đứng riêng hẳn một khối: không nối vào khối trước,
    // cũng không nhận dòng sau. Dòng bị wrap giữa câu thì đã chạy hết bề
    // ngang nên không thể ngắn — ngắn tức là tiêu đề hoặc câu kết đoạn.
    if (isShortLine(line, shortThreshold)) {
      flush();
      output.push(line);
      continue;
    }

    if (current.length === 0) {
      current = line;
      continue;
    }

    // Dòng sau mở đầu khối mới, hoặc dòng trước đã trọn ý → cắt
    if (startsNewBlock(line) || endsSentence(current)) {
      flush();
      current = line;
      continue;
    }

    current = joinLines(current, line);
  }

  flush();

  return output.join('\n');
};

/**
 * Dòng ngắn bất thường so với phần còn lại → nhiều khả năng là tiêu đề hoặc
 * dòng cuối đoạn mà tác giả không chấm câu, không nên nối với dòng liền kề.
 */
const isShortLine = (line: string, threshold: number): boolean =>
  threshold > 0 && line.trim().length < threshold;
