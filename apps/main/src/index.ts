import { app, type BrowserWindow } from 'electron';
import { join } from 'node:path';
import Store from 'electron-store';
import type { AppSettings } from '@ln/shared';
import { closeDatabase, initDatabase } from './db/connection.js';
import { createFileLogger } from './services/logger.js';
import { createSettingsService } from './services/settings.js';
import { dbPath, logsDir } from './services/paths.js';
import { registerHandler, clearRegisteredChannels } from './ipc/registry.js';
import { getAppInfo } from './ipc/handlers/app.js';
import { createSettingsHandlers } from './ipc/handlers/settings.js';
import { createWindowHandlers, readWindowState } from './ipc/handlers/window.js';
import { createMainWindow, resolvePreloadPath, resolveRendererFile } from './window.js';

/**
 * Entry point của Electron main process.
 *
 * Thứ tự khởi động: settings → logger → DB → IPC → cửa sổ.
 * Settings đọc trước vì cần `audioDir` và `theme` (màu nền cửa sổ).
 */

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

  const { migration } = initDatabase(dbPath(userData));
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

  registerHandler('app:getInfo', getAppInfo, logger);
  registerHandler('settings:getAll', settingsHandlers.getAll, logger);
  registerHandler('settings:update', settingsHandlers.update, logger);
  registerHandler('settings:setTheme', settingsHandlers.setTheme, logger);
  registerHandler('settings:pickAudioDir', settingsHandlers.pickAudioDir, logger);
  registerHandler('window:minimize', windowHandlers.minimize, logger);
  registerHandler('window:toggleMaximize', windowHandlers.toggleMaximize, logger);
  registerHandler('window:close', windowHandlers.close, logger);
  registerHandler('window:getState', windowHandlers.getState, logger);

  const appRoot = join(app.getAppPath(), 'dist');
  mainWindow = createMainWindow({
    preloadPath: resolvePreloadPath(appRoot),
    devServerUrl: DEV_SERVER_URL,
    rendererFile: resolveRendererFile(appRoot),
    settings: settings.getAll(),
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
