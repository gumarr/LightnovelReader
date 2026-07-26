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
  type ChapterUsageInfo,
  type DeleteAudioResultInfo,
  type EnqueueChapterRequest,
  type EnqueueResult,
  type GenerateEstimateInfo,
  type ImportPreview,
  type Job,
  type LibraryEntry,
  type QueueStatusInfo,
  type ReadingProgress,
  type Result,
  type InstalledVoice,
  type SaveBookRequest,
  type Segment,
  type SidecarStatus,
  type StorageUsageInfo,
  type VoiceCatalogItem,
  type VoiceDownloadProgress,
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
  /** Trạng thái sidecar. Mặc định `ready` — hầu hết test không quan tâm */
  sidecarStatus?: SidecarStatus;
  /** Voice trong catalog. Mặc định một VI chưa cài + một EN đã cài */
  voices?: VoiceCatalogItem[];
  /** Trạng thái hàng đợi generate. Mặc định rỗng và rỗi */
  queueStatus?: Partial<QueueStatusInfo>;
  /** Ước lượng trả về cho `queue:estimate*`. Mặc định một chương nhỏ */
  estimate?: Partial<GenerateEstimateInfo>;
  /** Dung lượng cho Storage Manager. Mặc định suy từ `library`, mọi số là 0 */
  usage?: Partial<StorageUsageInfo>;
  /** Dung lượng từng chương. `chapterId` phải bắt đầu bằng `bookId` để lọc đúng */
  chapterUsage?: ChapterUsageInfo[];
};

/** Voice mẫu cho test voice manager */
export const fakeVoice = (overrides: Partial<VoiceCatalogItem> = {}): VoiceCatalogItem => ({
  id: 'vi_VN-vais1000-medium',
  lang: 'vi',
  name: 'VAIS 1000',
  quality: 'medium',
  sampleRate: 22050,
  license: 'CC BY-NC-SA 4.0',
  totalBytes: 63_206_154,
  installed: false,
  ...overrides,
});

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
    errorCount: 0,
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
  const sidecarListeners = new Set<(s: SidecarStatus) => void>();
  const voiceProgressListeners = new Set<(p: VoiceDownloadProgress) => void>();

  let sidecarStatus: SidecarStatus = options.sidecarStatus ?? {
    state: 'ready',
    restarts: 0,
    port: 54757,
    engineReady: false,
  };

  const queueStatusListeners = new Set<(s: QueueStatusInfo) => void>();
  const segmentUpdateListeners = new Set<(s: Segment) => void>();

  let queueStatus: QueueStatusInfo = {
    state: 'idle',
    queued: 0,
    running: 0,
    done: 0,
    error: 0,
    cancelled: 0,
    ...options.queueStatus,
  };

  const estimate: GenerateEstimateInfo = {
    segmentCount: 3,
    totalChars: 150,
    audioDurationMs: 10_000,
    audioBytes: 30_000,
    processingMs: 1_500,
    existingBytes: 0,
    ...options.estimate,
  };

  // Dung lượng: mặc định suy từ `options.library` để hai màn hình không nói
  // khác nhau về cùng một thư viện. Test nào cần số cụ thể thì truyền `usage`.
  const usage: StorageUsageInfo = {
    audioDir: settings.audioDir,
    audioBytes: 0,
    audioBytesOnDisk: 0,
    orphanBytes: 0,
    orphanFiles: 0,
    warnBytes: settings.storageWarnBytes,
    books: libraryEntries.map((entry) => ({
      bookId: entry.book.id,
      title: entry.book.title,
      bookFileBytes: 30 * 1024 ** 2,
      audioBytes: 0,
      chapterCount: entry.chapterCount,
      completeChapters: 0,
    })),
    ...options.usage,
  };

  const chapterUsage: ChapterUsageInfo[] = options.chapterUsage ?? [];

  /**
   * Trừ dung lượng đã xoá khỏi tổng.
   *
   * Cả `audioBytes` (DB) lẫn `audioBytesOnDisk` (đĩa) đều phải giảm: chỉ trừ
   * một bên thì bản giả tự sinh ra file mồ côi mà không có thật.
   */
  const shrinkUsage = (bytes: number): void => {
    usage.audioBytes = Math.max(0, usage.audioBytes - bytes);
    usage.audioBytesOnDisk = Math.max(0, usage.audioBytesOnDisk - bytes);
  };

  const catalogVoices: VoiceCatalogItem[] = options.voices ?? [
    fakeVoice(),
    fakeVoice({
      id: 'en_US-lessac-medium',
      lang: 'en',
      name: 'Lessac',
      license: 'BSD-3-Clause',
      installed: true,
    }),
  ];

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

    sidecar: {
      getStatus: vi.fn(async (): Promise<Result<SidecarStatus>> => ok(sidecarStatus)),
      onStatusChanged: vi.fn((listener: (s: SidecarStatus) => void) => {
        sidecarListeners.add(listener);
        return () => sidecarListeners.delete(listener);
      }),
    },

    voices: {
      listCatalog: vi.fn(async (): Promise<Result<VoiceCatalogItem[]>> => ok(catalogVoices)),
      listInstalled: vi.fn(
        async (): Promise<Result<InstalledVoice[]>> =>
          ok(
            catalogVoices
              .filter((v) => v.installed)
              .map((v) => ({
                id: v.id,
                lang: v.lang,
                name: v.name,
                quality: v.quality,
                sampleRate: v.sampleRate,
                sizeBytes: v.totalBytes,
              })),
          ),
      ),
      download: vi.fn(async (_voiceId: string) => ok(undefined)),
      cancelDownload: vi.fn(async (_voiceId: string) => ok(undefined)),
      remove: vi.fn(async (_voiceId: string) => ok(undefined)),
      onDownloadProgress: vi.fn((listener: (p: VoiceDownloadProgress) => void) => {
        voiceProgressListeners.add(listener);
        return () => voiceProgressListeners.delete(listener);
      }),
    },

    queue: {
      enqueueSegments: vi.fn(
        async (request: { segmentIds: string[] }): Promise<Result<EnqueueResult>> =>
          ok({ added: request.segmentIds.length }),
      ),
      enqueueChapter: vi.fn(
        async (_request: EnqueueChapterRequest): Promise<Result<EnqueueResult>> => ok({ added: 3 }),
      ),
      enqueueBook: vi.fn(
        async (_bookId: string): Promise<Result<EnqueueResult>> => ok({ added: 10 }),
      ),
      estimateChapter: vi.fn(
        async (_chapterId: string): Promise<Result<GenerateEstimateInfo>> => ok(estimate),
      ),
      estimateBook: vi.fn(
        async (_bookId: string): Promise<Result<GenerateEstimateInfo>> => ok(estimate),
      ),
      getStatus: vi.fn(async (): Promise<Result<QueueStatusInfo>> => ok(queueStatus)),
      listPending: vi.fn(async (): Promise<Result<Job[]>> => ok([])),
      pause: vi.fn(async (): Promise<Result<QueueStatusInfo>> => {
        queueStatus = { ...queueStatus, state: 'paused' };
        return ok(queueStatus);
      }),
      resume: vi.fn(async (): Promise<Result<QueueStatusInfo>> => {
        queueStatus = { ...queueStatus, state: 'running' };
        return ok(queueStatus);
      }),
      cancelJob: vi.fn(async (_jobId: string): Promise<Result<void>> => ok(undefined)),
      cancelBook: vi.fn(
        async (_bookId: string): Promise<Result<EnqueueResult>> => ok({ added: 2 }),
      ),
      cancelAll: vi.fn(async (): Promise<Result<EnqueueResult>> => {
        queueStatus = {
          ...queueStatus,
          state: 'idle',
          cancelled: queueStatus.cancelled + queueStatus.queued + queueStatus.running,
          queued: 0,
          running: 0,
        };
        return ok({ added: 2 });
      }),
      onStatusChanged: vi.fn((listener: (s: QueueStatusInfo) => void) => {
        queueStatusListeners.add(listener);
        return () => queueStatusListeners.delete(listener);
      }),
      onSegmentUpdated: vi.fn((listener: (s: Segment) => void) => {
        segmentUpdateListeners.add(listener);
        return () => segmentUpdateListeners.delete(listener);
      }),
    },

    storage: {
      getUsage: vi.fn(async (): Promise<Result<StorageUsageInfo>> => ok(usage)),
      getChapterUsage: vi.fn(
        async (bookId: string): Promise<Result<ChapterUsageInfo[]>> =>
          ok(chapterUsage.filter((c) => c.chapterId.startsWith(bookId))),
      ),
      // Xoá thật trong bản giả: trừ đi dung lượng để test kiểm được màn hình có
      // nạp lại số mới hay vẫn hiện số cũ.
      deleteChapterAudio: vi.fn(async (chapterId: string): Promise<Result<DeleteAudioResultInfo>> => {
        const chapter = chapterUsage.find((c) => c.chapterId === chapterId);
        if (chapter === undefined) return err('NOT_FOUND', 'Không tìm thấy chương này.');

        const freedBytes = chapter.audioBytes;
        const segments = chapter.readySegments;
        chapter.audioBytes = 0;
        chapter.readySegments = 0;
        shrinkUsage(freedBytes);

        return ok({ segments, freedBytes, filesDeleted: segments * 2 });
      }),
      deleteBookAudio: vi.fn(async (bookId: string): Promise<Result<DeleteAudioResultInfo>> => {
        const book = usage.books.find((b) => b.bookId === bookId);
        if (book === undefined) return err('NOT_FOUND', 'Không tìm thấy sách này.');

        const freedBytes = book.audioBytes;
        let segments = 0;
        for (const chapter of chapterUsage) {
          if (!chapter.chapterId.startsWith(bookId)) continue;
          segments += chapter.readySegments;
          chapter.audioBytes = 0;
          chapter.readySegments = 0;
        }
        book.audioBytes = 0;
        book.completeChapters = 0;
        shrinkUsage(freedBytes);

        return ok({ segments, freedBytes, filesDeleted: segments * 2 });
      }),
      deleteReadAudio: vi.fn(
        async (_bookId: string): Promise<Result<DeleteAudioResultInfo>> =>
          ok({ segments: 0, freedBytes: 0, filesDeleted: 0 }),
      ),
      deleteOrphans: vi.fn(async (): Promise<Result<DeleteAudioResultInfo>> => {
        const freedBytes = usage.orphanBytes;
        const filesDeleted = usage.orphanFiles;
        usage.orphanBytes = 0;
        usage.orphanFiles = 0;
        usage.audioBytesOnDisk = Math.max(0, usage.audioBytesOnDisk - freedBytes);
        return ok({ segments: 0, freedBytes, filesDeleted });
      }),
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

    /** Mô phỏng main đẩy event sidecar:statusChanged */
    emitSidecarStatus: (next: SidecarStatus) => {
      sidecarStatus = next;
      for (const l of sidecarListeners) l(next);
    },
    /** Mô phỏng main đẩy một mốc tiến độ tải voice */
    emitVoiceProgress: (progress: VoiceDownloadProgress) => {
      for (const l of voiceProgressListeners) l(progress);
    },
    sidecarListenerCount: () => sidecarListeners.size,
    voiceProgressListenerCount: () => voiceProgressListeners.size,
    /** Đổi cờ `installed` để mô phỏng tải xong rồi nạp lại catalog */
    setVoiceInstalled: (voiceId: string, installed: boolean) => {
      const voice = catalogVoices.find((v) => v.id === voiceId);
      if (voice !== undefined) voice.installed = installed;
    },

    /** Mô phỏng main đẩy event queue:statusChanged */
    emitQueueStatus: (next: QueueStatusInfo) => {
      queueStatus = next;
      for (const l of queueStatusListeners) l(next);
    },
    /** Mô phỏng main đẩy event queue:segmentUpdated */
    emitSegmentUpdated: (segment: Segment) => {
      for (const l of segmentUpdateListeners) l(segment);
    },
    queueStatusListenerCount: () => queueStatusListeners.size,
    segmentUpdateListenerCount: () => segmentUpdateListeners.size,

    /** Dung lượng hiện tại của bản giả — kiểm xoá có thật sự trừ đi hay không */
    getUsage: () => usage,
    getChapterUsage: () => chapterUsage,
  };
};

/** Gắn api giả vào `window` và trả về handle để test điều khiển */
export const installFakeApi = (options: FakeApiOptions = {}): FakeApi => {
  const fake = createFakeApi(options);
  vi.stubGlobal('api', fake.api);
  Object.defineProperty(window, 'api', { value: fake.api, configurable: true, writable: true });
  return fake;
};
