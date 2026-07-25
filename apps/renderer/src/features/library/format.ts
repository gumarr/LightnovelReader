import type { Book } from '@ln/shared';

/** Định dạng dữ liệu hiển thị trong Library. Tách khỏi component để test riêng. */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * "Đã đọc lúc nào" dạng tương đối.
 *
 * Dùng mốc tương đối thay vì ngày tháng vì thư viện cá nhân thường chỉ vài
 * chục sách — "3 ngày trước" hữu ích hơn "22/07/2026" khi quét mắt qua grid.
 */
export const relativeTime = (timestamp: number | undefined, now: number): string => {
  if (timestamp === undefined) return 'Chưa đọc';

  const delta = now - timestamp;
  if (delta < 0) return 'Vừa xong';
  if (delta < MINUTE) return 'Vừa xong';
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)} phút trước`;
  if (delta < DAY) return `${Math.floor(delta / HOUR)} giờ trước`;

  const days = Math.floor(delta / DAY);
  if (days === 1) return 'Hôm qua';
  if (days < 30) return `${days} ngày trước`;

  const months = Math.floor(days / 30);
  return months < 12 ? `${months} tháng trước` : `${Math.floor(months / 12)} năm trước`;
};

/** Nhãn định dạng hiển thị trên thẻ sách */
export const formatLabel = (format: Book['format']): string => format.toUpperCase();

/**
 * Chữ cái đầu dùng làm ảnh bìa tạm.
 *
 * `Book.coverPath` có trong schema nhưng chưa ai ghi vào (chưa trích ảnh bìa
 * từ PDF), nên grid cần thứ gì đó phân biệt được các sách bằng mắt.
 */
export const coverInitials = (title: string): string => {
  const words = title.trim().split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return `${words[0]![0]}${words[1]![0]}`.toUpperCase();
};

/**
 * Độ mờ nền bìa tạm, suy từ tên sách (0.08–0.28).
 *
 * Cùng một sách luôn ra cùng sắc độ để user nhận ra bằng vị trí + độ đậm.
 * Dùng độ mờ của `--accent` thay vì sinh màu riêng: bìa tự sinh mà không theo
 * theme sẽ chọi hẳn với phần còn lại ở một trong hai chế độ sáng/tối.
 */
export const coverShade = (title: string): number => {
  let hash = 0;
  for (let i = 0; i < title.length; i += 1) {
    hash = (hash * 31 + title.charCodeAt(i)) % 1000;
  }
  return 0.08 + (hash % 5) * 0.05;
};
