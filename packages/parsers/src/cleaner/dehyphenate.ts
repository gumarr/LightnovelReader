/**
 * Nối lại từ bị ngắt bởi dấu gạch nối cuối dòng (`nhân-\nvật` → `nhân vật`).
 *
 * Bẫy với tiếng Việt: từ ghép có gạch nối thật (`Hà-Nội`, `in-tơ-nét`) và
 * gạch nối là dấu câu (`—`, `–`) không được xử lý như ngắt dòng. Chỉ nhận
 * hyphen ASCII `-` và `‐` (U+2010) đứng ngay cuối dòng, giữa hai cụm chữ.
 */

/** Hyphen được coi là dấu ngắt từ cuối dòng */
const LINE_BREAK_HYPHENS = '-‐';

/**
 * Ký tự chữ: Latin có dấu tiếng Việt được biểu diễn cả dạng dựng sẵn lẫn
 * dạng tổ hợp, nên phải cho phép dấu thanh đứng rời (`\p{M}`).
 */
const LETTER = '[\\p{L}\\p{M}]';

/**
 * Từ bị ngắt: cụm chữ + hyphen + xuống dòng + cụm chữ.
 * Chữ cái đầu phần sau phải là **chữ thường** — chữ hoa gần như luôn là
 * đầu một dòng mới độc lập, nối vào sẽ hỏng câu.
 */
const HYPHEN_BREAK = new RegExp(
  `(${LETTER}+)[${LINE_BREAK_HYPHENS}][ \\t]*\\r?\\n[ \\t]*(\\p{Ll}${LETTER}*)`,
  'gu',
);

export type DehyphenateOptions = {
  /**
   * Từ ghép vốn **có** gạch nối (`in-tơ-nét`, `Hà-Nội`). Viết ở dạng đầy đủ
   * kèm gạch nối; nếu chỗ ngắt rơi đúng vào một gạch nối của từ trong danh
   * sách này thì giữ lại gạch nối thay vì bỏ đi.
   */
  keepHyphenWords?: readonly string[];
};

/**
 * Nối các từ bị ngắt cuối dòng. Xuống dòng bị tiêu thụ luôn vì nó thuộc về
 * lỗi ngắt từ, không phải ranh giới đoạn.
 */
export const dehyphenate = (text: string, options: DehyphenateOptions = {}): string => {
  const keep = new Set((options.keepHyphenWords ?? []).map((w) => w.toLowerCase()));

  return text.replace(HYPHEN_BREAK, (_match, head: string, tail: string) => {
    if (keepsHyphen(head, tail, keep)) return `${head}-${tail}`;
    return `${head}${tail}`;
  });
};

/**
 * Chỗ ngắt có phải là gạch nối thật của một từ ghép không.
 *
 * `head`/`tail` chỉ là cụm chữ sát hai bên dấu ngắt, còn từ trong danh sách
 * có thể nhiều gạch nối (`in-tơ-nét`): so khớp bằng cách kiểm tra tồn tại
 * một từ chứa `head-tail` ở đúng ranh giới thành phần.
 */
const keepsHyphen = (head: string, tail: string, keep: ReadonlySet<string>): boolean => {
  if (keep.size === 0) return false;

  const pair = `${head}-${tail}`.toLowerCase();
  for (const word of keep) {
    if (word === pair) return true;
    // Ghép nằm giữa từ dài hơn: phải trùng trọn vẹn thành phần hai bên
    if (word.startsWith(`${pair}-`) || word.endsWith(`-${pair}`) || word.includes(`-${pair}-`)) {
      return true;
    }
  }

  return false;
};
