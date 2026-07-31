import { ipcRenderer } from 'electron';
import {
  isIpcChannel,
  isIpcEvent,
  type AppInfo,
  type AppSettings,
  type AppSettingsPatch,
  type BookDetail,
  type BookFileBytes,
  type BookHtml,
  type ChapterPreview,
  type ChapterPreviewRequest,
  type ChapterUsageInfo,
  type DeleteAudioResultInfo,
  type EnqueueChapterRequest,
  type EnqueueResult,
  type EnqueueSegmentsRequest,
  type GenerateEstimateInfo,
  type ImportPreview,
  type InstalledVoice,
  type IpcChannel,
  type Job,
  type LibraryEntry,
  type QueueStatusInfo,
  type ReadingProgress,
  type SaveBookRequest,
  type SaveBookResponse,
  type Segment,
  type SegmentAudio,
  type SidecarStatus,
  type StorageUsageInfo,
  type IpcEventName,
  type IpcEventPayload,
  type IpcInput,
  type IpcOutput,
  type Result,
  type ThemeMode,
  type VoiceCatalogItem,
  type VoiceDownloadProgress,
  type VoicePreview,
  type WindowState,
} from '@ln/shared';

/**
 * API duy nhất renderer được dùng (`window.api.*`).
 *
 * Không expose `ipcRenderer` thô: channel nào không nằm trong whitelist của
 * `packages/shared/src/ipc.ts` sẽ bị từ chối ngay tại đây.
 */

const invoke = async <C extends IpcChannel>(
  channel: C,
  input: IpcInput<C>,
): Promise<IpcOutput<C>> => {
  if (!isIpcChannel(channel)) {
    throw new Error(`Channel "${channel}" không nằm trong whitelist`);
  }
  return (await ipcRenderer.invoke(channel, input)) as IpcOutput<C>;
};

/** Đăng ký lắng nghe event từ main. Trả về hàm huỷ đăng ký. */
const subscribe = <E extends IpcEventName>(
  event: E,
  listener: (payload: IpcEventPayload<E>) => void,
): (() => void) => {
  if (!isIpcEvent(event)) {
    throw new Error(`Event "${event}" không nằm trong whitelist`);
  }

  // Không truyền `IpcRendererEvent` xuống renderer — nó chứa `sender`
  const handler = (_e: unknown, payload: unknown): void => {
    listener(payload as IpcEventPayload<E>);
  };

  ipcRenderer.on(event, handler);
  return () => {
    ipcRenderer.removeListener(event, handler);
  };
};

export const api = {
  app: {
    getInfo: (): Promise<Result<AppInfo>> => invoke('app:getInfo', undefined),
  },

  settings: {
    getAll: (): Promise<Result<AppSettings>> => invoke('settings:getAll', undefined),
    update: (patch: AppSettingsPatch): Promise<Result<AppSettings>> =>
      invoke('settings:update', patch),
    setTheme: (theme: ThemeMode): Promise<Result<AppSettings>> =>
      invoke('settings:setTheme', theme),
    pickAudioDir: (): Promise<Result<string | null>> => invoke('settings:pickAudioDir', undefined),
    onChanged: (listener: (settings: AppSettings) => void): (() => void) =>
      subscribe('settings:changed', listener),
  },

  import: {
    pickFile: (): Promise<Result<ImportPreview | null>> => invoke('import:pickFile', undefined),
    parseFile: (filePath: string): Promise<Result<ImportPreview>> =>
      invoke('import:parseFile', filePath),
    getChapterPreview: (request: ChapterPreviewRequest): Promise<Result<ChapterPreview>> =>
      invoke('import:getChapterPreview', request),
    cancel: (importId: string): Promise<Result<void>> => invoke('import:cancel', importId),
  },

  library: {
    saveBook: (request: SaveBookRequest): Promise<Result<SaveBookResponse>> =>
      invoke('library:saveBook', request),
    list: (): Promise<Result<LibraryEntry[]>> => invoke('library:list', undefined),
    openBook: (bookId: string): Promise<Result<BookDetail>> => invoke('library:openBook', bookId),
    setProgress: (progress: ReadingProgress): Promise<Result<void>> =>
      invoke('library:setProgress', progress),
    removeBook: (bookId: string): Promise<Result<void>> => invoke('library:removeBook', bookId),
  },

  reader: {
    getBookFile: (bookId: string): Promise<Result<BookFileBytes>> =>
      invoke('reader:getBookFile', bookId),
    getBookHtml: (bookId: string): Promise<Result<BookHtml>> =>
      invoke('reader:getBookHtml', bookId),
    listSegments: (chapterId: string): Promise<Result<Segment[]>> =>
      invoke('reader:listSegments', chapterId),
    /** Audio + mốc từng từ của một đoạn. `NOT_FOUND` = chưa generate hoặc đã bị xoá */
    getSegmentAudio: (segmentId: string): Promise<Result<SegmentAudio>> =>
      invoke('reader:getSegmentAudio', segmentId),
  },

  sidecar: {
    getStatus: (): Promise<Result<SidecarStatus>> => invoke('sidecar:getStatus', undefined),
    onStatusChanged: (listener: (status: SidecarStatus) => void): (() => void) =>
      subscribe('sidecar:statusChanged', listener),
  },

  voices: {
    listCatalog: (): Promise<Result<VoiceCatalogItem[]>> =>
      invoke('voices:listCatalog', undefined),
    listInstalled: (): Promise<Result<InstalledVoice[]>> =>
      invoke('voices:listInstalled', undefined),
    /** Trả về ngay khi main nhận lệnh — theo dõi tiếp bằng `onDownloadProgress` */
    download: (voiceId: string): Promise<Result<void>> => invoke('voices:download', voiceId),
    cancelDownload: (voiceId: string): Promise<Result<void>> =>
      invoke('voices:cancelDownload', voiceId),
    remove: (voiceId: string): Promise<Result<void>> => invoke('voices:remove', voiceId),
    /**
     * Nghe thử giọng **đã cài**. Chờ tới khi có tiếng (~2 s, lần đầu mỗi voice
     * thêm ~1.5 s nạp model) — khác `download` vốn trả về ngay.
     *
     * Renderer nhận bytes `.ogg` và **phải** `URL.revokeObjectURL` sau khi phát
     * xong, như mọi đường audio khác.
     */
    preview: (voiceId: string): Promise<Result<VoicePreview>> =>
      invoke('voices:preview', voiceId),
    onDownloadProgress: (
      listener: (progress: VoiceDownloadProgress) => void,
    ): (() => void) => subscribe('voices:downloadProgress', listener),
  },

  queue: {
    enqueueSegments: (request: EnqueueSegmentsRequest): Promise<Result<EnqueueResult>> =>
      invoke('queue:enqueueSegments', request),
    enqueueChapter: (request: EnqueueChapterRequest): Promise<Result<EnqueueResult>> =>
      invoke('queue:enqueueChapter', request),
    enqueueBook: (bookId: string): Promise<Result<EnqueueResult>> =>
      invoke('queue:enqueueBook', bookId),
    /** Ước lượng phần chưa generate — UI phải hiện trước khi xếp cả sách */
    estimateChapter: (chapterId: string): Promise<Result<GenerateEstimateInfo>> =>
      invoke('queue:estimateChapter', chapterId),
    estimateBook: (bookId: string): Promise<Result<GenerateEstimateInfo>> =>
      invoke('queue:estimateBook', bookId),
    getStatus: (): Promise<Result<QueueStatusInfo>> => invoke('queue:getStatus', undefined),
    listPending: (): Promise<Result<Job[]>> => invoke('queue:listPending', undefined),
    pause: (): Promise<Result<QueueStatusInfo>> => invoke('queue:pause', undefined),
    resume: (): Promise<Result<QueueStatusInfo>> => invoke('queue:resume', undefined),
    cancelJob: (jobId: string): Promise<Result<void>> => invoke('queue:cancelJob', jobId),
    cancelBook: (bookId: string): Promise<Result<EnqueueResult>> =>
      invoke('queue:cancelBook', bookId),
    cancelAll: (): Promise<Result<EnqueueResult>> => invoke('queue:cancelAll', undefined),
    onStatusChanged: (listener: (status: QueueStatusInfo) => void): (() => void) =>
      subscribe('queue:statusChanged', listener),
    /** Một segment vừa xong hoặc vừa hỏng — reader đổi nút phát theo cái này */
    onSegmentUpdated: (listener: (segment: Segment) => void): (() => void) =>
      subscribe('queue:segmentUpdated', listener),
  },

  storage: {
    getUsage: (): Promise<Result<StorageUsageInfo>> => invoke('storage:getUsage', undefined),
    getChapterUsage: (bookId: string): Promise<Result<ChapterUsageInfo[]>> =>
      invoke('storage:getChapterUsage', bookId),
    /** Xoá audio một chương — metadata và tiến độ đọc giữ nguyên */
    deleteChapterAudio: (chapterId: string): Promise<Result<DeleteAudioResultInfo>> =>
      invoke('storage:deleteChapterAudio', chapterId),
    deleteBookAudio: (bookId: string): Promise<Result<DeleteAudioResultInfo>> =>
      invoke('storage:deleteBookAudio', bookId),
    deleteReadAudio: (bookId: string): Promise<Result<DeleteAudioResultInfo>> =>
      invoke('storage:deleteReadAudio', bookId),
    deleteOrphans: (): Promise<Result<DeleteAudioResultInfo>> =>
      invoke('storage:deleteOrphans', undefined),
  },

  window: {
    minimize: (): Promise<Result<void>> => invoke('window:minimize', undefined),
    toggleMaximize: (): Promise<Result<WindowState>> => invoke('window:toggleMaximize', undefined),
    close: (): Promise<Result<void>> => invoke('window:close', undefined),
    getState: (): Promise<Result<WindowState>> => invoke('window:getState', undefined),
    onStateChanged: (listener: (state: WindowState) => void): (() => void) =>
      subscribe('window:stateChanged', listener),
  },
} as const;

export type LnApi = typeof api;
