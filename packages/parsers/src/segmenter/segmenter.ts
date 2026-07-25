import { SEGMENT_MAX_CHARS, SEGMENT_MAX_SENTENCES, SEGMENT_MIN_CHARS } from '@ln/shared';
import type { BookLang } from '@ln/shared';
import { splitSentences, type Sentence } from './sentence-splitter.js';

/**
 * Gom câu thành segment — đơn vị generate + align + seek.
 *
 * Ràng buộc: ≤ 300 ký tự (~10s audio) vì CTC aligner degrade nghiêm trọng
 * khi audio > 30s. Câu dài hơn ngưỡng phải được cắt tiếp theo dấu phẩy.
 */

export type RawSegment = {
  text: string;
  /** Vị trí trong chuỗi đầu vào, dùng để dựng anchor về tài liệu gốc */
  start: number;
  end: number;
};

export type SegmenterOptions = {
  maxChars?: number;
  maxSentences?: number;
  /** Segment ngắn hơn ngưỡng này sẽ được gộp với segment kế nếu còn chỗ */
  minChars?: number;
  lang?: BookLang;
};

/** Ưu tiên cắt tại các dấu này khi câu vượt quá maxChars */
const BREAK_CHARS = [';', ':', '—', '–', ',', ' '] as const;

/**
 * Tìm vị trí cắt tốt nhất trong `text` sao cho phần đầu ≤ `limit`.
 * Trả về độ dài phần đầu; 0 nghĩa là không tìm được chỗ cắt hợp lý.
 */
const findBreakPoint = (text: string, limit: number): number => {
  if (text.length <= limit) return text.length;

  // Không cắt quá sát đầu câu — mảnh quá ngắn khó nghe
  const minKeep = Math.floor(limit * 0.4);

  for (const breakChar of BREAK_CHARS) {
    const at = text.lastIndexOf(breakChar, limit);
    if (at >= minKeep) {
      // Giữ dấu phân cách ở lại mảnh trước, trừ khoảng trắng
      return breakChar === ' ' ? at : at + 1;
    }
  }

  return 0;
};

/** Cắt một câu dài thành nhiều mảnh ≤ maxChars */
const splitLongSentence = (sentence: Sentence, maxChars: number): RawSegment[] => {
  const parts: RawSegment[] = [];
  let rest = sentence.text;
  let offset = sentence.start;

  while (rest.length > maxChars) {
    const at = findBreakPoint(rest, maxChars);
    // Không có chỗ cắt tự nhiên: cắt cứng để không vượt ngưỡng
    const cut = at > 0 ? at : maxChars;

    const chunk = rest.slice(0, cut);
    const trimmed = chunk.trim();
    if (trimmed.length > 0) {
      const leading = chunk.length - chunk.trimStart().length;
      parts.push({
        text: trimmed,
        start: offset + leading,
        end: offset + leading + trimmed.length,
      });
    }

    offset += cut;
    rest = rest.slice(cut);
  }

  const trimmed = rest.trim();
  if (trimmed.length > 0) {
    const leading = rest.length - rest.trimStart().length;
    parts.push({
      text: trimmed,
      start: offset + leading,
      end: offset + leading + trimmed.length,
    });
  }

  return parts;
};

/**
 * Chia văn bản thành segment.
 *
 * Thuật toán: tách câu → gom 1–3 câu miễn tổng ≤ maxChars → câu nào tự nó
 * dài hơn maxChars thì cắt tiếp theo dấu phẩy/khoảng trắng.
 */
export const segmentText = (text: string, options: SegmenterOptions = {}): RawSegment[] => {
  const maxChars = options.maxChars ?? SEGMENT_MAX_CHARS;
  const maxSentences = options.maxSentences ?? SEGMENT_MAX_SENTENCES;
  const minChars = options.minChars ?? SEGMENT_MIN_CHARS;

  if (maxChars < 1) throw new Error(`maxChars phải ≥ 1, nhận ${maxChars}`);
  if (maxSentences < 1) throw new Error(`maxSentences phải ≥ 1, nhận ${maxSentences}`);

  const sentences = splitSentences(text, options.lang ?? 'vi');
  const segments: RawSegment[] = [];

  let buffer: Sentence[] = [];
  let bufferLength = 0;

  /**
   * Giữa hai câu có xuống dòng không.
   *
   * Sau cleaner, `\n` là **ranh giới đoạn đã xác định** (tiêu đề, dòng hội
   * thoại, đoạn văn mới). Gộp hai đoạn vào một segment sẽ đọc dính tiêu đề
   * vào thân bài, và khối text lọt vào segment vẫn còn ký tự `\n` bên trong.
   */
  const brokenBetween = (previous: Sentence, next: Sentence): boolean =>
    text.slice(previous.end, next.start).includes('\n');

  const flush = (): void => {
    if (buffer.length === 0) return;

    const first = buffer[0];
    const last = buffer.at(-1);
    if (first === undefined || last === undefined) return;

    segments.push({
      text: buffer.map((s) => s.text).join(' '),
      start: first.start,
      end: last.end,
    });

    buffer = [];
    bufferLength = 0;
  };

  for (const sentence of sentences) {
    // Câu dài hơn ngưỡng: xả buffer rồi cắt riêng câu đó
    if (sentence.text.length > maxChars) {
      flush();
      segments.push(...splitLongSentence(sentence, maxChars));
      continue;
    }

    // Ranh giới đoạn: xả buffer để không gộp hai đoạn vào một segment
    const previous = buffer.at(-1);
    if (previous !== undefined && brokenBetween(previous, sentence)) {
      flush();
    }

    // +1 cho khoảng trắng nối giữa hai câu
    const lengthIfAdded =
      buffer.length === 0 ? sentence.text.length : bufferLength + 1 + sentence.text.length;

    if (buffer.length >= maxSentences || lengthIfAdded > maxChars) {
      flush();
    }

    // Tính lại sau flush: buffer có thể vừa bị xả nên độ dài cũ không còn đúng
    bufferLength =
      buffer.length === 0 ? sentence.text.length : bufferLength + 1 + sentence.text.length;
    buffer.push(sentence);
  }

  flush();

  return mergeShortSegments(segments, maxChars, maxSentences, minChars, text);
};

/**
 * Gộp segment quá ngắn vào segment liền kề nếu không vượt ngưỡng.
 * Segment 2–3 từ tách riêng nghe rất vụn khi phát liên tục.
 *
 * Chỉ gộp khi segment trước cũng chưa dùng hết hạn ngạch câu — nếu không
 * bước gộp sẽ phá vỡ giới hạn `maxSentences` mà bước gom vừa áp dụng.
 *
 * Cũng không gộp qua ranh giới đoạn (`\n`), nếu không bước này sẽ dán lại
 * đúng những đoạn mà bước gom vừa cố ý tách ra.
 */
const mergeShortSegments = (
  segments: readonly RawSegment[],
  maxChars: number,
  maxSentences: number,
  minChars: number,
  source: string,
): RawSegment[] => {
  if (minChars <= 0) return [...segments];

  const merged: RawSegment[] = [];
  // Số câu của từng segment trong `merged`, để không vượt maxSentences
  const sentenceCounts: number[] = [];

  for (const segment of segments) {
    const previous = merged.at(-1);
    const previousCount = sentenceCounts.at(-1) ?? 0;
    const count = countSentences(segment.text);

    if (
      previous !== undefined &&
      segment.text.length < minChars &&
      previousCount + count <= maxSentences &&
      previous.text.length + 1 + segment.text.length <= maxChars &&
      !source.slice(previous.end, segment.start).includes('\n')
    ) {
      merged[merged.length - 1] = {
        text: `${previous.text} ${segment.text}`,
        start: previous.start,
        end: segment.end,
      };
      sentenceCounts[sentenceCounts.length - 1] = previousCount + count;
      continue;
    }

    merged.push(segment);
    sentenceCounts.push(count);
  }

  return merged;
};

/** Đếm số câu trong một segment đã gom */
const countSentences = (text: string): number => splitSentences(text).length;
