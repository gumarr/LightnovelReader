import type { ReadingStats } from '@ln/shared';

/** Hàm thuần đổi `ReadingStats` thành thứ hiện được cho user. Tách để test riêng. */

/**
 * Phần trăm đã đọc, tính theo **segment** chứ không theo chương.
 *
 * Đếm theo chương thì sách 8 chương nhảy 12,5% một nấc và đứng im suốt cả chương
 * — chẳng nói lên gì khi user đang đọc dở. Segment là đơn vị nhỏ nhất mà app
 * theo dõi vị trí, nên nó cho ra con số nhúc nhích đều theo mạch đọc thật.
 *
 * Sách chưa có segment nào trả `0` chứ không phải `NaN`: chia cho 0 lọt ra UI
 * thành `NaN%`, và thanh tiến độ nhận `width: NaN%` thì biến mất luôn.
 */
export const readPercent = (stats: ReadingStats): number => {
  if (stats.segmentCount <= 0) return 0;
  const ratio = stats.segmentsRead / stats.segmentCount;
  // Kẹp về [0, 100]: `segmentsRead` tới từ một truy vấn khác `segmentCount`, nên
  // về lý thuyết chúng lệch được nếu sách đổi giữa hai lượt đọc.
  return Math.min(100, Math.max(0, Math.round(ratio * 100)));
};

/**
 * Phần trăm đoạn đã có audio.
 *
 * Khác `readPercent` ở chỗ đây là tiến độ **generate**, không phải tiến độ đọc.
 * Hai con số này thường lệch nhau nhiều (đọc tới chương 2 mà đã generate cả
 * sách, hoặc ngược lại) nên không được gộp thành một thanh.
 */
export const audioPercent = (stats: ReadingStats): number => {
  if (stats.segmentCount <= 0) return 0;
  const ratio = stats.segmentsWithAudio / stats.segmentCount;
  return Math.min(100, Math.max(0, Math.round(ratio * 100)));
};

/**
 * Câu tóm tắt vị trí đọc.
 *
 * Chưa mở sách lần nào thì nói thẳng, không hiện "0/120 đoạn" — con số đó đúng
 * nhưng đọc lên nghe như đã đọc rồi mà chưa được đoạn nào.
 */
export const positionLabel = (stats: ReadingStats): string => {
  if (stats.currentChapterTitle === undefined) return 'Chưa mở lần nào';
  return `${stats.currentChapterTitle} · đoạn ${String(stats.segmentsRead + 1)}/${String(
    stats.segmentCount,
  )}`;
};

/**
 * Ngày mở gần nhất, dạng `dd/mm/yyyy`.
 *
 * Không dùng "3 ngày trước": chuỗi tương đối phải tính lại theo đồng hồ hiện
 * tại, mà màn này không tự làm mới nên nó sẽ đứng yên nói sai sau nửa đêm.
 */
export const lastOpenedLabel = (stats: ReadingStats): string => {
  if (stats.lastOpenedAt === undefined) return 'Chưa mở lần nào';
  return new Date(stats.lastOpenedAt).toLocaleDateString('vi-VN');
};
