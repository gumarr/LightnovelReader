import { app, type BrowserWindow } from 'electron';
import { join } from 'node:path';
import { appendFileSync, mkdirSync } from 'node:fs';
import Store from 'electron-store';
import type { AppSettings } from '@ln/shared';
import { closeDatabase, initDatabase } from './db/connection.js';
import { createFileLogger } from './services/logger.js';
import { createSettingsService } from './services/settings.js';
import { dbPath, logsDir } from './services/paths.js';
import { registerHandler, clearRegisteredChannels } from './ipc/registry.js';
import { getAppInfo } from './ipc/handlers/app.js';
import { createImportHandlers } from './ipc/handlers/import.js';
import { createLibraryHandlers } from './ipc/handlers/library.js';
import { createSettingsHandlers } from './ipc/handlers/settings.js';
import { createImportSessionStore } from './services/import-session.js';
import { createLibraryService } from './services/library.js';
import { createBookRepository } from './db/repositories/books.js';
import { createChapterRepository } from './db/repositories/chapters.js';
import { createSegmentRepository } from './db/repositories/segments.js';
import { createWindowHandlers, readWindowState } from './ipc/handlers/window.js';
import { createMainWindow, resolvePreloadPath, resolveRendererFile } from './window.js';
import { createNodeParserRegistry } from '@ln/parsers/node';

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

  const libraryHandlers = createLibraryHandlers({
    library: createLibraryService({
      userData,
      books: bookRepo,
      chapters: chapterRepo,
      segments: segmentRepo,
    }),
    sessions: importSessions,
    books: bookRepo,
    chapters: chapterRepo,
    logError: (message, detail) => logger.error(message, detail),
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
  registerHandler('window:minimize', windowHandlers.minimize, logger);
  registerHandler('window:toggleMaximize', windowHandlers.toggleMaximize, logger);
  registerHandler('window:close', windowHandlers.close, logger);
  registerHandler('window:getState', windowHandlers.getState, logger);

  // Thư mục chứa chính file main đã build. Dev: apps/main/dist.
  // Bản đóng gói: <asar>/apps/main/dist. Suy từ __dirname nên đúng cả hai,
  // trong khi app.getAppPath() trỏ về gốc asar và ghép sai đường dẫn.
  const appRoot = __dirname;
  mainWindow = createMainWindow({
    preloadPath: resolvePreloadPath(appRoot),
    devServerUrl: DEV_SERVER_URL,
    rendererFile: resolveRendererFile(appRoot),
    settings: settings.getAll(),
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
  closeDatabase();
});
