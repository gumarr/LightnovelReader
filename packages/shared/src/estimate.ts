import {
  CHARS_PER_SECOND_ESTIMATE,
  SYNTHESIS_RTF_ESTIMATE,
  bytesPerSecondAt,
} from './constants.js';
import type { AudioBitrate } from './types.js';

/**
 * Ước lượng thời lượng audio / dung lượng / thời gian xử lý trước khi generate.
 * Bắt buộc hiển thị cho user trước khi chạy "Generate cả sách".
 */
export type GenerateEstimate = {
  /** Tổng số ký tự của các segment sẽ generate */
  totalChars: number;
  segmentCount: number;
  audioDurationMs: number;
  audioBytes: number;
  /** Thời gian CPU ước tính để synth xong toàn bộ */
  processingMs: number;
};

export const estimateGenerate = (
  segmentTexts: readonly string[],
  bitrate: AudioBitrate,
): GenerateEstimate => {
  let totalChars = 0;
  for (const text of segmentTexts) totalChars += text.length;

  return estimateFromTotals(segmentTexts.length, totalChars, bitrate);
};

/**
 * Cùng công thức nhưng nhận sẵn con số tổng.
 *
 * Main đếm ký tự bằng `SUM(LENGTH(text))` ngay trong SQL — một vol có ~4800
 * segment, kéo hết text ra khỏi DB chỉ để cộng độ dài là vài MB cho một phép
 * cộng. Giữ chung một chỗ tính để hai đường không lệch công thức.
 */
export const estimateFromTotals = (
  segmentCount: number,
  totalChars: number,
  bitrate: AudioBitrate,
): GenerateEstimate => {
  const audioSeconds = totalChars / CHARS_PER_SECOND_ESTIMATE;

  return {
    totalChars,
    segmentCount,
    audioDurationMs: Math.round(audioSeconds * 1000),
    audioBytes: Math.round(audioSeconds * bytesPerSecondAt(bitrate)),
    processingMs: Math.round(audioSeconds * SYNTHESIS_RTF_ESTIMATE * 1000),
  };
};

/** Định dạng byte sang chuỗi người đọc được (dùng bội số 1024) */
export const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;

  const units = ['KB', 'MB', 'GB', 'TB'] as const;
  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const digits = value < 10 ? 1 : 0;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
};

/** Định dạng thời lượng mili-giây sang `h:mm:ss` hoặc `m:ss` */
export const formatDuration = (ms: number): string => {
  if (!Number.isFinite(ms) || ms < 0) return '0:00';

  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n: number): string => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
};
