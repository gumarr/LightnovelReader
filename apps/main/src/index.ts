import { app, type BrowserWindow } from 'electron';
import { join, resolve } from 'node:path';
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import Store from 'electron-store';
import type { AppSettings } from '@ln/shared';
import { closeDatabase, initDatabase } from './db/connection.js';
import { createFileLogger } from './services/logger.js';
import { resolveIconPath } from './services/icon-paths.js';
import { createSettingsService } from './services/settings.js';
import { dbPath, logsDir, modelsDir } from './services/paths.js';
import {
  createSidecarSupervisor,
  type SidecarSupervisor,
} from './services/sidecar-supervisor.js';
import { nodeSpawnSidecar } from './services/sidecar-spawn.js';
import { createSidecarHandlers } from './ipc/handlers/sidecar.js';
import { createVoicesHandlers } from './ipc/handlers/voices.js';
import { createPronunciationHandlers } from './ipc/handlers/pronunciations.js';
import { registerHandler, clearRegisteredChannels } from './ipc/registry.js';
import { getAppInfo } from './ipc/handlers/app.js';
import { createImportHandlers } from './ipc/handlers/import.js';
import { createLibraryHandlers } from './ipc/handlers/library.js';
import { createReaderHandlers } from './ipc/handlers/reader.js';
import { createSettingsHandlers } from './ipc/handlers/settings.js';
import { createImportSessionStore } from './services/import-session.js';
import { createLibraryService } from './services/library.js';
import { createBookRepository } from './db/repositories/books.js';
import { createChapterRepository } from './db/repositories/chapters.js';
import { createSegmentRepository } from './db/repositories/segments.js';
import { createPronunciationRepository } from './db/repositories/pronunciations.js';
import { createBookmarkRepository } from './db/repositories/bookmarks.js';
import { createBookmarkHandlers } from './ipc/handlers/bookmarks.js';
import { createJobRepository } from './db/repositories/jobs.js';
import { createGenerateQueue } from './services/queue.js';
import { createTimingsStore } from './services/timings-store.js';
import { createQueueHandlers, toQueueStatusInfo } from './ipc/handlers/queue.js';
import { createStorageHandlers } from './ipc/handlers/storage.js';
import { createStorageService } from './services/storage.js';
import { createWindowHandlers, readWindowState } from './ipc/handlers/window.js';
import { createMainWindow, resolvePreloadPath, resolveRendererFile } from './window.js';
import { createNodeParserRegistry, nodeDocxConverter } from '@ln/parsers/node';

/**
 * Entry point của Electron main process.
 *
 * Thứ tự khởi động: settings → logger → DB → IPC → cửa sổ.
 * Settings đọc trước vì cần `audioDir` và `theme` (màu nền cửa sổ).
 */

// Đặt tên trước khi đọc userData: mặc định Electron lấy từ package name
// (`@ln/main`) tạo ra thư mục lồng nhau khó hiểu.
app.setName('LN Reader');
app.setPath('userData', join(app.getPath('appData'), 'LN Reader'));

/**
 * Lỗi trước khi logger sẵn sàng sẽ chỉ hiện dialog "Error" trống của Electron.
 * Ghi thẳng ra file để bản đóng gói còn dấu vết chẩn đoán.
 */
const writeCrashLog = (label: string, error: unknown): void => {
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
  const line = `[${new Date().toISOString()}] ${label}\n${detail}\n\n`;
  try {
    const dir = logsDir(app.getPath('userData'));
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, 'crash.log'), line, 'utf8');
  } catch {
    // Không ghi được log thì vẫn phải in ra stderr, không nuốt lỗi gốc
    process.stderr.write(line);
  }
};

process.on('uncaughtException', (error) => writeCrashLog('uncaughtException', error));
process.on('unhandledRejection', (reason) => writeCrashLog('unhandledRejection', reason));

// Chỉ cho phép một instance — hai instance sẽ tranh nhau ghi cùng file DB
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let sidecar: SidecarSupervisor | undefined;

const getWindow = (): BrowserWindow | null => mainWindow;

const DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];

const start = (): void => {
  const userData = app.getPath('userData');
  const logger = createFileLogger(logsDir(userData));

  const store = new Store<{ settings: AppSettings }>({ name: 'settings' });
  const settings = createSettingsService(
    {
      read: () => store.get('settings'),
      write: (value) => store.set('settings', value),
    },
    join(userData, 'audio'),
  );

  const { db, migration } = initDatabase(dbPath(userData));
  logger.info(
    `DB sẵn sàng (schema ${migration.from} → ${migration.to})`,
    migration.applied.length > 0 ? `đã chạy: ${migration.applied.join(', ')}` : undefined,
  );

  const emitSettingsChanged = (next: AppSettings): void => {
    mainWindow?.webContents.send('settings:changed', next);
  };

  const settingsHandlers = createSettingsHandlers({
    settings,
    onChanged: emitSettingsChanged,
    getWindow,
  });
  const windowHandlers = createWindowHandlers(getWindow);

  const parserRegistry = createNodeParserRegistry();
  const importSessions = createImportSessionStore({ registry: parserRegistry });
  const importHandlers = createImportHandlers({
    sessions: importSessions,
    getWindow,
    extensions: parserRegistry.extensions(),
    logError: (message, detail) => logger.error(message, detail),
  });

  const bookRepo = createBookRepository(db);
  const chapterRepo = createChapterRepository(db);
  const segmentRepo = createSegmentRepository(db);
  const jobRepo = createJobRepository(db);
  const pronunciationRepo = createPronunciationRepository(db);
  const bookmarkRepo = createBookmarkRepository(db);

  // Một instance dùng chung cho cả hàng đợi (ghi) lẫn trình đọc (đọc): store
  // không giữ trạng thái nào, nhưng dựng hai bản thì lần sau sửa cách ghi mà
  // quên phía đọc sẽ không lộ ra ở typecheck.
  const timingsStore = createTimingsStore();

  // Chỗ duy nhất trong app xoá file của user: audio, timing, và bản copy sách.
  // Dựng trước `libraryHandlers` vì xoá sách cũng phải đi qua đây.
  const storage = createStorageService({
    books: bookRepo,
    chapters: chapterRepo,
    segments: segmentRepo,
    logger,
  });

  const libraryHandlers = createLibraryHandlers({
    library: createLibraryService({
      userData,
      books: bookRepo,
      chapters: chapterRepo,
      segments: segmentRepo,
    }),
    sessions: importSessions,
    books: bookRepo,
    bookmarks: bookmarkRepo,
    chapters: chapterRepo,
    segments: segmentRepo,
    // Xoá sách phải xoá cả file đã copy và audio, nếu không thư mục cứ phình
    // theo mỗi lần import rồi xoá mà không có cách nào dọn từ UI.
    removeFiles: (book) => storage.removeBookFiles({ audioDir: settings.getAll().audioDir, book }),
    logError: (message, detail) => logger.error(message, detail),
  });

  const readerHandlers = createReaderHandlers({
    books: bookRepo,
    chapters: chapterRepo,
    segments: segmentRepo,
    // `readFile` của fs/promises trả Buffer — handler tự cắt sang ArrayBuffer riêng
    readFile: (filePath) => readFile(filePath),
    convertDocx: async (filePath) => (await nodeDocxConverter(filePath)).html,
    timings: timingsStore,
    getAudioDir: () => settings.getAll().audioDir,
  });

  // Sidecar: chạy từ mã nguồn lúc dev, từ `resources/sidecar/` ở bản đóng gói.
  // `__dirname` là `apps/main/dist` nên gốc repo lùi ba cấp; ở bản đóng gói
  // thư mục đó nằm trong asar và không có `sidecar/`, nên nhánh dev tự rụng.
  const repoRoot = resolve(__dirname, '..', '..', '..');
  const supervisor = createSidecarSupervisor({
    resourcesPath: process.resourcesPath,
    repoRoot,
    modelsDir: modelsDir(userData),
    // Hàm chứ không phải chuỗi: user đổi thư mục audio trong Settings thì lần
    // sidecar dựng lại kế tiếp phải ghi vào chỗ mới.
    audioDir: () => settings.getAll().audioDir,
    spawn: nodeSpawnSidecar,
    exists: existsSync,
    logger,
    baseEnv: process.env as Record<string, string>,
    onStatusChanged: (status) => {
      mainWindow?.webContents.send('sidecar:statusChanged', status);
      // Sidecar chết thì hàng đợi phải nghỉ: chạy tiếp khi không có sidecar chỉ
      // sinh ra một loạt job lỗi và đốt sạch số lượt thử lại của chúng.
      if (status.state === 'ready') {
        queue.resume();
      } else if (status.state !== 'starting') {
        queue.pause();
      }
    },
  });
  sidecar = supervisor;
  // Hàng đợi generate. Dựng SAU supervisor vì cần `getClient`, nhưng chính
  // supervisor lại gọi `queue.resume()/pause()` ở callback trạng thái — callback
  // đó chỉ chạy sau khi `supervisor.start()` được gọi ở cuối hàm, lúc `queue` đã
  // tồn tại.
  const queue = createGenerateQueue({
    jobs: jobRepo,
    segments: segmentRepo,
    timings: timingsStore,
    getClient: () => supervisor.getClient(),
    // Đọc lúc chạy chứ không chốt sẵn: user đổi thư mục audio và bitrate trong
    // Settings giữa lúc hàng đợi đang chạy.
    getAudioDir: () => settings.getAll().audioDir,
    getBitrate: () => settings.getAll().bitrate,
    getVoiceId: (lang) => {
      const current = settings.getAll();
      const voiceId = lang === 'vi' ? current.voiceVi : current.voiceEn;
      return voiceId === '' ? undefined : voiceId;
    },
    getBookLang: (bookId) => bookRepo.findById(bookId)?.lang ?? 'vi',
    getPronunciations: (bookId) => pronunciationRepo.lookupTable(bookId),
    onStatusChanged: (status) => {
      mainWindow?.webContents.send('queue:statusChanged', toQueueStatusInfo(status));
    },
    onSegmentChanged: (segmentId) => {
      const segment = segmentRepo.findById(segmentId);
      if (segment !== undefined) {
        mainWindow?.webContents.send('queue:segmentUpdated', segment);
      }
    },
    logger,
  });

  // Job đang chạy lúc app bị tắt đột ngột mắc kẹt ở `running` mãi mãi nếu không
  // dọn: worker mới không nhận nó, mà unique index lại chặn tạo job mới cho
  // segment đó. Chạy MỘT lần, trước khi có bất kỳ worker nào.
  queue.recover();

  const queueHandlers = createQueueHandlers({
    queue,
    jobs: jobRepo,
    segments: segmentRepo,
    chapters: chapterRepo,
    getBitrate: () => settings.getAll().bitrate,
  });

  const storageHandlers = createStorageHandlers({
    storage,
    books: bookRepo,
    chapters: chapterRepo,
    // Xoá audio phải huỷ job của sách đó trước, nếu không worker ghi lại đúng
    // những file vừa xoá.
    queue,
    getAudioDir: () => settings.getAll().audioDir,
    getWarnBytes: () => settings.getAll().storageWarnBytes,
  });

  const sidecarHandlers = createSidecarHandlers({ getStatus: () => supervisor.getStatus() });
  const voicesHandlers = createVoicesHandlers({
    // Lấy client mỗi lần gọi chứ không giữ lại: sidecar restart thì client cũ
    // trỏ vào cổng đã chết, mà supervisor đã dựng client mới rồi.
    getClient: () => supervisor.getClient(),
    onProgress: (progress) => {
      mainWindow?.webContents.send('voices:downloadProgress', progress);
    },
    getBitrate: () => settings.getAll().bitrate,
    logError: (message, detail) => {
      logger.error(message, detail);
    },
  });

  const pronunciationHandlers = createPronunciationHandlers({
    pronunciations: pronunciationRepo,
    bookExists: (bookId) => bookRepo.findById(bookId) !== undefined,
    newId: randomUUID,
    now: () => Date.now(),
  });

  const bookmarkHandlers = createBookmarkHandlers({
    bookmarks: bookmarkRepo,
    segments: segmentRepo,
    newId: randomUUID,
    now: () => Date.now(),
  });

  registerHandler('app:getInfo', getAppInfo, logger);
  registerHandler('settings:getAll', settingsHandlers.getAll, logger);
  registerHandler('settings:update', settingsHandlers.update, logger);
  registerHandler('settings:setTheme', settingsHandlers.setTheme, logger);
  registerHandler('settings:pickAudioDir', settingsHandlers.pickAudioDir, logger);
  registerHandler('import:pickFile', importHandlers.pickFile, logger);
  registerHandler('import:parseFile', importHandlers.parseFile, logger);
  registerHandler('import:getChapterPreview', importHandlers.getChapterPreview, logger);
  registerHandler('import:cancel', importHandlers.cancel, logger);
  registerHandler('library:saveBook', libraryHandlers.saveBook, logger);
  registerHandler('library:list', libraryHandlers.list, logger);
  registerHandler('library:openBook', libraryHandlers.openBook, logger);
  registerHandler('library:setProgress', libraryHandlers.setProgress, logger);
  registerHandler('library:removeBook', libraryHandlers.removeBook, logger);
  registerHandler('library:getStats', libraryHandlers.getStats, logger);
  registerHandler('bookmarks:list', bookmarkHandlers.list, logger);
  registerHandler('bookmarks:add', bookmarkHandlers.add, logger);
  registerHandler('bookmarks:updateNote', bookmarkHandlers.updateNote, logger);
  registerHandler('bookmarks:remove', bookmarkHandlers.remove, logger);
  registerHandler('reader:getBookFile', readerHandlers.getBookFile, logger);
  registerHandler('reader:getBookHtml', readerHandlers.getBookHtml, logger);
  registerHandler('reader:listSegments', readerHandlers.listSegments, logger);
  registerHandler('reader:getSegmentAudio', readerHandlers.getSegmentAudio, logger);
  registerHandler('sidecar:getStatus', sidecarHandlers.getStatus, logger);
  registerHandler('voices:listCatalog', voicesHandlers.listCatalog, logger);
  registerHandler('voices:listInstalled', voicesHandlers.listInstalled, logger);
  registerHandler('voices:download', voicesHandlers.download, logger);
  registerHandler('voices:cancelDownload', voicesHandlers.cancelDownload, logger);
  registerHandler('voices:remove', voicesHandlers.remove, logger);
  registerHandler('voices:preview', voicesHandlers.preview, logger);
  registerHandler('pronunciations:list', pronunciationHandlers.list, logger);
  registerHandler('pronunciations:save', pronunciationHandlers.save, logger);
  registerHandler('pronunciations:remove', pronunciationHandlers.remove, logger);
  registerHandler('queue:enqueueSegments', queueHandlers.enqueueSegments, logger);
  registerHandler('queue:enqueueChapter', queueHandlers.enqueueChapter, logger);
  registerHandler('queue:enqueueBook', queueHandlers.enqueueBook, logger);
  registerHandler('queue:estimateChapter', queueHandlers.estimateChapter, logger);
  registerHandler('queue:estimateBook', queueHandlers.estimateBook, logger);
  registerHandler('queue:getStatus', queueHandlers.getStatus, logger);
  registerHandler('queue:listPending', queueHandlers.listPending, logger);
  registerHandler('queue:pause', queueHandlers.pause, logger);
  registerHandler('queue:resume', queueHandlers.resume, logger);
  registerHandler('queue:cancelJob', queueHandlers.cancelJob, logger);
  registerHandler('queue:cancelBook', queueHandlers.cancelBook, logger);
  registerHandler('queue:cancelAll', queueHandlers.cancelAll, logger);
  registerHandler('storage:getUsage', storageHandlers.getUsage, logger);
  registerHandler('storage:getChapterUsage', storageHandlers.getChapterUsage, logger);
  registerHandler('storage:deleteChapterAudio', storageHandlers.deleteChapterAudio, logger);
  registerHandler('storage:deleteBookAudio', storageHandlers.deleteBookAudio, logger);
  registerHandler('storage:deleteReadAudio', storageHandlers.deleteReadAudio, logger);
  registerHandler('storage:deleteOrphans', storageHandlers.deleteOrphans, logger);
  registerHandler('window:minimize', windowHandlers.minimize, logger);
  registerHandler('window:toggleMaximize', windowHandlers.toggleMaximize, logger);
  registerHandler('window:close', windowHandlers.close, logger);
  registerHandler('window:getState', windowHandlers.getState, logger);

  // Thư mục chứa chính file main đã build. Dev: apps/main/dist.
  // Bản đóng gói: <asar>/apps/main/dist. Suy từ __dirname nên đúng cả hai,
  // trong khi app.getAppPath() trỏ về gốc asar và ghép sai đường dẫn.
  const appRoot = __dirname;

  // Icon cửa sổ. Thiếu file thì `undefined` và Electron dùng logo mặc định —
  // không chặn khởi động vì một file trang trí, nhưng vẫn ghi log để còn biết.
  const iconPath = resolveIconPath({
    resourcesPath: process.resourcesPath,
    repoRoot,
    exists: existsSync,
  });
  if (iconPath === undefined) {
    logger.warn('Không tìm thấy icon.ico — cửa sổ sẽ dùng logo Electron mặc định');
  }

  mainWindow = createMainWindow({
    preloadPath: resolvePreloadPath(appRoot),
    devServerUrl: DEV_SERVER_URL,
    rendererFile: resolveRendererFile(appRoot),
    settings: settings.getAll(),
    iconPath,
    openDevTools: process.env['LN_DEVTOOLS'] === '1',
    onLoadError: (message) => logger.error(message),
  });

  // Titlebar tự vẽ cần biết trạng thái để đổi icon phóng to / khôi phục
  const pushWindowState = (): void => {
    if (mainWindow === null || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('window:stateChanged', readWindowState(mainWindow));
  };

  mainWindow.on('maximize', pushWindowState);
  mainWindow.on('unmaximize', pushWindowState);
  mainWindow.on('enter-full-screen', pushWindowState);
  mainWindow.on('leave-full-screen', pushWindowState);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Khởi động sidecar SAU khi cửa sổ đã tạo, và không `await`: sidecar mất
  // vài giây nạp Python, chờ nó xong mới vẽ cửa sổ thì app trông như bị treo.
  // Trạng thái đẩy xuống renderer qua `sidecar:statusChanged` khi sẵn sàng.
  void supervisor.start();

  logger.info('App khởi động xong');
};

app.on('second-instance', () => {
  if (mainWindow === null) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

void app.whenReady().then(start);

app.on('window-all-closed', () => {
  // Windows: đóng cửa sổ là thoát app
  app.quit();
});

app.on('will-quit', () => {
  clearRegisteredChannels();
  // Giết sidecar TRƯỚC khi đóng DB: bỏ sót thì tiến trình Python sống tiếp sau
  // khi app đã thoát, giữ cổng và giữ luôn file model đang mở.
  void sidecar?.stop();
  closeDatabase();
});
