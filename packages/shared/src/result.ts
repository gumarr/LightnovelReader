/**
 * Kết quả trả về của mọi IPC handler. Không bao giờ throw qua ranh giới IPC —
 * lỗi được đóng gói thành `{ ok: false, error }` để renderer xử lý tường minh.
 */

export type AppErrorCode =
  | 'UNKNOWN'
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'IO_ERROR'
  | 'DB_ERROR'
  | 'PARSE_ERROR'
  | 'UNSUPPORTED_FORMAT'
  | 'PDF_NO_TEXT_LAYER'
  | 'SIDECAR_UNAVAILABLE'
  /** Việc đã đang chạy rồi — bấm lần hai không tạo thêm lượt song song */
  | 'ALREADY_RUNNING'
  | 'CANCELLED';

export type AppError = {
  code: AppErrorCode;
  message: string;
  /** Chi tiết bổ sung để log, không hiển thị thẳng cho user */
  detail?: string;
};

export type Result<T> = { ok: true; data: T } | { ok: false; error: AppError };

export const ok = <T>(data: T): Result<T> => ({ ok: true, data });

export const err = (code: AppErrorCode, message: string, detail?: string): Result<never> => ({
  ok: false,
  error: detail === undefined ? { code, message } : { code, message, detail },
});

export const isOk = <T>(r: Result<T>): r is { ok: true; data: T } => r.ok;

/** Lấy message từ lỗi không rõ kiểu mà không dùng `any` */
export const errorMessage = (e: unknown): string => {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  return String(e);
};
