/**
 * Type dùng chung toàn workspace.
 * Domain model ba tầng: Chapter (UI) → Segment (audio) → Word (highlight).
 * Không được gộp lẫn ba tầng này.
 */

export type BookFormat = 'pdf' | 'docx' | 'epub';
export type BookLang = 'vi' | 'en';

/** Hình chữ nhật trong không gian trang PDF (đơn vị point, gốc toạ độ góc trên-trái) */
export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type Book = {
  id: string;
  title: string;
  author?: string;
  format: BookFormat;
  /** Đường dẫn file gốc đã copy vào thư viện */
  filePath: string;
  /** SHA-256 của file gốc, dùng để phát hiện import trùng */
  fileHash: string;
  lang: BookLang;
  coverPath?: string;
  addedAt: number;
  lastOpenedAt?: number;
  /** Segment đọc dở gần nhất, dùng để resume */
  lastSegmentId?: string;
};

/**
 * Chapter là đơn vị UI/quản lý (chọn generate, xóa audio, xem tiến độ).
 * KHÔNG phải đơn vị audio — không có `audioPath` ở tầng này.
 */
export type Chapter = {
  id: string;
  bookId: string;
  index: number;
  title: string;
  pageStart?: number;
  pageEnd?: number;
  segmentCount: number;
  /** Tổng dung lượng audio của các segment con, phục vụ storage manager */
  audioBytes: number;
  generateStatus: ChapterGenerateStatus;
};

export type ChapterGenerateStatus = 'none' | 'partial' | 'complete';

/** Neo vị trí segment trong tài liệu gốc để highlight ngược lại viewer */
export type SegmentAnchor =
  | { kind: 'pdf'; page: number; rects: Rect[] }
  | { kind: 'docx'; nodePath: string; offset: number };

export type SegmentStatus = 'pending' | 'queued' | 'generating' | 'ready' | 'error';

/**
 * `none` → chưa có timing.
 * `estimated` → timing ước lượng theo tỉ lệ độ dài từ, dùng được ngay.
 * `aligned` → CTC forced alignment đã chạy xong.
 * UI phải hoạt động ở cả ba trạng thái.
 */
export type AlignStatus = 'none' | 'estimated' | 'aligned';

/**
 * Segment là đơn vị generate + align + seek. 1 segment = 1 file `.ogg`.
 * Giới hạn ≤ 300 ký tự (~10s audio) vì CTC aligner degrade khi audio > 30s.
 */
export type Segment = {
  id: string;
  chapterId: string;
  index: number;
  text: string;
  anchor: SegmentAnchor;
  /** Chỉ set khi status = 'ready'. Path luôn lấy qua services/paths.ts */
  audioPath?: string;
  durationMs?: number;
  audioBytes?: number;
  status: SegmentStatus;
  alignStatus: AlignStatus;
  errorMessage?: string;
};

/**
 * Timing của một từ trong segment. Lưu ở `{audioDir}/{bookId}/{segmentId}.json`.
 * `charStart`/`charEnd` trỏ vào `Segment.text` để map highlight ↔ text gốc.
 */
export type WordTiming = {
  w: string;
  startMs: number;
  endMs: number;
  charStart: number;
  charEnd: number;
};

export type JobType = 'synthesize' | 'align';
export type JobStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled';

export type Job = {
  id: string;
  type: JobType;
  segmentId: string;
  /** Số càng lớn càng ưu tiên. Segment sắp phát được đẩy lên đầu hàng đợi. */
  priority: number;
  status: JobStatus;
  attempts: number;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  errorMessage?: string;
};

/**
 * Trạng thái sidecar mà UI cần phân biệt.
 *
 * `starting` → đang spawn hoặc chờ dòng bắt tay.
 * `ready`    → đã bắt tay, `/health` trả lời được.
 * `restarting` → vừa chết, supervisor đang thử lại (còn lượt).
 * `failed`   → hết lượt thử lại hoặc không tìm thấy sidecar. Cần user can thiệp.
 * `stopped`  → chủ động dừng (app đang thoát). KHÔNG phải lỗi.
 */
export type SidecarState = 'starting' | 'ready' | 'restarting' | 'failed' | 'stopped';

export type SidecarStatus = {
  state: SidecarState;
  /**
   * Số lần đã restart trong phiên hiện tại. Reset về 0 khi sidecar sống ổn
   * định đủ lâu — xem `SIDECAR_STABLE_MS`.
   */
  restarts: number;
  /** Chỉ có khi `state === 'ready'` */
  port?: number;
  /**
   * Engine TTS đã nạp xong chưa. `false` suốt tới P2.4 — "tiến trình sống"
   * không đồng nghĩa "generate được".
   */
  engineReady: boolean;
  /** Lý do hỏng, hiển thị cho user khi `state === 'failed'` */
  message?: string;
};

export type ThemeMode = 'light' | 'dark' | 'system';

/** Bitrate Opus cho phép, mặc định 24 kbps */
export type AudioBitrate = 16 | 24 | 32;

/**
 * Patch settings gửi qua IPC.
 *
 * Dùng `?: T | undefined` thay vì `Partial<AppSettings>` vì dự án bật
 * `exactOptionalPropertyTypes` — `Partial` không nhận `undefined` tường minh,
 * trong khi zod `.partial()` lại sinh ra đúng kiểu đó.
 */
export type AppSettingsPatch = {
  [K in keyof AppSettings]?: AppSettings[K] | undefined;
};

export type AppSettings = {
  theme: ThemeMode;
  /** Thư mục lưu audio — user đổi được, không giả định nằm trong userData */
  audioDir: string;
  bitrate: AudioBitrate;
  /** Ngưỡng cảnh báo dung lượng audio, đơn vị byte. 0 = tắt cảnh báo */
  storageWarnBytes: number;
  /** Tắt để chạy chế độ "Fast" — chỉ dùng timing ước lượng */
  alignmentEnabled: boolean;
  /** Tỉ lệ chiều rộng viewer trong khoảng 0.2–0.8 */
  viewerPaneRatio: number;
  subtitleFontSize: number;
  playbackRate: number;
};
