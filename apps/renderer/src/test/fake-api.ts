import { vi } from 'vitest';
import {
  DEFAULT_SETTINGS,
  err,
  ok,
  type AppSettings,
  type Book,
  type BookDetail,
  type BookFileBytes,
  type BookHtml,
  type Chapter,
  type ChapterPreviewRequest,
  type ImportPreview,
  type LibraryEntry,
  type ReadingProgress,
  type Result,
  type SaveBookRequest,
  type Segment,
  type WindowState,
} from '@ln/shared';

/**
 * `window.api` giả cho test renderer — thay cho preload thật vốn cần Electron.
 * Test có thể can thiệp từng hàm để mô phỏng lỗi hoặc thay đổi từ main.
 */

export type FakeApi = ReturnType<typeof createFakeApi>;

export type FakeApiOptions = {
  settings?: Partial<AppSettings>;
  windowState?: Partial<WindowState>;
  /** Preview trả về khi test gọi `import.pickFile` / `import.parseFile` */
  importPreview?: ImportPreview;
  /** Sách trong thư viện. Mặc định rỗng — test nào cần thì truyền vào. */
  library?: LibraryEntry[];
  /** Segment trả về cho `reader.listSegments` */
  segments?: Segment[];
  /** HTML trả về cho `reader.getBookHtml` */
  bookHtml?: string;
};

/** HTML DOCX mẫu — đã đánh số khối như main làm */
const DEFAULT_BOOK_HTML =
  '<h1 data-block="0">Chương 1</h1><p data-block="1">Nội dung đoạn đầu.</p>';

/** Segment mẫu cho một chương */
export const fakeSegments = (chapterId: string, count = 3): Segment[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `${chapterId}-s${i + 1}`,
    chapterId,
    index: i,
    text: `Câu thứ ${i + 1} của đoạn văn.`,
    anchor: { kind: 'pdf' as const, page: i + 1, rects: [{ x: 10, y: 20, width: 300, height: 14 }] },
    status: 'pending' as const,
    alignStatus: 'none' as const,
  }));

/** Sách mẫu để test Library grid */
export const fakeBook = (overrides: Partial<Book> = {}): Book => ({
  id: 'book-1',
  title: 'Kiếm Vực Thần Đế',
  format: 'pdf',
  filePath: 'D:\\lib\\book-1.pdf',
  fileHash: 'hash-1',
  lang: 'vi',
  addedAt: 1000,
  ...overrides,
});

export const fakeLibraryEntry = (
  book: Book = fakeBook(),
  chapterCount = 3,
  segmentCount = 120,
): LibraryEntry => ({ book, chapterCount, segmentCount });

/** Chương giả cho `openBook`, chia đều segment cho đủ số */
const fakeChapters = (entry: LibraryEntry): Chapter[] =>
  Array.from({ length: entry.chapterCount }, (_, i) => ({
    id: `${entry.book.id}-c${i + 1}`,
    bookId: entry.book.id,
    index: i,
    title: `Chương ${i + 1}`,
    pageStart: i * 10 + 1,
    pageEnd: (i + 1) * 10,
    segmentCount: Math.floor(entry.segmentCount / entry.chapterCount),
    audioBytes: 0,
    generateStatus: 'none' as const,
  }));

/** Preview mặc định: 3 chương liền mạch trên sách 30 trang */
export const defaultImportPreview: ImportPreview = {
  importId: 'imp1',
  filePath: 'D:\\sach\\Test Book.pdf',
  suggestedTitle: 'Test Book',
  format: 'pdf',
  totalPages: 30,
  hasRealPages: true,
  hasOutline: true,
  chapters: [
    { id: 'c1', title: 'Chương 1: Mở đầu', pageStart: 1, pageEnd: 10, confidence: 5.2, excluded: false },
    { id: 'c2', title: 'Chương 2: Tiếp theo', pageStart: 11, pageEnd: 20, confidence: 4.1, excluded: false },
    { id: 'c3', title: 'Chương 3: Kết', pageStart: 21, pageEnd: 30, confidence: 1.5, excluded: false },
  ],
};

export const createFakeApi = (options: FakeApiOptions = {}) => {
  let settings: AppSettings = {
    ...DEFAULT_SETTINGS,
    audioDir: 'E:\\ln-audio',
    ...options.settings,
  };

  let windowState: WindowState = {
    isMaximized: false,
    isFullScreen: false,
    ...options.windowState,
  };

  const importPreview: ImportPreview = options.importPreview ?? defaultImportPreview;
  const libraryEntries: LibraryEntry[] = options.library ?? [];

  const settingsListeners = new Set<(s: AppSettings) => void>();
  const windowListeners = new Set<(s: WindowState) => void>();

  const api = {
    app: {
      getInfo: vi.fn(async () =>
        ok({
          version: '0.1.0',
          electronVersion: '33.0.0',
          chromeVersion: '130.0.0',
          nodeVersion: '20.18.0',
          platform: 'win32',
          userDataPath: 'C:\\ud',
        }),
      ),
    },

    settings: {
      getAll: vi.fn(async () => ok(settings)),
      update: vi.fn(async (patch: Partial<AppSettings>) => {
        settings = { ...settings, ...patch };
        return ok(settings);
      }),
      setTheme: vi.fn(async (theme: AppSettings['theme']) => {
        settings = { ...settings, theme };
        return ok(settings);
      }),
      pickAudioDir: vi.fn(async () => ok(null)),
      onChanged: vi.fn((listener: (s: AppSettings) => void) => {
        settingsListeners.add(listener);
        return () => settingsListeners.delete(listener);
      }),
    },

    import: {
      // Kiểu trả về phải cho phép `null`: user bấm huỷ ở dialog là ca thật,
      // không suy được từ giá trị mặc định nên phải chú thích tường minh.
      pickFile: vi.fn(async (): Promise<Result<ImportPreview | null>> => ok(importPreview)),
      parseFile: vi.fn(async (_filePath: string) => ok(importPreview)),
      getChapterPreview: vi.fn(async (request: ChapterPreviewRequest) =>
        ok({
          chapterId: request.chapterId,
          text: `Nội dung trang ${request.pageStart}–${request.pageEnd}.`,
        }),
      ),
      cancel: vi.fn(async (_importId: string) => ok(undefined)),
    },

    library: {
      saveBook: vi.fn(async (request: SaveBookRequest) =>
        ok({
          bookId: 'book-1',
          chapterCount: request.chapters.filter((c) => !c.excluded).length,
          segmentCount: 42,
          duplicate: false,
        }),
      ),
      list: vi.fn(async () => ok(libraryEntries)),
      openBook: vi.fn(async (bookId: string): Promise<Result<BookDetail>> => {
        const entry = libraryEntries.find((e) => e.book.id === bookId);
        if (entry === undefined) return err('NOT_FOUND', 'Không tìm thấy sách này trong thư viện.');
        return ok({ book: entry.book, chapters: fakeChapters(entry) });
      }),
      setProgress: vi.fn(async (_progress: ReadingProgress) => ok(undefined)),
      removeBook: vi.fn(async (_bookId: string) => ok(undefined)),
    },

    reader: {
      getBookFile: vi.fn(
        async (bookId: string): Promise<Result<BookFileBytes>> =>
          ok({ bookId, format: 'pdf' as const, bytes: new ArrayBuffer(8) }),
      ),
      getBookHtml: vi.fn(
        async (bookId: string): Promise<Result<BookHtml>> =>
          ok({ bookId, html: options.bookHtml ?? DEFAULT_BOOK_HTML, blockCount: 2 }),
      ),
      listSegments: vi.fn(
        async (chapterId: string): Promise<Result<Segment[]>> =>
          ok(options.segments ?? fakeSegments(chapterId)),
      ),
    },

    window: {
      minimize: vi.fn(async () => ok(undefined)),
      toggleMaximize: vi.fn(async () => {
        windowState = { ...windowState, isMaximized: !windowState.isMaximized };
        for (const l of windowListeners) l(windowState);
        return ok(windowState);
      }),
      close: vi.fn(async () => ok(undefined)),
      getState: vi.fn(async () => ok(windowState)),
      onStateChanged: vi.fn((listener: (s: WindowState) => void) => {
        windowListeners.add(listener);
        return () => windowListeners.delete(listener);
      }),
    },
  };

  return {
    api,
    /** Mô phỏng main đẩy event settings:changed */
    emitSettingsChanged: (next: AppSettings) => {
      settings = next;
      for (const l of settingsListeners) l(next);
    },
    getSettings: () => settings,
    settingsListenerCount: () => settingsListeners.size,
    windowListenerCount: () => windowListeners.size,
  };
};

/** Gắn api giả vào `window` và trả về handle để test điều khiển */
export const installFakeApi = (options: FakeApiOptions = {}): FakeApi => {
  const fake = createFakeApi(options);
  vi.stubGlobal('api', fake.api);
  Object.defineProperty(window, 'api', { value: fake.api, configurable: true, writable: true });
  return fake;
};
