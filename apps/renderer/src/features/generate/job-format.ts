import {
  JOB_PRIORITY_NORMAL,
  JOB_PRIORITY_PREFETCH,
  JOB_PRIORITY_URGENT,
  type Job,
} from '@ln/shared';

/** Hàm thuần đổi `Job` thành thứ hiện được trong bảng hàng đợi (P5.4). */

/**
 * Nhãn mức ưu tiên.
 *
 * Ba mức là **toàn bộ** giá trị app tự sinh ra, nhưng cột `priority` là số
 * nguyên tuỳ ý — job từ DB cũ hoặc từ một đường chưa có hôm nay vẫn có thể mang
 * số khác. Trả chính con số đó thay vì ép về "Thường": bảng này tồn tại để user
 * thấy job nào đang chắn đường, mà giấu số thật thì nó mất tác dụng.
 */
export const priorityLabel = (priority: number): string => {
  switch (priority) {
    case JOB_PRIORITY_URGENT:
      return 'Sắp phát';
    case JOB_PRIORITY_PREFETCH:
      return 'Chuẩn bị trước';
    case JOB_PRIORITY_NORMAL:
      return 'Thường';
    default:
      return `Ưu tiên ${String(priority)}`;
  }
};

/** Nhãn trạng thái job. `done`/`cancelled` không vào bảng nhưng vẫn xử lý đủ */
export const jobStatusLabel = (job: Job): string => {
  switch (job.status) {
    case 'running':
      return 'Đang chạy';
    case 'queued':
      return 'Đang chờ';
    case 'error':
      return 'Lỗi';
    case 'cancelled':
      return 'Đã huỷ';
    default:
      return 'Xong';
  }
};

/**
 * Câu phụ dưới mỗi hàng: số lần đã thử và lỗi gần nhất.
 *
 * Trả `undefined` khi không có gì đáng nói — job chờ lần đầu không cần thêm
 * dòng nào. Hiện "0 lần thử" cho mọi hàng chỉ làm bảng dày lên mà không giúp
 * tìm ra job đang hỏng.
 */
export const jobDetail = (job: Job): string | undefined => {
  const parts: string[] = [];

  // Lần thử thứ nhất là bình thường; từ lần thứ hai trở đi mới đáng chú ý vì
  // nghĩa là đã hỏng ít nhất một lần.
  if (job.attempts > 1) parts.push(`đã thử ${String(job.attempts)} lần`);
  if (job.errorMessage !== undefined) parts.push(job.errorMessage);

  return parts.length === 0 ? undefined : parts.join(' · ');
};
