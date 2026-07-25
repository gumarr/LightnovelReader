import { dialog } from 'electron';
import type { BrowserWindow } from 'electron';
import { ParseError } from '@ln/parsers';
import {
  chapterPreviewRequestSchema,
  err,
  importFilePathSchema,
  importIdSchema,
  ok,
  type ChapterPreview,
  type ImportPreview,
  type Result,
} from '@ln/shared';
import {
  previewOfRange,
  type ImportSessionStore,
} from '../../services/import-session.js';
import { InvalidInputError } from '../wrap.js';

/**
 * Handler cho nhóm `import:*`.
 *
 * Đây là nơi **duy nhất** parser được gọi — renderer không có `fs` nên không
 * thể tự đọc file, đúng ràng buộc kiến trúc.
 */

export type ImportHandlers = {
  pickFile: () => Promise<Result<ImportPreview | null>>;
  parseFile: (input: unknown) => Promise<Result<ImportPreview>>;
  getChapterPreview: (input: unknown) => Result<ChapterPreview>;
  cancel: (input: unknown) => Result<void>;
};

export type ImportHandlerDeps = {
  sessions: ImportSessionStore;
  getWindow: () => BrowserWindow | null;
  /** Đuôi file hiển thị trong dialog, lấy từ registry để không lệch nhau */
  extensions: readonly string[];
  /**
   * Ghi log lỗi parse. `wrapHandler` chỉ log khi handler **ném**, mà
   * `ParseError` được chuyển thành `Result` nên không đi qua đó — thiếu chỗ
   * này thì lỗi parse ở bản đóng gói không để lại dấu vết nào.
   */
  logError?: (message: string, detail: string) => void;
};

/**
 * Đổi `ParseError` thành `Result` lỗi với mã tương ứng.
 *
 * Giữ `kind` riêng biệt thay vì gộp hết vào `PARSE_ERROR`: PDF scan cần chỉ
 * dẫn khác hẳn file hỏng, và UI phân biệt được nhờ mã lỗi.
 */
const toResult = (error: ParseError): Result<never> => {
  // `cause` giữ lỗi gốc từ pdfjs/mammoth. Đưa vào `detail` (chỉ để log, không
  // hiện cho user) vì nếu không thì lỗi đóng gói chỉ còn lại câu "File có thể
  // đã hỏng" — vô dụng để chẩn đoán, mà đó lại đúng là loại lỗi khó tìm nhất.
  const cause = (error as { cause?: unknown }).cause;
  const detail = cause instanceof Error ? cause.message : undefined;

  switch (error.kind) {
    case 'unsupported-format':
      return err('UNSUPPORTED_FORMAT', error.message, detail);
    case 'scanned-pdf':
      return err('PDF_NO_TEXT_LAYER', error.message, detail);
    case 'corrupt-file':
    case 'empty-document':
      return err('PARSE_ERROR', error.message, detail);
  }
};

export const createImportHandlers = (deps: ImportHandlerDeps): ImportHandlers => {
  const parse = async (filePath: string): Promise<Result<ImportPreview>> => {
    try {
      const { preview } = await deps.sessions.create(filePath);
      return ok(preview);
    } catch (error) {
      // Chỉ ParseError mới có thông điệp đọc được cho user. Lỗi khác (hết bộ
      // nhớ, file bị khoá) để `wrapHandler` xử lý — nó còn ghi log stack.
      if (error instanceof ParseError) {
        const cause = (error as { cause?: unknown }).cause;
        deps.logError?.(
          `Parse thất bại (${error.kind}): ${filePath}`,
          cause instanceof Error ? (cause.stack ?? cause.message) : error.message,
        );
        return toResult(error);
      }
      throw error;
    }
  };

  return {
    pickFile: async () => {
      const window = deps.getWindow();
      const options = {
        title: 'Chọn sách để nhập',
        properties: ['openFile'] as const,
        filters: [
          {
            name: 'Sách',
            // Dialog cần đuôi không có dấu chấm
            extensions: deps.extensions.map((e) => e.replace(/^\./, '')),
          },
        ],
      };

      const result =
        window === null
          ? await dialog.showOpenDialog({ ...options, properties: [...options.properties] })
          : await dialog.showOpenDialog(window, {
              ...options,
              properties: [...options.properties],
            });

      const picked = result.canceled ? undefined : result.filePaths[0];
      if (picked === undefined) return ok(null);

      return parse(picked);
    },

    parseFile: async (input) => {
      const parsed = importFilePathSchema.safeParse(input);
      if (!parsed.success) {
        throw new InvalidInputError('Đường dẫn file không hợp lệ');
      }
      return parse(parsed.data);
    },

    getChapterPreview: (input) => {
      const parsed = chapterPreviewRequestSchema.safeParse(input);
      if (!parsed.success) {
        throw new InvalidInputError(
          `Yêu cầu preview không hợp lệ: ${parsed.error.issues[0]?.message}`,
        );
      }

      const request = parsed.data;
      const session = deps.sessions.get(request.importId);
      if (session === undefined) {
        return err(
          'NOT_FOUND',
          'Phiên nhập sách đã hết hạn. Hãy chọn lại file.',
          `importId=${request.importId}`,
        );
      }

      const text = previewOfRange(
        session.cleaned,
        request.pageStart,
        request.pageEnd,
        request.maxChars,
      );

      return ok({ chapterId: request.chapterId, text });
    },

    cancel: (input) => {
      const parsed = importIdSchema.safeParse(input);
      if (!parsed.success) {
        throw new InvalidInputError('importId không hợp lệ');
      }
      // Bỏ phiên không tồn tại không phải lỗi: renderer có thể gọi hai lần khi
      // user đóng màn hình rồi component unmount.
      deps.sessions.discard(parsed.data);
      return ok(undefined);
    },
  };
};
