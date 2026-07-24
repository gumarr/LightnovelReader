import { app } from 'electron';
import { ok, type AppInfo, type Result } from '@ln/shared';

/** Thông tin phiên bản hiển thị ở màn hình Settings / About */
export const getAppInfo = (): Result<AppInfo> =>
  ok({
    version: app.getVersion(),
    electronVersion: process.versions.electron ?? 'unknown',
    chromeVersion: process.versions.chrome ?? 'unknown',
    nodeVersion: process.versions.node,
    platform: process.platform,
    userDataPath: app.getPath('userData'),
  });
