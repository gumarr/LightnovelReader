import type { AudioBitrate, AppSettings } from './types.js';

/**
 * Giới hạn độ dài segment. Vượt ngưỡng này thì segmenter phải cắt tiếp
 * theo dấu `,` `;` — lý do: CTC aligner degrade nghiêm trọng khi audio > 30s,
 * 300 ký tự ≈ 10s audio là vùng an toàn.
 */
export const SEGMENT_MAX_CHARS = 300;

/** Segment ngắn hơn ngưỡng này sẽ được gộp với segment kế nếu cùng câu */
export const SEGMENT_MIN_CHARS = 20;

/** Số câu tối đa gom vào một segment */
export const SEGMENT_MAX_SENTENCES = 3;

export const AUDIO_BITRATES: readonly AudioBitrate[] = [16, 24, 32] as const;
export const DEFAULT_BITRATE: AudioBitrate = 24;

/** Ước lượng dung lượng: bitrate kbps → byte mỗi giây */
export const bytesPerSecondAt = (bitrate: AudioBitrate): number => (bitrate * 1000) / 8;

/** Tốc độ đọc trung bình dùng để ước lượng thời lượng trước khi generate (ký tự/giây) */
export const CHARS_PER_SECOND_ESTIMATE = 15;

/** Real-time factor của Piper trên CPU desktop — dùng ước lượng thời gian xử lý */
export const SYNTHESIS_RTF_ESTIMATE = 0.15;

/** Số trang mặc định mỗi chương khi fallback chia theo trang */
export const FALLBACK_PAGES_PER_CHAPTER = 15;

/** Đọc đến ngưỡng này thì prefetch chương kế tiếp */
export const PREFETCH_THRESHOLD = 0.8;

/** Sidecar supervisor */
export const SIDECAR_HEALTH_INTERVAL_MS = 5_000;
export const SIDECAR_MAX_RESTARTS = 3;
export const SIDECAR_STARTUP_TIMEOUT_MS = 30_000;

/**
 * Sống liên tục quá ngưỡng này thì bộ đếm restart về 0.
 *
 * Không có nó thì sidecar chết 3 lần rải rác trong nhiều giờ cũng bị coi là
 * "hỏng hẳn" y như chết 3 lần liên tiếp trong 10 giây — trong khi lần đầu chỉ
 * là sự cố lẻ tẻ đã tự phục hồi, còn lần sau mới là hỏng thật.
 */
export const SIDECAR_STABLE_MS = 60_000;

/**
 * Chờ trước khi restart. Chết ngay lập tức mà thử lại ngay thì ba lượt cháy
 * hết trong vài mili-giây, chưa kịp qua cơn hỏng tạm thời (cổng chưa nhả,
 * antivirus đang quét file .exe vừa giải nén).
 */
export const SIDECAR_RESTART_DELAY_MS = 1_000;

/** Priority mặc định của job. Segment sắp phát dùng giá trị cao hơn. */
export const JOB_PRIORITY_NORMAL = 0;
export const JOB_PRIORITY_PREFETCH = 10;
export const JOB_PRIORITY_URGENT = 100;
export const JOB_MAX_ATTEMPTS = 3;

export const DEFAULT_SETTINGS: Omit<AppSettings, 'audioDir'> = {
  theme: 'system',
  bitrate: DEFAULT_BITRATE,
  // 1 vol ≈ 97 MB ở 24 kbps → 5 GB ≈ 50 vol, đủ rộng mà vẫn cảnh báo kịp
  storageWarnBytes: 5 * 1024 ** 3,
  alignmentEnabled: true,
  viewerPaneRatio: 2 / 3,
  subtitleFontSize: 18,
  playbackRate: 1,
};

export const VIEWER_PANE_RATIO_MIN = 0.2;
export const VIEWER_PANE_RATIO_MAX = 0.8;

export const PLAYBACK_RATE_MIN = 0.5;
export const PLAYBACK_RATE_MAX = 2;

export const SUPPORTED_FORMATS = ['pdf', 'docx'] as const;
