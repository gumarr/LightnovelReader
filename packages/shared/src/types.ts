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
  /**
   * Số segment tổng hợp lỗi.
   *
   * Cần riêng khỏi `generateStatus`: một chương 1058 segment có 3 đoạn hỏng vẫn
   * là `partial` giống chương mới generate được một nửa, nhưng hai ca đó user
   * phải xử lý khác nhau. Đa số lỗi là đoạn chỉ chứa ký hiệu (`"???,,,..."`) mà
   * Piper không đọc được — không phải lỗi có thể sửa bằng cách generate lại.
   */
  errorCount: number;
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
 *
 * `charStart`/`charEnd` trỏ vào **`Segment.text` gốc** (nửa mở: `[start, end)`)
 * để map highlight ↔ text user đang nhìn.
 *
 * Lưu ý `w` là từ **đã đọc**, không phải chuỗi con của `Segment.text`. Sidecar
 * chuẩn hoá trước khi tổng hợp (`"2024"` → `"hai nghìn…"`, `"Tokyo"` →
 * `"Tô-ki-ô"`), nên `w` bám bản đọc còn offset đã được quy ngược về bản gốc.
 * Hệ quả: **nhiều** `WordTiming` liên tiếp có thể trỏ về cùng một khoảng gốc —
 * đó là chủ ý, cả từ gốc sáng lên suốt thời gian đọc mọi mảnh của nó.
 * Xem `sidecar/app/text/mapping.py` và plan.md mục 8.1.
 */
export type WordTiming = {
  w: string;
  startMs: number;
  endMs: number;
  charStart: number;
  charEnd: number;
};

/**
 * Một mục phiên âm do user tự sửa (P3.5, tầng 3 — plan.md mục 8.1).
 *
 * Van an toàn, không phải nghĩa vụ: từ điển ship sẵn và luật romaji đã lo phần
 * lớn tên riêng Nhật. User chỉ thêm khi nghe thấy chỗ nào chướng tai.
 *
 * `bookId` bỏ trống = áp cho **mọi** sách — tên nhân vật một bộ LN trải dài
 * nhiều tập, mà mỗi tập là một `Book` riêng.
 */
export type PronunciationOverride = {
  id: string;
  /** Bỏ trống = áp cho mọi sách */
  bookId?: string;
  /** Từ cần sửa cách đọc, luôn **chữ thường** */
  term: string;
  /** Cách đọc thay thế, dùng gạch nối giữa các âm tiết: `Tô-ki-ô` */
  replacement: string;
  createdAt: number;
};

/**
 * Một dấu trang do user đặt (P5.4). Bảng `bookmarks` có từ schema v1 nhưng
 * không có repository nào đọc tới cho tới P5.4.
 *
 * **Neo theo `segmentId`, không theo trang hay ký tự.** Segment là đơn vị seek
 * của cả app (CLAUDE.md), nên "nhảy tới dấu trang" dùng đúng đường mà player đã
 * có sẵn. Neo theo trang thì DOCX không có trang; neo theo ký tự thì phải tra
 * ngược ra segment mới phát được.
 */
export type Bookmark = {
  id: string;
  bookId: string;
  segmentId: string;
  /** Ghi chú của user. Bỏ trống = dấu trang trơn, chỉ để nhớ chỗ */
  note?: string;
  createdAt: number;
};

/**
 * Dấu trang kèm ngữ cảnh để hiện thành danh sách bấm được.
 *
 * Bảng `bookmarks` chỉ có `segment_id`; danh sách mà chỉ hiện id thì user không
 * nhận ra chỗ nào là chỗ nào. Main ghép sẵn tiêu đề chương và trích đoạn text ở
 * một lượt truy vấn thay vì bắt renderer gọi thêm cho từng mục.
 */
export type BookmarkEntry = {
  bookmark: Bookmark;
  /** Chương chứa segment — nhãn chính của mỗi hàng */
  chapterTitle: string;
  /** Thứ tự chương, để danh sách xếp theo mạch đọc chứ không theo lúc tạo */
  chapterIndex: number;
  /** Thứ tự segment trong chương */
  segmentIndex: number;
  /** Trích đoạn đầu của segment — cắt ở main, xem `BOOKMARK_EXCERPT_MAX` */
  excerpt: string;
};

/**
 * Thống kê đọc của một sách (P5.4).
 *
 * **Mọi con số ở đây đều suy ra từ dữ liệu đã có** — không có bảng theo dõi
 * hành vi, không ghi mốc thời gian mỗi phiên đọc. Quyết định có ý thức: app này
 * không thu thập gì về thói quen user (CLAUDE.md cấm telemetry), nên "thống kê
 * đọc" ở đây là *đọc tới đâu rồi* chứ không phải *đọc bao lâu mỗi ngày*.
 */
export type ReadingStats = {
  bookId: string;
  chapterCount: number;
  /** Số chương nằm **trước** chương đang đọc — đã đọc xong trọn vẹn */
  chaptersRead: number;
  segmentCount: number;
  /**
   * Số segment nằm trước vị trí đang đọc, tính xuyên chương.
   *
   * Đây là cơ sở của thanh phần trăm: đếm theo chương thì sách 8 chương nhảy
   * 12,5% một nấc, chẳng nói lên gì khi user đang ở giữa chương.
   */
  segmentsRead: number;
  /** Số segment đã có audio (`status = 'ready'`) */
  segmentsWithAudio: number;
  /** Tổng thời lượng audio đã sinh. `0` khi chưa generate gì */
  audioDurationMs: number;
  audioBytes: number;
  /** Chương đang đọc dở. Bỏ trống khi chưa mở sách lần nào */
  currentChapterTitle?: string;
  /** Lần mở gần nhất. Bỏ trống khi chưa mở lần nào */
  lastOpenedAt?: number;
  bookmarkCount: number;
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
  /**
   * Tự kiểm tra bản mới lúc khởi động (P5.5b).
   *
   * Bật mặc định, nhưng **chỉ kiểm tra** — tải và cài luôn do user bấm. Tự tải
   * 150 MB nền cho một app đọc sách offline là chuyện phải hỏi, không phải mặc
   * định im lặng. Tắt cờ này thì không có request mạng nào đi ra.
   */
  autoCheckUpdates: boolean;
};

/**
 * Trạng thái tiến trình cập nhật mà UI cần phân biệt (P5.5b).
 *
 * `idle`        → chưa kiểm, hoặc vừa kiểm xong và đang ở bản mới nhất.
 * `checking`    → đang hỏi `latest.yml`.
 * `available`   → có bản mới, **chưa** tải. Chờ user bấm.
 * `downloading` → đang tải, xem `percent`.
 * `downloaded`  → tải xong, đã kiểm sha512. Chờ user bấm cài lại.
 * `error`       → hỏng, xem `message`. KHÔNG chặn app — đọc sách vẫn chạy.
 *
 * `unsupported` là ca riêng, không phải lỗi: bản portable và bản dev không cài
 * đè được. Gộp vào `error` thì UI hiện chữ đỏ cho một tình huống hoàn toàn bình
 * thường, mà user portable thì không làm gì được để "sửa".
 */
export type UpdateState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error'
  | 'unsupported';

export type UpdateStatus = {
  state: UpdateState;
  /** Phiên bản đang chạy, luôn có — UI hiện cả khi không có bản mới */
  currentVersion: string;
  /** Phiên bản trên GitHub. Chỉ có từ `available` trở đi */
  availableVersion?: string;
  /** 0–100. Chỉ có khi `state === 'downloading'` */
  percent?: number;
  downloadedBytes?: number;
  totalBytes?: number;
  /** Lý do hỏng (`error`) hoặc lý do không hỗ trợ (`unsupported`) */
  message?: string;
  /** Thời điểm kiểm gần nhất, để UI hiện "đã kiểm lúc ..." */
  checkedAt?: number;
};
