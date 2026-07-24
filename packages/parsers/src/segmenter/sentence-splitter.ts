import type { BookLang } from '@ln/shared';

/**
 * Tách văn bản thành câu. Rule-based cho cả VI và EN — Light Novel có nhiều
 * hội thoại và dấu ngoặc kép kiểu Nhật (「」『』) mà thư viện tách câu
 * thông thường xử lý sai.
 */

export type Sentence = {
  text: string;
  /** Vị trí bắt đầu trong chuỗi gốc, dùng để map anchor về tài liệu */
  start: number;
  /** Vị trí kết thúc (không bao gồm) */
  end: number;
};

/** Dấu kết thúc câu. Bao gồm cả dạng full-width dùng trong LN dịch từ tiếng Nhật. */
const TERMINATORS = new Set(['.', '!', '?', '…', '。', '！', '？']);

/** Dấu đóng được phép đứng sau dấu kết thúc câu mà vẫn thuộc câu đó */
const CLOSERS = new Set(['"', "'", '”', '’', ')', ']', '»', '」', '』', '】', '〉']);

/**
 * Viết tắt phổ biến — dấu chấm sau chúng KHÔNG kết thúc câu.
 * So khớp không phân biệt hoa thường, chỉ xét phần chữ ngay trước dấu chấm.
 */
const ABBREVIATIONS = new Set([
  // Tiếng Việt
  'tp',
  'ts',
  'pgs',
  'gs',
  'ths',
  'bs',
  'kts',
  'tt',
  'tphcm',
  'q',
  'p',
  'st',
  'đ',
  // Tiếng Anh
  'mr',
  'mrs',
  'ms',
  'dr',
  'prof',
  'sr',
  'jr',
  'st',
  'vs',
  'etc',
  'inc',
  'ltd',
  'co',
  'e.g',
  'i.e',
  'approx',
  'no',
  'vol',
  'ch',
  'fig',
  'al',
]);

const isDigit = (ch: string): boolean => ch >= '0' && ch <= '9';

const isWhitespace = (ch: string): boolean => /\s/.test(ch);

/** Lấy cụm chữ liền ngay trước vị trí `index` (không tính dấu chấm), giữ nguyên hoa thường */
const wordBefore = (text: string, index: number): string => {
  let start = index;
  while (start > 0) {
    const ch = text[start - 1];
    if (ch === undefined || isWhitespace(ch)) break;
    start -= 1;
  }
  return text.slice(start, index);
};

/**
 * Dấu chấm sau chữ cái hoa đơn thường là viết tắt tên riêng ("J. R. Tolkien").
 *
 * Chỉ nhận chữ Latin HOA KHÔNG DẤU: tiếng Việt có nhiều thán từ một chữ
 * ("Ừ.", "À.", "Ồ.") đứng thành câu hoàn chỉnh, coi chúng là viết tắt sẽ
 * dính câu sau vào — lỗi thấy rõ trong hội thoại Light Novel.
 */
const isInitial = (word: string): boolean => word.length === 1 && /^[A-Z]$/.test(word);

/** Kiểm tra dấu chấm ở `index` có thực sự kết thúc câu không */
const isSentenceEnd = (text: string, index: number): boolean => {
  const ch = text[index];
  if (ch === undefined || !TERMINATORS.has(ch)) return false;

  if (ch === '.') {
    // Số thập phân hoặc phân cách nghìn: 3.14 — không tách
    const prev = text[index - 1];
    const next = text[index + 1];
    if (prev !== undefined && next !== undefined && isDigit(prev) && isDigit(next)) return false;

    const word = wordBefore(text, index);
    if (ABBREVIATIONS.has(word.toLowerCase()) || isInitial(word)) return false;
  }

  return true;
};

/**
 * Sau dấu kết thúc, bỏ qua các dấu đóng và dấu kết thúc lặp ("?!", "…")
 * để lấy vị trí thật sự hết câu.
 */
const consumeTrailing = (text: string, index: number): number => {
  let end = index + 1;

  while (end < text.length) {
    const ch = text[end];
    if (ch === undefined) break;
    if (TERMINATORS.has(ch) || CLOSERS.has(ch)) end += 1;
    else break;
  }

  return end;
};

/**
 * Tách câu. `lang` hiện chỉ ảnh hưởng tới bảng viết tắt (đã gộp chung),
 * giữ tham số để mở rộng khi thêm ngôn ngữ mà không đổi chữ ký hàm.
 */
export const splitSentences = (text: string, _lang: BookLang = 'vi'): Sentence[] => {
  const sentences: Sentence[] = [];
  let cursor = 0;

  for (let i = 0; i < text.length; i += 1) {
    if (!isSentenceEnd(text, i)) continue;

    const end = consumeTrailing(text, i);
    const raw = text.slice(cursor, end);
    const trimmed = raw.trim();

    if (trimmed.length > 0) {
      const leading = raw.length - raw.trimStart().length;
      sentences.push({
        text: trimmed,
        start: cursor + leading,
        end: cursor + leading + trimmed.length,
      });
    }

    cursor = end;
    i = end - 1;
  }

  // Phần còn lại không kết thúc bằng dấu câu vẫn là một câu
  const rest = text.slice(cursor);
  const trimmedRest = rest.trim();
  if (trimmedRest.length > 0) {
    const leading = rest.length - rest.trimStart().length;
    sentences.push({
      text: trimmedRest,
      start: cursor + leading,
      end: cursor + leading + trimmedRest.length,
    });
  }

  return sentences;
};
