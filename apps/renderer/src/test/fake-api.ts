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
  type BookmarkEntry,
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
  type PronunciationOverride,
  type ReadingProgress,
  type ReadingStats,
  type SavePronunciationRequest,
  type AddBookmarkRequest,
  type UpdateBookmarkNoteRequest,
  type Result,
  type InstalledVoice,
  type SaveBookRequest,
  type Segment,
  type SegmentAudio,
  type SidecarStatus,
  type StorageUsageInfo,
  type UpdateStatus,
  type VoiceCatalogItem,
  type VoiceDownloadProgress,
  type VoicePreview,
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
  /**
   * Segment mà `reader.getSegmentAudio` trả `NOT_FOUND`.
   *
   * Dựng ca "DB nói `ready` mà file không còn" — Storage Manager vừa xoá dưới
   * chân player. Player phải bỏ qua và đi tiếp chứ không dừng.
   */
  missingAudio?: string[];
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
  /** Phiên âm user đã lưu. Mặc định rỗng */
  pronunciations?: PronunciationOverride[];
  /** Dấu trang đã lưu. Mặc định rỗng */
  bookmarks?: BookmarkEntry[];
  /** Thống kê đọc trả cho `library.getStats`. Mặc định một sách đọc dở */
  stats?: Partial<ReadingStats>;
  /** Trạng thái auto-update. Mặc định `idle` chưa từng kiểm (P5.5c) */
  updateStatus?: UpdateStatus;
};

/** Voice mẫu cho test voice manager */
export const fakeVoice = (overrides: Partial<VoiceCatalogItem> = {}): VoiceCatalogItem => ({
  id: 'vi_VN-vais1000-medium',
  lang: 'vi',
  name: 'VAIS 1000',
  quality: 'medium',
  sampleRate: 22050,
  license: 'CC BY-NC-SA 4.0',
  engine: 'piper',
  totalBytes: 63_206_154,
  installed: false,
  cloned: false,
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

/** Dấu trang mẫu — ngữ cảnh do main ghép sẵn, renderer chỉ hiện */
export const fakeBookmark = (overrides: Partial<BookmarkEntry> = {}): BookmarkEntry => ({
  bookmark: {
    id: 'bm-1',
    bookId: 'book-1',
    segmentId: 'book-1-c1-s1',
    note: 'Chỗ đáng nhớ',
    createdAt: 1000,
  },
  chapterTitle: 'Chương 1',
  chapterIndex: 0,
  segmentIndex: 0,
  excerpt: 'Câu thứ 1 của đoạn văn.',
  ...overrides,
});

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

  const updateListeners = new Set<(s: UpdateStatus) => void>();
  /**
   * Mặc định `idle` chưa từng kiểm — trạng thái thật của app vừa mở khi
   * `autoCheckUpdates` tắt. Không mặc định `unsupported`: đó là ca của bản dev,
   * mà lấy nó làm mặc định thì mọi test UI đều rơi vào nhánh "không làm gì được".
   */
  let updateStatus: UpdateStatus = options.updateStatus ?? {
    state: 'idle',
    currentVersion: '0.1.0',
  };

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

  const pronunciations: PronunciationOverride[] = [...(options.pronunciations ?? [])];
  const bookmarks: BookmarkEntry[] = [...(options.bookmarks ?? [])];

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
      getStats: vi.fn(
        async (bookId: string): Promise<Result<ReadingStats>> =>
          ok({
            bookId,
            chapterCount: 3,
            chaptersRead: 1,
            segmentCount: 120,
            segmentsRead: 45,
            segmentsWithAudio: 60,
            audioDurationMs: 600000,
            audioBytes: 1800000,
            currentChapterTitle: 'Chương 2',
            lastOpenedAt: 1000,
            bookmarkCount: bookmarks.length,
            ...options.stats,
          }),
      ),
    },

    bookmarks: {
      list: vi.fn(async (_bookId: string): Promise<Result<BookmarkEntry[]>> => ok([...bookmarks])),
      add: vi.fn(async (request: AddBookmarkRequest): Promise<Result<BookmarkEntry>> => {
        // Đánh dấu lại đúng đoạn thì cập nhật ghi chú, giống `upsert` thật —
        // bản giả tạo bản trùng sẽ cho test xanh ở ca DB thật không bao giờ có.
        const at = bookmarks.findIndex((e) => e.bookmark.segmentId === request.segmentId);
        const note = request.note?.trim() ?? '';
        if (at >= 0) {
          const found = bookmarks[at]!;
          // Bỏ `note` cũ ra trước khi ghép — xem chú thích ở `updateNote`
          const { note: _dropped, ...rest } = found.bookmark;
          const updated: BookmarkEntry = {
            ...found,
            bookmark: {
              ...rest,
              ...(note === '' ? {} : { note }),
            },
          };
          bookmarks[at] = updated;
          return ok(updated);
        }
        const created = fakeBookmark({
          bookmark: {
            id: `bm-${String(bookmarks.length + 1)}`,
            bookId: request.bookId,
            segmentId: request.segmentId,
            ...(note === '' ? {} : { note }),
            createdAt: 2000,
          },
        });
        bookmarks.push(created);
        return ok(created);
      }),
      updateNote: vi.fn(
        async (request: UpdateBookmarkNoteRequest): Promise<Result<BookmarkEntry>> => {
          const at = bookmarks.findIndex((e) => e.bookmark.id === request.id);
          if (at < 0) return err('NOT_FOUND', 'Dấu trang này đã bị xoá.');
          const found = bookmarks[at]!;
          // Bỏ `note` cũ ra TRƯỚC khi ghép: trải `...found.bookmark` rồi ghép
          // nhánh rỗng vẫn giữ nguyên ghi chú cũ, trong khi DB thật ghi NULL.
          const { note: _dropped, ...rest } = found.bookmark;
          const updated: BookmarkEntry = {
            ...found,
            bookmark: {
              ...rest,
              ...(request.note === '' ? {} : { note: request.note }),
            },
          };
          bookmarks[at] = updated;
          return ok(updated);
        },
      ),
      remove: vi.fn(async (id: string): Promise<Result<void>> => {
        const at = bookmarks.findIndex((e) => e.bookmark.id === id);
        if (at >= 0) bookmarks.splice(at, 1);
        return ok(undefined);
      }),
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
      /**
       * Audio giả cho player. `missingAudio` để dựng ca "DB nói ready mà file
       * không còn" — chính là ca Storage Manager xoá dưới chân player.
       */
      getSegmentAudio: vi.fn(async (segmentId: string): Promise<Result<SegmentAudio>> => {
        if (options.missingAudio?.includes(segmentId) === true) {
          return err('NOT_FOUND', 'File audio của đoạn này không còn trên đĩa.');
        }
        return ok({
          segmentId,
          bytes: new ArrayBuffer(8),
          durationMs: 1000,
          timings: [{ w: 'một', startMs: 0, endMs: 1000, charStart: 0, charEnd: 3 }],
          timingSource: 'phoneme' as const,
        });
      }),
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
                engine: v.engine,
                sizeBytes: v.totalBytes,
              })),
          ),
      ),
      download: vi.fn(async (_voiceId: string) => ok(undefined)),
      cancelDownload: vi.fn(async (_voiceId: string) => ok(undefined)),
      remove: vi.fn(async (_voiceId: string) => ok(undefined)),
      // 4 byte "OggS" — đủ để kiểm bytes đi đúng đường mà không phải dựng file
      // Opus thật. jsdom không giải mã audio nên nội dung không quan trọng.
      preview: vi.fn(
        async (voiceId: string): Promise<Result<VoicePreview>> =>
          ok({
            voiceId,
            bytes: new Uint8Array([0x4f, 0x67, 0x67, 0x53]).buffer,
            durationMs: 4200,
            text: 'Chiều hôm ấy ở Tokyo, Asuka mười bảy tuổi bước vào lớp học và khẽ mỉm cười.',
          }),
      ),
      onDownloadProgress: vi.fn((listener: (p: VoiceDownloadProgress) => void) => {
        voiceProgressListeners.add(listener);
        return () => voiceProgressListeners.delete(listener);
      }),
    },

    pronunciations: {
      list: vi.fn(
        async (_bookId: string): Promise<Result<PronunciationOverride[]>> => ok(pronunciations),
      ),
      save: vi.fn(async (request: SavePronunciationRequest): Promise<Result<PronunciationOverride>> => {
        const term = request.term.trim().toLowerCase();
        const saved: PronunciationOverride = {
          id: `pron-${String(pronunciations.length + 1)}`,
          ...(request.bookId === undefined ? {} : { bookId: request.bookId }),
          term,
          replacement: request.replacement.trim(),
          createdAt: 1000,
        };
        // Ghi đè khi trùng `term`, giống `upsert` thật — không thì bản giả cho
        // ra hai dòng cùng một từ mà DB thật không bao giờ có.
        const at = pronunciations.findIndex((e) => e.term === term);
        if (at >= 0) pronunciations[at] = { ...saved, id: pronunciations[at]!.id };
        else pronunciations.push(saved);
        return ok(at >= 0 ? pronunciations[at]! : saved);
      }),
      remove: vi.fn(async (id: string): Promise<Result<void>> => {
        const at = pronunciations.findIndex((e) => e.id === id);
        if (at >= 0) pronunciations.splice(at, 1);
        return ok(undefined);
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

    update: {
      getStatus: vi.fn(async () => ok(updateStatus)),
      // Không tự đổi sang `checking`: service thật đổi trạng thái qua **event**
      // chứ không qua giá trị trả về. Test nào cần đường đi đó thì gọi
      // `emitUpdateStatus` — bản giả tự bịa ra một chuỗi trạng thái sẽ che mất
      // lỗi "UI không nghe event".
      check: vi.fn(async () => ok(updateStatus)),
      download: vi.fn(async () => ok(updateStatus)),
      quitAndInstall: vi.fn(async () => ok(updateStatus.state === 'downloaded')),
      onStatusChanged: vi.fn((listener: (s: UpdateStatus) => void) => {
        updateListeners.add(listener);
        return () => updateListeners.delete(listener);
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

    /** Mô phỏng main đẩy event update:statusChanged */
    emitUpdateStatus: (next: UpdateStatus) => {
      updateStatus = next;
      for (const l of updateListeners) l(next);
    },
    updateListenerCount: () => updateListeners.size,

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
