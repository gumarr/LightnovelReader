import type { Page } from '../cleaner/types.js';

/**
 * Model cho chapter detection.
 *
 * Mỗi tín hiệu là một hàm thuần trả **điểm số** (không phải boolean), rồi
 * một hàm tổng hợp cộng điểm có trọng số. Lý do: không tín hiệu nào một mình
 * đủ tin cậy — file có outline thì outline là chân lý, file không có thì
 * phải gộp nhiều tín hiệu yếu lại.
 */

/** Một mục trong outline/bookmark của PDF */
export type OutlineEntry = {
  title: string;
  /** Số trang bắt đầu từ 1. `undefined` khi PDF ghi đích hỏng */
  pageNumber?: number;
};

/** Ứng viên tiêu đề chương — một dòng cụ thể trên một trang cụ thể */
export type TitleCandidate = {
  pageNumber: number;
  /** Chỉ số dòng trong `Page.lines` */
  lineIndex: number;
  text: string;
};

/**
 * Điểm của từng tín hiệu cho một ứng viên. Giữ tách bạch để `/detect` in ra
 * được và để biết ứng viên bị loại vì tín hiệu nào.
 */
export type SignalScores = {
  /** Khớp mục outline (tín hiệu mạnh nhất) */
  outline: number;
  /** Font lớn hơn thân bài */
  fontSize: number;
  /** Khớp regex tiêu đề ("Chương Một:", "Chapter 1 :") */
  pattern: number;
  /** Nằm ở đầu trang / có khoảng trắng lớn phía trên */
  position: number;
  /** Trang có ít dòng bất thường (trang mở chương thường trống) */
  sparsePage: number;
};

export type ScoredCandidate = TitleCandidate & {
  scores: SignalScores;
  /** Tổng có trọng số */
  total: number;
};

export type DetectedChapter = {
  index: number;
  title: string;
  pageStart: number;
  /** Trang cuối, tính từ chương kế tiếp; chương cuối lấy hết sách */
  pageEnd: number;
  /** Điểm của ứng viên sinh ra chương này. Fallback theo trang = 0 */
  confidence: number;
};

export type DetectSource = {
  pages: readonly Page[];
  /** Outline đọc từ PDF. Rỗng khi sách không có */
  outline?: readonly OutlineEntry[];
  totalPages: number;
};
