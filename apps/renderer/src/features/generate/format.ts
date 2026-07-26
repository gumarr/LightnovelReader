import type { QueueStatusInfo } from '@ln/shared';

/** Hàm thuần đổi trạng thái hàng đợi thành thứ hiện được cho user. */

/**
 * Phần trăm hoàn thành của **lượt chạy hiện tại**.
 *
 * Mẫu số là `done + error + cancelled + queued + running`, tức toàn bộ job còn
 * trong bảng. Job `done` không bị xoá đi nên con số này tiến lên đều; nếu chỉ
 * lấy `done / (done + queued)` thì mỗi lần xếp thêm việc thanh sẽ tụt lùi.
 *
 * Job hỏng và bị huỷ tính là **đã xử lý**: chúng không bao giờ chạy nữa, để
 * chúng ngoài mẫu số thì thanh đứng mãi ở 90% dù hàng đợi đã rỗng.
 */
export const queuePercent = (status: QueueStatusInfo): number => {
  const settled = status.done + status.error + status.cancelled;
  const total = settled + status.queued + status.running;
  if (total === 0) return 0;
  return Math.round((settled / total) * 100);
};

/** Nhãn trạng thái: nói rõ còn bao nhiêu đoạn thay vì chỉ "đang chạy" */
export const queueStateLabel = (status: QueueStatusInfo): string => {
  const remaining = status.queued + status.running;

  if (status.state === 'paused') {
    return remaining === 0 ? 'Đã tạm dừng' : `Đã tạm dừng · còn ${String(remaining)} đoạn`;
  }
  if (remaining === 0) return 'Không có việc đang chạy';
  if (status.state === 'idle') return `Chờ chạy · ${String(remaining)} đoạn`;
  return `Đang tạo · còn ${String(remaining)} đoạn`;
};

/**
 * Chương nào cần prefetch khi đang đọc tới segment thứ `segmentIndex`.
 *
 * **Tiến độ đo bằng segment đang đọc, không bằng `scrollTop`.** Đó là vị trí đọc
 * mà app vốn đã theo dõi (và đã ghi vào `book.lastSegmentId`), giống nhau cho cả
 * PDF lẫn DOCX — trong khi cuộn thì mỗi viewer đo một kiểu, và cuộn nhanh xuống
 * cuối chương để xem tranh không có nghĩa là đã đọc tới đó.
 *
 * Trả `undefined` khi chưa tới ngưỡng hoặc đang ở chương cuối. Hàm thuần để test
 * được mà không cần dựng cả trình đọc.
 */
export const nextChapterToPrefetch = (
  chapterIds: readonly string[],
  currentChapterId: string | null,
  segmentIndex: number,
  segmentCount: number,
  threshold: number,
): string | undefined => {
  if (currentChapterId === null || segmentCount <= 0 || segmentIndex < 0) return undefined;

  // `+1` vì `segmentIndex` đếm từ 0: đọc segment cuối của chương 10 segment là
  // 10/10 chứ không phải 9/10.
  const ratio = (segmentIndex + 1) / segmentCount;
  if (ratio < threshold) return undefined;

  const index = chapterIds.indexOf(currentChapterId);
  // Chương không thuộc sách đang mở, hoặc đã là chương cuối
  if (index === -1 || index + 1 >= chapterIds.length) return undefined;

  return chapterIds[index + 1];
};
