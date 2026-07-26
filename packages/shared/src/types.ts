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

/**
 * Một file thuộc voice. Piper cần **hai** file đi cùng nhau: `.onnx` (model) và
 * `.onnx.json` (config phoneme + sample rate). Thiếu file config thì model nạp
 * được nhưng không biết đọc thế nào — nên voice chỉ tính là "đã cài" khi đủ cả
 * hai, không phải khi thư mục tồn tại.
 */
export type VoiceFileKind = 'model' | 'config';

export type VoiceFile = {
  kind: VoiceFileKind;
  /** Đường dẫn tương đối so với `baseUrl` của catalog */
  path: string;
  sizeBytes: number;
  /**
   * SHA256 chữ thường. Bắt buộc có: tải 63 MB qua mạng có thể đứt giữa chừng
   * hoặc bị proxy chèn nội dung, mà file ONNX hỏng thì lỗi chỉ lộ ra lúc nạp
   * engine — xa chỗ gây lỗi tới mức không chẩn đoán được.
   */
  sha256: string;
};

export type VoiceQuality = 'x_low' | 'low' | 'medium' | 'high';

/** Một voice trong catalog — thứ user *có thể* tải */
export type VoiceCatalogEntry = {
  id: string;
  lang: BookLang;
  name: string;
  quality: VoiceQuality;
  sampleRate: number;
  license: string;
  files: VoiceFile[];
};

export type VoiceCatalog = {
  version: number;
  /** Gốc URL Hugging Face, ghép với `VoiceFile.path` */
  baseUrl: string;
  voices: VoiceCatalogEntry[];
};

/**
 * Voice đã cài trên máy — thứ user *đang có*.
 *
 * Tách khỏi `VoiceCatalogEntry` vì hai câu hỏi khác nhau: catalog trả lời "tải
 * được gì", cái này trả lời "dùng được gì ngay". Gộp lại thì UI phải mang theo
 * cờ `installed` cho mọi mục và dễ hiện nhầm voice chưa tải là đã sẵn sàng.
 */
export type InstalledVoice = {
  id: string;
  lang: BookLang;
  name: string;
  quality: VoiceQuality;
  sampleRate: number;
  /** Tổng dung lượng đã chiếm trên đĩa */
  sizeBytes: number;
};

/**
 * Tiến độ tải một voice, đẩy từ sidecar qua SSE.
 *
 * `totalBytes` lấy từ catalog chứ không từ header `Content-Length`: HF trả về
 * qua CDN có lúc không kèm header đó, mà thanh tiến trình không có tổng thì vô
 * dụng. Catalog đã có kích thước thật nên dùng luôn.
 */
export type VoiceDownloadProgress = {
  voiceId: string;
  state: 'downloading' | 'verifying' | 'done' | 'error';
  receivedBytes: number;
  totalBytes: number;
  /** Lý do hỏng, chỉ có khi `state === 'error'` */
  message?: string;
};

/**
 * Nguồn của mốc thời gian từng từ trong một segment.
 *
 * `phoneme` → gộp từ độ dài phoneme do chính Piper sinh ra. Sát thực tế hơn
 *             hẳn, dùng được khi số nhóm phoneme khớp số từ.
 * `estimate` → chia theo độ dài ký tự. Lưới an toàn khi cách trên không khớp
 *             (chữ số đọc thành nhiều từ: `"30"` → "ba mươi").
 *
 * Cả hai đều cho `alignStatus = 'estimated'` — chỉ CTC forced alignment ở
 * Phase 4 mới được nâng lên `'aligned'`. Đưa field này lên UI để chẩn đoán
 * được vì sao highlight lệch, thay vì đoán mò.
 */
export type TimingSource = 'phoneme' | 'estimate';

/** Kết quả tổng hợp một segment, trả từ sidecar `/synthesize` */
export type SynthesisResult = {
  audioPath: string;
  durationMs: number;
  audioBytes: number;
  sampleRate: number;
  voiceId: string;
  timingSource: TimingSource;
  timings: WordTiming[];
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
  /**
   * Giọng đọc đã chọn cho từng ngôn ngữ.
   *
   * Theo ngôn ngữ chứ không phải một giá trị duy nhất: sách VI và sách EN cần
   * hai voice khác nhau, mà một cuốn không đổi ngôn ngữ giữa chừng. Chuỗi rỗng
   * = chưa chọn (hoặc voice đã bị xoá) → hàng đợi dừng và báo user đi cài.
   */
  voiceVi: string;
  voiceEn: string;
  /** Ngưỡng cảnh báo dung lượng audio, đơn vị byte. 0 = tắt cảnh báo */
  storageWarnBytes: number;
  /** Tắt để chạy chế độ "Fast" — chỉ dùng timing ước lượng */
  alignmentEnabled: boolean;
  /** Tỉ lệ chiều rộng viewer trong khoảng 0.2–0.8 */
  viewerPaneRatio: number;
  subtitleFontSize: number;
  playbackRate: number;
};
