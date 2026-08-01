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
  // Rỗng = chưa chọn giọng. Không đoán sẵn một voiceId: đoán rồi mà voice đó
  // chưa tải thì hàng đợi hỏng với lỗi khó hiểu, trong khi rỗng cho ra đúng
  // câu "chưa cài giọng đọc nào".
  voiceVi: '',
  voiceEn: '',
  // 1 vol ≈ 97 MB ở 24 kbps → 5 GB ≈ 50 vol, đủ rộng mà vẫn cảnh báo kịp
  storageWarnBytes: 5 * 1024 ** 3,
  alignmentEnabled: true,
  viewerPaneRatio: 2 / 3,
  subtitleFontSize: 18,
  playbackRate: 1,
  // Bật mặc định vì bản cũ không có cách nào biết bản mới tồn tại. Chỉ **kiểm
  // tra** — tải và cài vẫn do user bấm (xem `UpdateState`).
  autoCheckUpdates: true,
};

export const VIEWER_PANE_RATIO_MIN = 0.2;
export const VIEWER_PANE_RATIO_MAX = 0.8;

/**
 * Khoảng tốc độ phát hợp lệ.
 *
 * Trần là **3×** chứ không phải 2× như plan.md ghi ban đầu: user đọc quen thì
 * 2× vẫn còn chậm, và Chromium giữ được cao độ (`preservesPitch`) tới quá mức
 * này nên không phải sinh lại audio — đúng ràng buộc của CLAUDE.md.
 *
 * Không nới thêm: trên 3× thì `preservesPitch` của Chromium bắt đầu cho ra tiếng
 * lạo xạo nghe rõ, mà giọng Piper vốn đã không thật tự nhiên.
 *
 * Nới trần là thay đổi **an toàn một chiều** với settings đã lưu: mọi giá trị cũ
 * (≤ 2) vẫn hợp lệ với zod schema nên không cần migration. Hạ trần thì ngược
 * lại — sẽ làm settings đang lưu 2.5× không parse được.
 */
export const PLAYBACK_RATE_MIN = 0.5;
export const PLAYBACK_RATE_MAX = 3;

/**
 * Số segment player xếp ưu tiên trước đầu phát.
 *
 * Sinh một segment mất ~1.5–2.5s (RTF thật 0.24 đo ở P2.6/P2.7) trong khi phát
 * nó mất ~10s, nên hàng đợi thừa sức đi trước — nhưng chỉ khi được xếp trước vài
 * cái. Xếp từng cái một thì player luôn chạy sát nút và hụt ngay khi gặp một
 * segment dài hoặc một lượt nạp model.
 *
 * Không đặt cao hơn: mỗi segment xếp thêm là audio ghi ra đĩa mà user có thể
 * không nghe tới, và CLAUDE.md bắt buộc hiện ước lượng trước khi generate hàng
 * loạt — đây là đường đi vòng qua hộp đó nên phải giữ nhỏ.
 */
export const PLAYBACK_LOOKAHEAD_SEGMENTS = 5;

export const SUPPORTED_FORMATS = ['pdf', 'docx'] as const;

/**
 * Khoảng cỡ chữ phụ đề, khớp với `appSettingsSchema` (10–48).
 *
 * Trần 48 chứ không nới thêm: phụ đề nằm trong pane chia theo `viewerPaneRatio`,
 * cỡ chữ lớn hơn nữa thì một đoạn 300 ký tự chiếm hết pane và mất luôn tác dụng
 * của việc tự cuộn theo từ đang đọc.
 *
 * Bước 2px: 1px thì user phải bấm quá nhiều lần mới thấy khác biệt.
 */
export const SUBTITLE_FONT_SIZE_MIN = 10;
export const SUBTITLE_FONT_SIZE_MAX = 48;
export const SUBTITLE_FONT_SIZE_STEP = 2;

/**
 * Câu mẫu để nghe thử giọng, chọn theo ngôn ngữ của voice.
 *
 * **Do main chọn, không phải renderer gửi lên.** Cho renderer gửi text tuỳ ý là
 * mở một đường tổng hợp không giới hạn không đi qua hàng đợi — user dán cả
 * chương vào là sidecar chạy hàng phút mà không có nút huỷ nào.
 *
 * Nội dung chọn có chủ đích, mỗi câu phải cho user nghe được thứ họ sẽ thật sự
 * gặp khi đọc LN:
 *
 * - **Có tên riêng Nhật** (`Tokyo`, `Asuka`) vì đó là thứ xuất hiện mọi trang
 *   trong LN dịch và cũng là thứ dễ đọc sai nhất — nghe thử mà không có tên
 *   riêng thì không kiểm được ba tầng phiên âm của P3.5 có chạy không.
 * - **Có chữ số** (`17`) vì số đi qua đường chuẩn hoá khác hẳn chữ thường.
 * - **Đủ ngắn để nghe hết mà không sốt ruột** (~4–5 s), đủ dài để nghe ra ngữ
 *   điệu chứ không chỉ một tiếng rời rạc.
 */
export const VOICE_PREVIEW_TEXT: Readonly<Record<'vi' | 'en', string>> = {
  vi: 'Chiều hôm ấy ở Tokyo, Asuka mười bảy tuổi bước vào lớp học và khẽ mỉm cười.',
  en: 'That afternoon in Tokyo, seventeen-year-old Asuka stepped into the classroom and smiled.',
};

/**
 * Độ dài tối đa của ghi chú dấu trang (P5.4).
 *
 * Đây là chỗ ghi "vì sao mình đánh dấu chỗ này", không phải chỗ chép lại đoạn
 * văn — trần ngắn giữ danh sách dấu trang đọc lướt được. Ghi chú dài hơn nữa
 * thì mỗi hàng chiếm cả màn hình và mất tác dụng của một danh sách.
 */
export const BOOKMARK_NOTE_MAX = 500;

/**
 * Số ký tự trích từ `Segment.text` để nhận ra dấu trang trỏ vào đâu.
 *
 * Cắt ở **main** chứ không gửi cả `text` rồi để renderer cắt: một sách có thể có
 * hàng trăm dấu trang, mỗi segment tới 300 ký tự — gửi trọn là ~30 lần dữ liệu
 * cần thiết qua IPC cho một danh sách chỉ hiện một dòng mỗi mục.
 */
export const BOOKMARK_EXCERPT_MAX = 120;

/**
 * Trần số dấu trang trả về cho một sách.
 *
 * Cùng lý do với `PENDING_LIMIT` của hàng đợi: danh sách dài hơn thế thì UI
 * không hiện nổi mà vẫn tốn một lượt IPC lớn. Người đọc thật hiếm khi vượt.
 */
export const BOOKMARK_LIST_LIMIT = 500;
