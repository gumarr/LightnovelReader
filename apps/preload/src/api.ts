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
  type ImportPreview,
  type IpcChannel,
  type LibraryEntry,
  type ReadingProgress,
  type SaveBookRequest,
  type SaveBookResponse,
  type Segment,
  type SidecarStatus,
  type IpcEventName,
  type IpcEventPayload,
  type IpcInput,
  type IpcOutput,
  type Result,
  type ThemeMode,
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
  },

  sidecar: {
    getStatus: (): Promise<Result<SidecarStatus>> => invoke('sidecar:getStatus', undefined),
    onStatusChanged: (listener: (status: SidecarStatus) => void): (() => void) =>
      subscribe('sidecar:statusChanged', listener),
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
