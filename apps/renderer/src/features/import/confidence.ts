/**
 * Diễn giải điểm `confidence` của detector thành nhãn cho user.
 *
 * Ngưỡng lấy từ đo đạc thật (PROGRESS.md mục 2): file có outline cho điểm
 * 5.15–6.36, file **không** có outline chỉ đạt 1.41–1.86 vì thiếu hẳn hai
 * tín hiệu mạnh nhất (outline 3.0, font lớn 1.5).
 *
 * Vì vậy **không** so điểm tuyệt đối: chấm mốc theo việc tài liệu có outline
 * hay không. Bản đầu dùng mốc cứng 2.0/3.0 và kết quả là sách không outline
 * bị gắn "Nên kiểm lại" ở **toàn bộ** chương — cảnh báo ở mọi dòng thì không
 * còn là cảnh báo, user chỉ học cách phớt lờ nó.
 */

export type ConfidenceLevel = 'certain' | 'likely' | 'unsure' | 'manual';

/** Mốc khi tài liệu CÓ outline: chương thật ăn trọn 3.0 điểm outline */
const CERTAIN_WITH_OUTLINE = 3;
const LIKELY_WITH_OUTLINE = 2;

/**
 * Mốc khi KHÔNG có outline. Điểm trần thực tế là regex 1.5 + vị trí 0.6 +
 * trang thưa 0.4 = 2.5, nên lấy 1.8/1.5 để vẫn phân biệt được "khớp regex rõ"
 * với "chỉ vừa đủ qua ngưỡng 1.4".
 */
const CERTAIN_NO_OUTLINE = 1.8;
const LIKELY_NO_OUTLINE = 1.5;

export const confidenceLevel = (
  confidence: number | undefined,
  hasOutline = true,
): ConfidenceLevel => {
  // `undefined` = chương do user tự tạo bằng tách/gộp, không phải detector đoán
  if (confidence === undefined) return 'manual';
  // 0 = fallback chia đều theo trang, không dựa tín hiệu nào
  if (confidence <= 0) return 'unsure';

  const certain = hasOutline ? CERTAIN_WITH_OUTLINE : CERTAIN_NO_OUTLINE;
  const likely = hasOutline ? LIKELY_WITH_OUTLINE : LIKELY_NO_OUTLINE;

  if (confidence >= certain) return 'certain';
  return confidence >= likely ? 'likely' : 'unsure';
};

export const CONFIDENCE_LABELS: Record<ConfidenceLevel, string> = {
  certain: 'Chắc chắn',
  likely: 'Có thể đúng',
  unsure: 'Nên kiểm lại',
  manual: 'Bạn tự sửa',
};

/**
 * Class Tailwind cho nhãn tin cậy. Chỉ dùng token màu từ `theme.css`,
 * không hardcode hex.
 */
export const CONFIDENCE_CLASSES: Record<ConfidenceLevel, string> = {
  certain: 'bg-bg-subtle text-fg-muted',
  likely: 'bg-bg-subtle text-fg-muted',
  unsure: 'bg-danger/10 text-danger',
  manual: 'bg-accent/10 text-accent',
};

/** Nhãn đơn vị: DOCX không có trang giấy nên phải gọi là "đoạn" */
export const rangeLabel = (
  pageStart: number,
  pageEnd: number,
  hasRealPages: boolean,
): string => {
  const unit = hasRealPages ? 'Trang' : 'Đoạn';
  return pageStart === pageEnd ? `${unit} ${pageStart}` : `${unit} ${pageStart}–${pageEnd}`;
};

/** Số trang/đoạn của một chương, dùng ở dòng tóm tắt */
export const rangeSize = (pageStart: number, pageEnd: number): number =>
  Math.max(pageEnd - pageStart + 1, 0);
