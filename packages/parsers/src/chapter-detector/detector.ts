import { FALLBACK_PAGES_PER_CHAPTER } from '@ln/shared';
import { bodyFontSize, scoreFontSize } from './signals/font-size.js';
import { normalizeOutline, scoreOutline } from './signals/outline.js';
import { scorePattern } from './signals/pattern.js';
import { scorePosition, scoreSparsePage } from './signals/position.js';
import { isTableOfContents } from './signals/toc.js';
import type { DetectSource, DetectedChapter, ScoredCandidate, SignalScores } from './types.js';

/**
 * Tổng hợp các tín hiệu thành danh sách chương.
 *
 * Thứ tự ưu tiên theo plan: outline → font size → regex → vị trí → fallback
 * chia theo trang. Nhưng không chạy tuần tự "có cái này thì bỏ cái kia" —
 * mọi tín hiệu đều chấm điểm, chỉ khác trọng số. Lý do: file mẫu EN không có
 * outline **lẫn** font lớn hơn thân bài, chỉ regex + vị trí cứu được.
 */

export type DetectOptions = {
  /** Điểm tối thiểu để một dòng được coi là tiêu đề chương */
  minScore?: number;
  /** Số trang mỗi chương khi phải rơi về fallback */
  fallbackPagesPerChapter?: number;
  weights?: Partial<SignalWeights>;
};

export type SignalWeights = {
  outline: number;
  fontSize: number;
  pattern: number;
  position: number;
  sparsePage: number;
};

/**
 * Trọng số. Outline áp đảo vì khi có nó thì gần như chắc chắn đúng.
 *
 * `position` và `sparsePage` cố ý thấp: chúng là tín hiệu **hỗ trợ**, một
 * mình không đủ kết luận (mọi trang đều có dòng đầu tiên). Chúng chỉ đủ sức
 * đẩy một ứng viên đã khớp regex vượt ngưỡng.
 */
const DEFAULT_WEIGHTS: SignalWeights = {
  outline: 3,
  fontSize: 1.5,
  pattern: 1.5,
  position: 0.6,
  sparsePage: 0.4,
};

/**
 * Ngưỡng nhận. Chọn 1.4 để:
 * - regex mạnh (1.0 × 1.5 = 1.5) một mình đủ qua
 * - font lớn (1.0 × 1.5 = 1.5) một mình đủ qua
 * - vị trí + trang thưa (0.6 + 0.4 = 1.0) một mình KHÔNG đủ
 */
const DEFAULT_MIN_SCORE = 1.4;

/** Chỉ xét N dòng đầu mỗi trang — tiêu đề chương không nằm cuối trang */
const MAX_LINES_PER_PAGE = 8;

const weightedTotal = (scores: SignalScores, weights: SignalWeights): number =>
  scores.outline * weights.outline +
  scores.fontSize * weights.fontSize +
  scores.pattern * weights.pattern +
  scores.position * weights.position +
  scores.sparsePage * weights.sparsePage;

/**
 * Chấm điểm mọi dòng có thể là tiêu đề.
 * Tách riêng khỏi `detectChapters` để `/detect` in được bảng điểm.
 */
export const scoreCandidates = (
  source: DetectSource,
  options: DetectOptions = {},
): ScoredCandidate[] => {
  const weights = { ...DEFAULT_WEIGHTS, ...options.weights };
  const outline = normalizeOutline(source.outline ?? []);
  const bodySize = bodyFontSize(source.pages);

  const candidates: ScoredCandidate[] = [];

  for (const page of source.pages) {
    // Trang mục lục ăn điểm y hệt tiêu đề chương (font lớn + đầu trang) nhưng
    // không phải nội dung. Bỏ qua — trừ khi outline trỏ đích danh vào nó, vì
    // outline là nguồn đáng tin hơn mọi suy luận.
    const inOutline = outline.some((e) => e.pageNumber === page.pageNumber);
    if (!inOutline && isTableOfContents(page)) continue;

    const sparse = scoreSparsePage(source.pages, page.pageNumber);

    const contentIndexes = page.lines
      .map((line, index) => ({ line, index }))
      .filter((x) => x.line.text.trim().length > 0)
      .slice(0, MAX_LINES_PER_PAGE);

    for (const { line, index } of contentIndexes) {
      const scores: SignalScores = {
        outline: scoreOutline(line.text, page.pageNumber, outline),
        fontSize: scoreFontSize(line, bodySize),
        pattern: scorePattern(line.text),
        position: scorePosition(page, index),
        sparsePage: sparse,
      };

      const total = weightedTotal(scores, weights);
      if (total <= 0) continue;

      candidates.push({
        pageNumber: page.pageNumber,
        lineIndex: index,
        text: line.text.trim(),
        scores,
        total,
      });
    }
  }

  return candidates.sort((a, b) => b.total - a.total);
};

/**
 * Phát hiện chương. Luôn trả về ít nhất một chương — sách nào cũng phải đọc
 * được, kể cả khi không nhận ra cấu trúc nào.
 */
export const detectChapters = (
  source: DetectSource,
  options: DetectOptions = {},
): DetectedChapter[] => {
  const minScore = options.minScore ?? DEFAULT_MIN_SCORE;

  const accepted = scoreCandidates(source, options)
    .filter((c) => c.total >= minScore)
    .sort((a, b) => a.pageNumber - b.pageNumber || a.lineIndex - b.lineIndex);

  // Mỗi trang chỉ giữ ứng viên điểm cao nhất — tiêu đề bị ngắt thành nhiều
  // dòng sẽ sinh ra vài ứng viên cùng trang, tất cả cùng trỏ về một chương.
  const bestPerPage = new Map<number, ScoredCandidate>();
  for (const candidate of accepted) {
    const current = bestPerPage.get(candidate.pageNumber);
    if (current === undefined || candidate.total > current.total) {
      bestPerPage.set(candidate.pageNumber, candidate);
    }
  }

  const starts = [...bestPerPage.values()].sort((a, b) => a.pageNumber - b.pageNumber);

  if (starts.length === 0) return fallbackByPage(source, options);

  const outline = normalizeOutline(source.outline ?? []);

  return starts.map((candidate, i) => ({
    index: i,
    title: titleFor(candidate, outline),
    pageStart: candidate.pageNumber,
    pageEnd: (starts[i + 1]?.pageNumber ?? source.totalPages + 1) - 1,
    confidence: candidate.total,
  }));
};

/**
 * Tên chương lấy từ outline khi có — outline là nguồn đáng tin nhất về *tên*,
 * kể cả khi text trên trang không khớp.
 *
 * Không có bước này thì chương do outline sinh ra lấy nhầm tên từ dòng thân
 * bài đầu trang ("Câu văn thân bài thứ 0."), vô nghĩa với người dùng.
 */
const titleFor = (
  candidate: ScoredCandidate,
  outline: readonly { title: string; pageNumber: number }[],
): string => {
  const entry = outline.find((e) => e.pageNumber === candidate.pageNumber);
  return entry?.title ?? candidate.text;
};

/**
 * Fallback: chia đều theo trang khi không nhận ra tín hiệu nào.
 *
 * Không bao giờ trả mảng rỗng — user vẫn phải mở được sách rồi tự sửa cấu
 * trúc ở màn xác nhận.
 */
export const fallbackByPage = (
  source: DetectSource,
  options: DetectOptions = {},
): DetectedChapter[] => {
  const perChapter = options.fallbackPagesPerChapter ?? FALLBACK_PAGES_PER_CHAPTER;
  const total = Math.max(source.totalPages, 1);
  const size = Math.max(perChapter, 1);

  const chapters: DetectedChapter[] = [];
  for (let start = 1; start <= total; start += size) {
    chapters.push({
      index: chapters.length,
      title: `Phần ${chapters.length + 1}`,
      pageStart: start,
      pageEnd: Math.min(start + size - 1, total),
      confidence: 0,
    });
  }

  return chapters;
};
