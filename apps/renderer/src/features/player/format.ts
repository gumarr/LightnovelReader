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
 *
 * Bước 0.25 tới 2×, rồi nhảy 0.5 cho 2.5× và 3×: ở tốc độ cao thì chênh lệch
 * 0.25 gần như không nghe ra, nên thêm mốc chỉ làm danh sách dài thêm.
 */
export const PLAYBACK_RATE_STEPS = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const;

/**
 * Mốc kế tiếp theo một chiều, để đi bằng phím tắt.
 *
 * Trả về chính `current` khi đã ở đầu/cuối danh sách — người gọi cứ đặt lại là
 * xong, không cần nhánh riêng. Tốc độ hiện tại không nằm đúng mốc nào (settings
 * cũ, hoặc mốc bị đổi giữa các phiên bản) thì bắt lấy mốc gần nhất trước đã.
 */
export const stepRate = (current: number, direction: 1 | -1): number => {
  const steps = PLAYBACK_RATE_STEPS;

  // Mốc gần `current` nhất — chỗ dựa khi `current` rơi vào giữa hai mốc
  let nearest = 0;
  for (let i = 1; i < steps.length; i += 1) {
    const step = steps[i];
    const best = steps[nearest];
    if (step === undefined || best === undefined) continue;
    if (Math.abs(step - current) < Math.abs(best - current)) nearest = i;
  }

  const index = Math.min(steps.length - 1, Math.max(0, nearest + direction));
  return steps[index] ?? current;
};

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

/**
 * Mốc thời gian dạng `m:ss` cho ô đọc số cạnh thanh tiến độ.
 *
 * Segment dài ~10s nên không bao giờ chạm tới giờ; vẫn xử lý phút vượt 59 bằng
 * cách để nó tràn (`61:03`) chứ không cắt — sai số thầm lặng khó thấy hơn một
 * con số trông lạ.
 *
 * `NaN` trả `0:00`: `element.duration` là `NaN` trước khi metadata nạp xong, mà
 * lúc đó thanh player đã hiện rồi.
 */
export const formatClock = (ms: number): string => {
  if (!Number.isFinite(ms) || ms <= 0) return '0:00';

  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes)}:${String(seconds).padStart(2, '0')}`;
};
