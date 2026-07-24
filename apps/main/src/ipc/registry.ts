import { ipcMain } from 'electron';
import type { IpcChannel } from '@ln/shared';
import { isIpcChannel } from '@ln/shared';
import { wrapHandler, type Handler, type IpcLogger } from './wrap.js';

/**
 * Gắn handler đã bọc lỗi vào `ipcMain`.
 * Logic bọc lỗi nằm ở `wrap.ts` để test không cần Electron.
 */

const registered = new Set<IpcChannel>();

export const registerHandler = <C extends IpcChannel>(
  channel: C,
  handler: Handler<C>,
  logger: IpcLogger,
): void => {
  if (!isIpcChannel(channel)) {
    throw new Error(`Channel "${channel}" chưa khai báo trong packages/shared/src/ipc.ts`);
  }
  if (registered.has(channel)) {
    throw new Error(`Channel "${channel}" đã được đăng ký`);
  }
  registered.add(channel);

  const wrapped = wrapHandler(channel, handler, logger);
  ipcMain.handle(channel, (_event, rawInput: unknown) => wrapped(rawInput));
};

export const clearRegisteredChannels = (): void => {
  for (const channel of registered) ipcMain.removeHandler(channel);
  registered.clear();
};

export const getRegisteredChannels = (): readonly IpcChannel[] => [...registered];
