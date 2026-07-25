/**
 * Tín hiệu: dòng khớp mẫu tiêu đề chương.
 *
 * Đo trên file mẫu thật cho thấy đây là tín hiệu **quan trọng nhất** với PDF
 * không có outline: file EN mẫu có tiêu đề `"Chapter 1 :"` cùng cỡ chữ 13pt
 * y hệt thân bài, font-size heuristic hoàn toàn không thấy.
 */

/**
 * Số chương trong LN dịch hay viết bằng chữ ("Chương Một", "Chương Bốn"),
 * không phải chữ số. Bảng này cần cho cả regex lẫn việc sắp thứ tự.
 */
const VI_ORDINALS = [
  'không',
  'một',
  'hai',
  'ba',
  'bốn',
  'năm',
  'sáu',
  'bảy',
  'tám',
  'chín',
  'mười',
  'mười một',
  'mười hai',
  'mười ba',
  'mười bốn',
  'mười lăm',
  'mười sáu',
  'mười bảy',
  'mười tám',
  'mười chín',
  'hai mươi',
] as const;

/** Từ khoá mở đầu một chương. Gồm cả phần không đánh số (mở đầu, lời bạt). */
const CHAPTER_WORDS = [
  // Tiếng Việt
  'chương',
  'phần',
  'quyển',
  'hồi',
  'mở đầu',
  'kết',
  'lời bạt',
  'lời tác giả',
  'ngoại truyện',
  'phiên ngoại',
  'truyện ngắn',
  // Tiếng Anh
  'chapter',
  'part',
  'volume',
  'book',
  'prologue',
  'epilogue',
  'interlude',
  'afterword',
  'foreword',
  'preface',
  'side story',
  'extra',
] as const;

/** Chữ số La Mã — một số bản dịch dùng "Chapter IV" */
const ROMAN = '(?:[ivxlcdm]+)';

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Mẫu tiêu đề: từ khoá + (số | chữ số La Mã | số viết bằng chữ) tuỳ chọn,
 * rồi tuỳ chọn dấu phân cách và phần tên.
 *
 * `^` bắt buộc — tiêu đề phải ở đầu dòng. Không có neo này thì
 * `"…the last part left, most of…"` cũng khớp (lỗi thật gặp trên file mẫu EN).
 */
const buildTitleRegex = (): RegExp => {
  const words = CHAPTER_WORDS.map(escapeRegex).join('|');
  const ordinals = VI_ORDINALS.map(escapeRegex).join('|');
  const number = `(?:\\d{1,3}|${ROMAN}|${ordinals})`;
  return new RegExp(`^\\s*(?:${words})(?:\\s+${number})?\\s*(?:[:.：、\\-–—]|$)`, 'iu');
};

const TITLE_REGEX = buildTitleRegex();

/** Tiêu đề chương hiếm khi dài — dòng dài gần chắc chắn là văn xuôi */
const MAX_TITLE_LENGTH = 120;

/**
 * Dòng kết thúc bằng dấu câu giữa câu (`,` `;`) hoặc chứa dấu kết câu ở giữa
 * thì là văn xuôi, không phải tiêu đề.
 */
const looksLikeProse = (text: string): boolean => {
  const trimmed = text.trim();
  if (trimmed.length > MAX_TITLE_LENGTH) return true;
  // Dấu kết câu ở giữa dòng (còn chữ phía sau) → là câu văn
  return /[.!?…。][^\s]*\s+\S/.test(trimmed.replace(/^\s*\S+[.:]\s*/, ''));
};

/**
 * Chấm điểm mẫu tiêu đề, trả 0–1.
 *
 * - 1.0 — khớp mẫu đầy đủ có số ("Chương Một:", "Chapter 1 :")
 * - 0.7 — khớp từ khoá không đánh số ("Mở đầu:", "Prologue :")
 * - 0.0 — không khớp, hoặc khớp nhưng trông như văn xuôi
 */
export const scorePattern = (text: string): number => {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  if (!TITLE_REGEX.test(trimmed)) return 0;
  if (looksLikeProse(trimmed)) return 0;

  return hasNumber(trimmed) ? 1 : 0.7;
};

/** Sau từ khoá có phần đánh số không */
const hasNumber = (text: string): boolean => {
  const words = CHAPTER_WORDS.map(escapeRegex).join('|');
  const ordinals = VI_ORDINALS.map(escapeRegex).join('|');
  const re = new RegExp(`^\\s*(?:${words})\\s+(?:\\d{1,3}|${ROMAN}|${ordinals})\\b`, 'iu');
  return re.test(text);
};
