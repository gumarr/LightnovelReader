import type { OutlineEntry } from '../types.js';

/**
 * Tín hiệu outline — mạnh nhất khi có.
 *
 * Quan trọng: outline **không chỉ chứa chương**. File mẫu VI có 10 mục gồm
 * cả "Bản quyền", "Lời tác giả", "Lời bạt". Detector giữ nguyên tất cả rồi
 * để user loại ở màn xác nhận (P1.5) — tự đoán mục nào là chương sẽ xoá
 * nhầm ngoại truyện, phiên ngoại vốn là nội dung thật.
 */

/** Mục outline hợp lệ: có tiêu đề và trỏ tới trang xác định */
export const isUsableEntry = (entry: OutlineEntry): boolean =>
  entry.title.trim().length > 0 && entry.pageNumber !== undefined && entry.pageNumber >= 1;

/**
 * Lọc và chuẩn hoá outline thành danh sách dùng được:
 * - bỏ mục không có đích trang
 * - sắp theo số trang
 * - gộp mục trùng trang (giữ mục đầu — mục con thường trỏ cùng trang với cha)
 */
export const normalizeOutline = (
  entries: readonly OutlineEntry[],
): { title: string; pageNumber: number }[] => {
  const usable = entries
    .filter(isUsableEntry)
    .map((e) => ({ title: e.title.trim(), pageNumber: e.pageNumber as number }))
    .sort((a, b) => a.pageNumber - b.pageNumber);

  const result: { title: string; pageNumber: number }[] = [];
  for (const entry of usable) {
    const previous = result.at(-1);
    if (previous !== undefined && previous.pageNumber === entry.pageNumber) continue;
    result.push(entry);
  }

  return result;
};

/**
 * Điểm cho một dòng dựa trên việc nó có khớp mục outline trỏ tới trang đó không.
 *
 * Trả 1 khi text dòng khớp tiêu đề outline (so khớp nới lỏng — PDF hay tách
 * tiêu đề dài thành nhiều dòng nên chỉ cần dòng là **tiền tố** của tiêu đề),
 * 0.8 khi đúng trang nhưng text không khớp.
 */
export const scoreOutline = (
  text: string,
  pageNumber: number,
  outline: readonly { title: string; pageNumber: number }[],
): number => {
  const entry = outline.find((e) => e.pageNumber === pageNumber);
  if (entry === undefined) return 0;

  const a = looseNormalize(text);
  const b = looseNormalize(entry.title);
  if (a.length === 0) return 0;

  if (a === b) return 1;
  // Tiêu đề dài bị PDF ngắt thành nhiều dòng
  if (b.startsWith(a) || a.startsWith(b)) return 1;

  return 0.8;
};

/** Bỏ dấu câu và khoảng trắng thừa để so khớp nới lỏng */
const looseNormalize = (text: string): string =>
  text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[:.：、,;–—-]+$/u, '')
    .trim()
    .toLowerCase();
