/**
 * Model đầu vào của cleaner.
 *
 * Parser PDF sinh ra `TextLine` có toạ độ; parser DOCX không có toạ độ nên
 * chỉ dùng được nhóm hàm thao tác trên chuỗi (de-hyphenate, merge dòng).
 * Giữ hai tầng tách biệt để mỗi hàm thuần vẫn dùng được độc lập.
 */

/** Một dòng text đã trích từ trang PDF, kèm toạ độ trong không gian trang (point) */
export type TextLine = {
  text: string;
  /** Mép trái của dòng */
  x: number;
  /** Mép trên của dòng, gốc toạ độ ở góc trên-trái */
  y: number;
  width: number;
  height: number;
  /**
   * Cỡ chữ lớn nhất trong dòng (point). Optional vì cleaner không cần tới —
   * chỉ chapter detector dùng để so với cỡ chữ thân bài.
   */
  fontSize?: number;
};

export type Page = {
  /** Số trang bắt đầu từ 1 */
  pageNumber: number;
  width: number;
  height: number;
  lines: TextLine[];
};
