import type { AppSettings, AppSettingsPatch, BookFormat, ThemeMode } from './types.js';
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
  'window:minimize',
  'window:toggleMaximize',
  'window:close',
  'window:getState',
] as const satisfies readonly IpcChannel[];

export const IPC_EVENTS = [
  'window:stateChanged',
  'settings:changed',
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
