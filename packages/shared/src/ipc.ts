import type {
  AppSettings,
  AppSettingsPatch,
  Book,
  BookFormat,
  BookLang,
  Chapter,
  InstalledVoice,
  Job,
  Segment,
  SidecarStatus,
  ThemeMode,
  VoiceDownloadProgress,
  VoiceQuality,
} from './types.js';
import type { ChapterDraft } from './chapter-draft.js';
import type { Result } from './result.js';

/**
 * Hợp đồng IPC giữa renderer và main.
 *
 * `IpcContract` map tên channel → { in, out }. Preload và main đều suy kiểu từ
 * đây nên thêm/sửa channel mà quên một phía sẽ lỗi typecheck ngay.
 * Mọi handler trả `Result<T>`, không throw qua IPC.
 */

export type WindowState = {
  isMaximized: boolean;
  isFullScreen: boolean;
};

export type AppInfo = {
  version: string;
  electronVersion: string;
  chromeVersion: string;
  nodeVersion: string;
  platform: string;
  /** Thư mục userData, hiển thị trong Settings */
  userDataPath: string;
};

/**
 * Kết quả phân tích một file sách, đủ để dựng màn "Xác nhận cấu trúc chương".
 *
 * Cố ý **không** kèm text đầy đủ của sách: file 270 trang cho ra vài MB text,
 * gửi hết qua IPC để rồi chỉ hiện 2 dòng preview mỗi chương là lãng phí.
 * Text đầy đủ nằm lại ở main cho tới khi user xác nhận.
 */
export type ImportPreview = {
  /** ID tạm của phiên import, dùng để main tìm lại tài liệu đã parse */
  importId: string;
  filePath: string;
  /** Tên file không kèm đuôi — gợi ý tên sách, user sửa được */
  suggestedTitle: string;
  format: BookFormat;
  /** Số trang thật (PDF) hoặc số đoạn văn (DOCX) */
  totalPages: number;
  /**
   * `false` với DOCX. UI phải dựa cờ này để hiện "đoạn X–Y" thay vì "trang X–Y".
   */
  hasRealPages: boolean;
  /** Có đọc được outline/bookmark không — quyết định mức tin cậy hiển thị */
  hasOutline: boolean;
  chapters: ChapterDraft[];
};

/** Vài dòng đầu của một chương, tải riêng để không phải gửi cả sách */
export type ChapterPreview = {
  chapterId: string;
  /** Rỗng khi vùng trang không có text (trang toàn ảnh) */
  text: string;
};

export type ChapterPreviewRequest = {
  importId: string;
  chapterId: string;
  pageStart: number;
  pageEnd: number;
  /** Số ký tự tối đa trả về */
  maxChars?: number;
};

/**
 * Yêu cầu lưu sách sau khi user xác nhận cấu trúc chương.
 *
 * Chỉ gửi `importId` + danh sách chương: text đầy đủ vẫn nằm ở main từ lúc
 * parse (xem `ImportPreview`), không cần gửi ngược lên rồi gửi xuống lại.
 */
export type SaveBookRequest = {
  importId: string;
  title: string;
  lang: BookLang;
  /** Chương user giữ lại, đã bỏ những chương bị loại trừ */
  chapters: ChapterDraft[];
};

export type SaveBookResponse = {
  bookId: string;
  chapterCount: number;
  segmentCount: number;
  /** Sách đã có sẵn trong thư viện — UI nên mở sách cũ thay vì báo thành công */
  duplicate: boolean;
};

/** Một mục trong Library grid */
export type LibraryEntry = {
  book: Book;
  chapterCount: number;
  segmentCount: number;
};

/** Sách đã mở, kèm danh sách chương để dựng mục lục bên trái */
export type BookDetail = {
  book: Book;
  chapters: Chapter[];
  /**
   * Chương chứa `book.lastSegmentId`. `undefined` khi chưa đọc lần nào hoặc
   * segment đó đã biến mất (sách được nhập lại).
   */
  resumeChapterId?: string;
};

export type ReadingProgress = {
  bookId: string;
  segmentId: string;
};

/**
 * Nội dung thô của sách để viewer dựng lại trang.
 *
 * PDF trả bytes vì pdfjs chạy **ở renderer** — renderer có `DOMMatrix`/`Path2D`
 * thật của Chromium nên không dính hai lỗi đóng gói ở mục 4.19 của PROGRESS.
 * Renderer vẫn không chạm `fs`: đường dẫn do main tra từ DB, renderer chỉ đưa
 * `bookId`.
 */
export type BookFileBytes = {
  bookId: string;
  format: BookFormat;
  /** Nội dung file. Đi qua IPC dưới dạng `ArrayBuffer` (structured clone) */
  bytes: ArrayBuffer;
};

/**
 * HTML của sách DOCX, đã sanitize ở main.
 *
 * DOCX không lưu HTML trong DB — main convert lại bằng mammoth từ bản copy
 * trong `libraryDir` mỗi lần mở sách, rồi cache trong bộ nhớ. Đổi lại là
 * không phải migrate schema và file `.db` không phình theo nội dung sách.
 */
export type BookHtml = {
  bookId: string;
  /** HTML đã lọc, chỉ còn thẻ văn bản. Xem `sanitizeDocxHtml` ở main */
  html: string;
  /**
   * Số khối `<p>`/`<h1..6>` trong `html`, theo đúng thứ tự mammoth sinh ra.
   * `SegmentAnchor.nodePath = "p:<index>"` trỏ vào chỉ số này.
   */
  blockCount: number;
};

/**
 * Một voice trong catalog như UI cần thấy: thông tin để chọn + cờ đã cài chưa.
 *
 * Không dùng thẳng `VoiceCatalogEntry` vì UI không cần `files[]` (đường dẫn HF
 * và sha256 là chuyện nội bộ của sidecar), nhưng lại cần `installed` và
 * `totalBytes` — hai thứ chỉ biết được sau khi soi đĩa.
 */
export type VoiceCatalogItem = {
  id: string;
  lang: BookLang;
  name: string;
  quality: VoiceQuality;
  sampleRate: number;
  license: string;
  /** Tổng dung lượng phải tải, hiện cho user trước khi bấm */
  totalBytes: number;
  installed: boolean;
};

/**
 * Trạng thái hàng đợi generate như UI cần thấy.
 *
 * Chỉ có con số tổng chứ không kèm danh sách job: "generate cả sách" là ~4800
 * job, đẩy cả mảng qua IPC mỗi lần một segment xong là hàng nghìn lần gửi vô
 * ích. Danh sách lấy riêng qua `queue:listPending` khi user mở bảng hàng đợi.
 */
export type QueueStatusInfo = {
  state: 'idle' | 'running' | 'paused';
  queued: number;
  running: number;
  done: number;
  error: number;
  cancelled: number;
  /** Segment đang tổng hợp — UI hiện tên chương đang chạy */
  currentSegmentId?: string;
};

export type EnqueueSegmentsRequest = {
  segmentIds: string[];
  /** Số càng lớn càng ưu tiên. Segment sắp phát dùng `JOB_PRIORITY_URGENT`. */
  priority?: number;
};

export type EnqueueChapterRequest = {
  chapterId: string;
  priority?: number;
};

export type EnqueueResult = {
  /** Số job **mới** tạo — segment đã nằm trong hàng đợi chỉ được nâng priority */
  added: number;
};

/** Kiểu invoke: renderer gọi → main trả Result */
export type IpcContract = {
  'app:getInfo': { in: void; out: Result<AppInfo> };

  'settings:getAll': { in: void; out: Result<AppSettings> };
  'settings:update': { in: AppSettingsPatch; out: Result<AppSettings> };
  'settings:setTheme': { in: ThemeMode; out: Result<AppSettings> };
  /** Mở dialog chọn thư mục audio mới. `null` = user bấm huỷ */
  'settings:pickAudioDir': { in: void; out: Result<string | null> };

  /** Mở dialog chọn sách rồi parse luôn. `null` = user bấm huỷ */
  'import:pickFile': { in: void; out: Result<ImportPreview | null> };
  /** Parse một file đã biết đường dẫn (dùng khi kéo-thả) */
  'import:parseFile': { in: string; out: Result<ImportPreview> };
  'import:getChapterPreview': { in: ChapterPreviewRequest; out: Result<ChapterPreview> };
  /** Bỏ phiên import — giải phóng tài liệu đã parse khỏi bộ nhớ main */
  'import:cancel': { in: string; out: Result<void> };

  /** Lưu sách đã xác nhận cấu trúc vào thư viện */
  'library:saveBook': { in: SaveBookRequest; out: Result<SaveBookResponse> };
  'library:list': { in: void; out: Result<LibraryEntry[]> };
  /** Mở sách: ghi lại thời điểm mở và trả về chương + vị trí đọc dở */
  'library:openBook': { in: string; out: Result<BookDetail> };
  /** Ghi vị trí đọc dở để lần sau resume */
  'library:setProgress': { in: ReadingProgress; out: Result<void> };
  /** Xoá sách khỏi thư viện, kèm chương và segment */
  'library:removeBook': { in: string; out: Result<void> };

  /** Bytes file sách để pdfjs dựng trang ở renderer */
  'reader:getBookFile': { in: string; out: Result<BookFileBytes> };
  /** HTML đã sanitize của sách DOCX */
  'reader:getBookHtml': { in: string; out: Result<BookHtml> };
  /** Segment của một chương — nguồn để highlight và seek */
  'reader:listSegments': { in: string; out: Result<Segment[]> };

  /** Trạng thái sidecar TTS. Renderer chỉ đọc — không tự start/stop được */
  'sidecar:getStatus': { in: void; out: Result<SidecarStatus> };

  /** Voice có thể tải, kèm cờ đã cài chưa */
  'voices:listCatalog': { in: void; out: Result<VoiceCatalogItem[]> };
  /** Voice đã cài — thứ dùng được ngay */
  'voices:listInstalled': { in: void; out: Result<InstalledVoice[]> };
  /**
   * Bắt đầu tải một voice. Trả về **ngay** khi đã nhận lệnh, không chờ tải
   * xong: tải 63 MB mất vài phút, mà `ipcRenderer.invoke` treo lâu như vậy thì
   * renderer reload một cái là mất luôn đường theo dõi. Tiến độ đi riêng qua
   * event `voices:downloadProgress`.
   */
  'voices:download': { in: string; out: Result<void> };
  /** Huỷ lượt tải đang chạy. Không có gì đang tải thì coi như thành công */
  'voices:cancelDownload': { in: string; out: Result<void> };
  'voices:remove': { in: string; out: Result<void> };

  /** Xếp segment vào hàng đợi generate */
  'queue:enqueueSegments': { in: EnqueueSegmentsRequest; out: Result<EnqueueResult> };
  /** Xếp cả chương — main tự tra segment chưa có audio */
  'queue:enqueueChapter': { in: EnqueueChapterRequest; out: Result<EnqueueResult> };
  'queue:getStatus': { in: void; out: Result<QueueStatusInfo> };
  /** Job đang chờ/chạy, ưu tiên cao trước. Dùng khi user mở bảng hàng đợi */
  'queue:listPending': { in: void; out: Result<Job[]> };
  /** Tạm dừng sau job hiện tại. Không vứt công đang làm dở */
  'queue:pause': { in: void; out: Result<QueueStatusInfo> };
  'queue:resume': { in: void; out: Result<QueueStatusInfo> };
  /** Huỷ một job. Đang chạy thì cắt luôn request đang bay */
  'queue:cancelJob': { in: string; out: Result<void> };
  'queue:cancelBook': { in: string; out: Result<EnqueueResult> };
  'queue:cancelAll': { in: void; out: Result<EnqueueResult> };

  'window:minimize': { in: void; out: Result<void> };
  'window:toggleMaximize': { in: void; out: Result<WindowState> };
  'window:close': { in: void; out: Result<void> };
  'window:getState': { in: void; out: Result<WindowState> };
};

export type IpcChannel = keyof IpcContract;
export type IpcInput<C extends IpcChannel> = IpcContract[C]['in'];
export type IpcOutput<C extends IpcChannel> = IpcContract[C]['out'];

/**
 * Kiểu event: main chủ động đẩy xuống renderer (một chiều).
 * Renderer đăng ký qua `window.api.on(...)`, trả về hàm huỷ đăng ký.
 */
export type IpcEventContract = {
  'window:stateChanged': WindowState;
  'settings:changed': AppSettings;
  /**
   * Sidecar đổi trạng thái. Đẩy chủ động chứ không để renderer hỏi vòng: sidecar
   * chết bất cứ lúc nào, mà UI cần biết ngay để chặn nút generate.
   */
  'sidecar:statusChanged': SidecarStatus;
  /**
   * Tiến độ tải voice. Đi bằng event chứ không phải giá trị trả về của
   * `voices:download` vì một lượt tải sinh ra hàng trăm mốc tiến độ.
   */
  'voices:downloadProgress': VoiceDownloadProgress;
  /**
   * Hàng đợi generate đổi trạng thái.
   *
   * Đẩy chủ động vì một lượt "generate cả sách" chạy hàng giờ mà không có
   * tương tác nào từ user — hỏi vòng thì UI hoặc trễ, hoặc phí IPC liên tục.
   */
  'queue:statusChanged': QueueStatusInfo;
  /**
   * Một segment vừa xong (hoặc hỏng). Đi riêng khỏi `queue:statusChanged` vì
   * reader cần biết **segment nào** để đổi nút "phát" mà không phải tải lại cả
   * danh sách segment.
   */
  'queue:segmentUpdated': Segment;
};

export type IpcEventName = keyof IpcEventContract;
export type IpcEventPayload<E extends IpcEventName> = IpcEventContract[E];

/**
 * Danh sách channel được whitelist ở preload. Mọi channel không nằm trong
 * mảng này sẽ bị từ chối — renderer không thể gọi channel tuỳ ý.
 */
export const IPC_CHANNELS = [
  'app:getInfo',
  'settings:getAll',
  'settings:update',
  'settings:setTheme',
  'settings:pickAudioDir',
  'import:pickFile',
  'import:parseFile',
  'import:getChapterPreview',
  'import:cancel',
  'library:saveBook',
  'library:list',
  'library:openBook',
  'library:setProgress',
  'library:removeBook',
  'reader:getBookFile',
  'reader:getBookHtml',
  'reader:listSegments',
  'sidecar:getStatus',
  'voices:listCatalog',
  'voices:listInstalled',
  'voices:download',
  'voices:cancelDownload',
  'voices:remove',
  'queue:enqueueSegments',
  'queue:enqueueChapter',
  'queue:getStatus',
  'queue:listPending',
  'queue:pause',
  'queue:resume',
  'queue:cancelJob',
  'queue:cancelBook',
  'queue:cancelAll',
  'window:minimize',
  'window:toggleMaximize',
  'window:close',
  'window:getState',
] as const satisfies readonly IpcChannel[];

export const IPC_EVENTS = [
  'window:stateChanged',
  'settings:changed',
  'sidecar:statusChanged',
  'voices:downloadProgress',
  'queue:statusChanged',
  'queue:segmentUpdated',
] as const satisfies readonly IpcEventName[];

/**
 * `satisfies` ở trên chỉ chặn channel lạ lọt vào mảng, không chặn việc quên
 * thêm channel mới. Hai guard dưới đây bắt lỗi thiếu ngay lúc typecheck.
 */
type MissingChannel = Exclude<IpcChannel, (typeof IPC_CHANNELS)[number]>;
type MissingEvent = Exclude<IpcEventName, (typeof IPC_EVENTS)[number]>;
const _channelsExhaustive: MissingChannel[] = [];
const _eventsExhaustive: MissingEvent[] = [];
void _channelsExhaustive;
void _eventsExhaustive;

/** Type guard dùng ở preload để chặn channel lạ */
export const isIpcChannel = (value: string): value is IpcChannel =>
  (IPC_CHANNELS as readonly string[]).includes(value);

export const isIpcEvent = (value: string): value is IpcEventName =>
  (IPC_EVENTS as readonly string[]).includes(value);
