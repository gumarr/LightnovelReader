import { basename, extname } from 'node:path';
import {
  cleanPages,
  detectChapters,
  type CleanedPage,
  type DetectedChapter,
  type ParsedDocument,
  type ParserRegistry,
} from '@ln/parsers';
import type { ChapterDraft, ImportPreview } from '@ln/shared';

/**
 * Phiên import: giữ tài liệu đã parse trong bộ nhớ main từ lúc phân tích tới
 * lúc user bấm xác nhận ở màn cấu trúc chương.
 *
 * Lý do phải giữ: sách 270 trang cho ra vài MB text. Gửi hết xuống renderer
 * chỉ để hiện 2 dòng preview mỗi chương là lãng phí, mà parse lại mỗi lần user
 * bấm xem preview thì mất vài giây. Giữ ở main là chỗ duy nhất hợp lý.
 */

export type ImportSession = {
  id: string;
  filePath: string;
  document: ParsedDocument;
  /** Text đã làm sạch theo trang, index khớp `document.pages` */
  cleaned: CleanedPage[];
  createdAt: number;
};

export type ImportSessionStore = {
  /** Parse file rồi tạo phiên mới. Ném `ParseError` nếu file không đọc được. */
  create(filePath: string): Promise<{ session: ImportSession; preview: ImportPreview }>;
  get(importId: string): ImportSession | undefined;
  /** Bỏ phiên. Trả `false` nếu không có phiên nào mang ID đó. */
  discard(importId: string): boolean;
  /** Số phiên đang giữ — dùng để test không rò bộ nhớ */
  size(): number;
};

export type ImportSessionOptions = {
  registry: ParserRegistry;
  /**
   * Số phiên giữ đồng thời. Quá số này thì phiên cũ nhất bị bỏ.
   *
   * User chỉ import một sách một lúc, nhưng renderer có thể quên gọi
   * `import:cancel` (đóng cửa sổ, reload lúc dev) — không có trần thì mỗi lần
   * như vậy rò lại vài MB cho tới khi thoát app.
   */
  maxSessions?: number;
  now?: () => number;
};

const DEFAULT_MAX_SESSIONS = 3;

/** Số ký tự preview mặc định — đủ 2–3 dòng hiển thị */
export const DEFAULT_PREVIEW_CHARS = 240;

/**
 * Tên sách gợi ý từ tên file. User sửa được ở màn xác nhận nên không cần
 * thông minh, chỉ cần không tệ hơn tên file thô.
 */
export const suggestTitle = (filePath: string): string => {
  const name = basename(filePath, extname(filePath));
  return name.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
};

/** Chuyển kết quả detector thành bản nháp user sửa được */
export const toDrafts = (chapters: readonly DetectedChapter[]): ChapterDraft[] =>
  chapters.map((chapter, index) => ({
    id: `c${index + 1}`,
    title: chapter.title.trim(),
    pageStart: chapter.pageStart,
    pageEnd: chapter.pageEnd,
    confidence: chapter.confidence,
    excluded: false,
  }));

/**
 * Lấy vài dòng đầu của một khoảng trang.
 *
 * Bỏ qua trang mục lục và trang rỗng: chương bắt đầu bằng trang bìa sẽ cho
 * preview trống, mà preview trống thì user không biết chương đó chứa gì.
 */
export const previewOfRange = (
  cleaned: readonly CleanedPage[],
  pageStart: number,
  pageEnd: number,
  maxChars: number = DEFAULT_PREVIEW_CHARS,
): string => {
  const parts: string[] = [];
  let length = 0;

  for (const page of cleaned) {
    if (page.pageNumber < pageStart) continue;
    if (page.pageNumber > pageEnd) break;
    if (page.isTableOfContents === true) continue;

    const text = page.text.trim();
    if (text.length === 0) continue;

    parts.push(text);
    length += text.length;
    if (length >= maxChars) break;
  }

  // Xuống dòng trong preview không mang thông tin gì — gộp thành một dòng chảy
  const joined = parts.join(' ').replace(/\s+/g, ' ').trim();
  if (joined.length <= maxChars) return joined;

  // Cắt ở ranh giới từ để không đứt giữa chữ
  const cut = joined.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
};

export const createImportSessionStore = (options: ImportSessionOptions): ImportSessionStore => {
  const maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS;
  const now = options.now ?? Date.now;
  const sessions = new Map<string, ImportSession>();
  let counter = 0;

  const evictOldest = (): void => {
    while (sessions.size > maxSessions) {
      // Map giữ thứ tự chèn nên phần tử đầu là phiên cũ nhất
      const oldest = sessions.keys().next();
      if (oldest.done === true) return;
      sessions.delete(oldest.value);
    }
  };

  return {
    async create(filePath) {
      const parser = options.registry.require(filePath);
      const document = await parser.parse(filePath);
      const cleaned = cleanPages(document.pages);

      const chapters = detectChapters({
        pages: document.pages,
        outline: document.outline,
        totalPages: document.totalPages,
      });

      counter += 1;
      const id = `imp${counter}`;
      const session: ImportSession = {
        id,
        filePath,
        document,
        cleaned,
        createdAt: now(),
      };

      sessions.set(id, session);
      evictOldest();

      const preview: ImportPreview = {
        importId: id,
        filePath,
        suggestedTitle: suggestTitle(filePath),
        format: document.format,
        totalPages: document.totalPages,
        hasRealPages: document.hasRealPages,
        hasOutline: document.outline.length > 0,
        chapters: toDrafts(chapters),
      };

      return { session, preview };
    },

    get: (importId) => sessions.get(importId),
    discard: (importId) => sessions.delete(importId),
    size: () => sessions.size,
  };
};
