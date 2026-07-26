import type { SidecarState, VoiceQuality } from '@ln/shared';

/**
 * Hàm thuần đổi dữ liệu voice thành chữ hiện cho user. Tách khỏi component để
 * test được mà không phải render — và vì đây là chỗ dễ sai âm thầm: chia sai
 * đơn vị thì "63 MB" thành "63 KB" mà không có gì báo.
 */

const MB = 1024 * 1024;

/** Dung lượng dạng người đọc được. Model voice cỡ vài chục MB nên đủ tới GB. */
export const formatBytes = (bytes: number): string => {
  if (bytes < 0) return '0 MB';
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < MB) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * MB) return `${(bytes / MB).toFixed(1)} MB`;
  return `${(bytes / (1024 * MB)).toFixed(2)} GB`;
};

/** Phần trăm đã tải, chặn trong 0–100 để thanh tiến trình không tràn khung */
export const downloadPercent = (received: number, total: number): number => {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((received / total) * 100)));
};

export const qualityLabel = (quality: VoiceQuality): string => {
  switch (quality) {
    case 'x_low':
      return 'Rất thấp';
    case 'low':
      return 'Thấp';
    case 'medium':
      return 'Trung bình';
    case 'high':
      return 'Cao';
  }
};

export const langLabel = (lang: string): string => {
  if (lang === 'vi') return 'Tiếng Việt';
  if (lang === 'en') return 'Tiếng Anh';
  return lang;
};

/**
 * Trạng thái sidecar → chữ cho user.
 *
 * `tone` quyết định màu: chỉ `failed` mới là đỏ. `starting`/`restarting` là
 * chuyện bình thường lúc app vừa mở — tô đỏ thì user hoảng vì một thứ sẽ tự
 * hết sau vài giây.
 */
export type SidecarLabel = {
  text: string;
  tone: 'ok' | 'pending' | 'error';
  /** Giải thích thêm khi user rê chuột */
  hint: string;
};

export const sidecarLabel = (state: SidecarState, restarts: number): SidecarLabel => {
  switch (state) {
    case 'ready':
      return {
        text: 'Dịch vụ TTS sẵn sàng',
        tone: 'ok',
        hint: 'Tải và quản lý giọng đọc được.',
      };
    case 'starting':
      return {
        text: 'Đang khởi động dịch vụ TTS…',
        tone: 'pending',
        hint: 'Thường mất vài giây sau khi mở ứng dụng.',
      };
    case 'restarting':
      return {
        text: `Đang khởi động lại dịch vụ TTS (lần ${String(restarts)})…`,
        tone: 'pending',
        hint: 'Dịch vụ vừa dừng bất thường và đang được dựng lại.',
      };
    case 'failed':
      return {
        text: 'Dịch vụ TTS không chạy được',
        tone: 'error',
        hint: 'Khởi động lại ứng dụng. Nếu vẫn lỗi, xem log trong thư mục dữ liệu.',
      };
    case 'stopped':
      return {
        text: 'Dịch vụ TTS đã dừng',
        tone: 'pending',
        hint: 'Ứng dụng đang thoát.',
      };
  }
};
