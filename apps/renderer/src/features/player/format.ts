import { PLAYBACK_RATE_MAX, PLAYBACK_RATE_MIN } from '@ln/shared';
import type { PlaybackState, SkippedSegment } from '@/stores/player-store';

/** Nhãn và số cho thanh player. Hàm thuần, tách khỏi component để test được. */

/** Nhãn nút phát chính — đọc bằng screen reader và dùng làm tooltip */
export const playButtonLabel = (state: PlaybackState): string => {
  switch (state) {
    case 'playing':
      return 'Tạm dừng';
    case 'waiting':
      return 'Đang tạo audio — bấm để dừng chờ';
    case 'paused':
      return 'Phát tiếp';
    default:
      return 'Phát';
  }
};

/**
 * Câu mô tả trạng thái, hiện cạnh nút.
 *
 * `waiting` là trạng thái **duy nhất** user phải chờ, nên nó phải nói rõ đang
 * chờ cái gì — thanh quay vòng không kèm chữ thì không phân biệt được với treo.
 */
export const playerStateLabel = (state: PlaybackState): string => {
  switch (state) {
    case 'playing':
      return 'Đang phát';
    case 'waiting':
      return 'Đang tạo audio…';
    case 'paused':
      return 'Tạm dừng';
    default:
      return 'Chưa phát';
  }
};

/**
 * Câu tóm tắt số đoạn đã bỏ qua, hoặc `undefined` khi chưa bỏ đoạn nào.
 *
 * Chỉ là **thông tin**, không phải cảnh báo chặn đường: user đang nghe và không
 * cần bấm gì cả. Gộp thành một dòng chứ không liệt kê từng đoạn — một chương có
 * thể bỏ hàng chục đoạn rỗng và danh sách dài sẽ lấn mất chỗ của phần đang nghe.
 */
export const skippedSummary = (skipped: readonly SkippedSegment[]): string | undefined => {
  if (skipped.length === 0) return undefined;
  return `Đã bỏ qua ${String(skipped.length)} đoạn không phát được`;
};

/**
 * Các mốc tốc độ user bấm được.
 *
 * Danh sách rời rạc chứ không phải thanh trượt: đọc sách người ta chọn một tốc
 * độ rồi giữ nguyên hàng giờ, và mốc rời rạc thì bấm trúng ngay, không phải căn.
 */
export const PLAYBACK_RATE_STEPS = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;

/** Nhãn tốc độ: `1×`, `1.5×` — bỏ số 0 thừa cho gọn */
export const rateLabel = (rate: number): string => `${String(Number(rate.toFixed(2)))}×`;

/** Kẹp tốc độ vào khoảng hợp lệ. Cùng ngưỡng với `AppSettings`. */
export const clampRate = (rate: number): number =>
  Math.min(PLAYBACK_RATE_MAX, Math.max(PLAYBACK_RATE_MIN, rate));

/**
 * Vị trí phát theo phần trăm, để vẽ thanh tiến độ trong segment.
 *
 * Kẹp trong 0–100: `currentTime` có thể vượt `durationMs` vài ms ở cuối file, mà
 * thanh tràn khỏi khung trông như lỗi hiển thị.
 */
export const positionPercent = (positionMs: number, durationMs: number): number => {
  if (durationMs <= 0) return 0;
  return Math.min(100, Math.max(0, (positionMs / durationMs) * 100));
};
