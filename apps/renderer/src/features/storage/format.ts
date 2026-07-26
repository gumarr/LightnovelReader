import { formatBytes, type ChapterUsageInfo, type StorageUsageInfo } from '@ln/shared';

/**
 * Hàm thuần cho Storage Manager. Tách khỏi component để test được mà không
 * phải mount React — cùng lối với `features/generate/format.ts`.
 */

/** Phần trăm đã dùng so với ngưỡng cảnh báo. Trần 100 để thanh không tràn khung */
export const warnPercent = (usage: StorageUsageInfo | null): number => {
  if (usage === null || usage.warnBytes <= 0) return 0;
  return Math.min(100, Math.round((usage.audioBytes / usage.warnBytes) * 100));
};

/**
 * Trạng thái mức dùng, để chọn màu và câu nhắc.
 *
 * `near` từ 80%: cảnh báo đúng lúc còn kịp xoá bớt. Báo ở 100% thì user đã lỡ
 * generate xong cả sách rồi mới biết.
 */
export type UsageLevel = 'ok' | 'near' | 'over';

export const usageLevel = (usage: StorageUsageInfo | null): UsageLevel => {
  if (usage === null || usage.warnBytes <= 0) return 'ok';
  if (usage.audioBytes > usage.warnBytes) return 'over';
  return warnPercent(usage) >= 80 ? 'near' : 'ok';
};

/**
 * Nhãn tiến độ generate của một chương.
 *
 * Phân biệt "chưa tạo" với "0 đoạn": chương không có segment nào (vùng trang
 * toàn ảnh) không phải là chương chưa generate — xoá audio của nó vô nghĩa.
 */
export const chapterProgressLabel = (chapter: ChapterUsageInfo): string => {
  if (chapter.segmentCount === 0) return 'Không có đoạn nào';
  if (chapter.readySegments === 0) return 'Chưa tạo audio';
  if (chapter.readySegments >= chapter.segmentCount) return 'Đủ audio';

  // Đã tổng hợp hết những đoạn tổng hợp được: phần thiếu đúng bằng số đoạn lỗi.
  // Nói "Đủ audio" là sai, mà để nguyên "1055/1058 đoạn" thì user cứ bấm tạo
  // lại mãi cho ba đoạn không bao giờ xong được.
  if (chapter.readySegments + chapter.errorCount >= chapter.segmentCount) {
    return `Đủ audio · ${String(chapter.errorCount)} đoạn lỗi`;
  }

  return `${String(chapter.readySegments)}/${String(chapter.segmentCount)} đoạn`;
};

/** Chương có gì để xoá hay không — chặn nút xoá cho chương chưa generate */
export const canDeleteChapter = (chapter: ChapterUsageInfo): boolean =>
  chapter.readySegments > 0;

/**
 * Mô tả lệch giữa DB và đĩa.
 *
 * `undefined` khi không có gì bất thường — component dựa vào đó để không hiện
 * một dòng nhiễu trong ca bình thường (tuyệt đại đa số).
 */
export const orphanSummary = (usage: StorageUsageInfo | null): string | undefined => {
  if (usage === null || usage.orphanFiles === 0) return undefined;
  return `${String(usage.orphanFiles)} file của sách đã xoá — ${formatBytes(usage.orphanBytes)}`;
};
