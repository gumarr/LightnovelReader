import type { IpcChannel, IpcInput, IpcOutput, Result } from '@ln/shared';
import { err, errorMessage } from '@ln/shared';

/**
 * Bọc handler để mọi exception thành `Result` lỗi.
 * Tách khỏi `registry.ts` để test được mà không cần Electron.
 */

export type Handler<C extends IpcChannel> = (
  input: IpcInput<C>,
) => IpcOutput<C> | Promise<IpcOutput<C>>;

/** Ném khi handler nhận input sai kiểu — được chuyển thành INVALID_INPUT */
export class InvalidInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidInputError';
  }
}

export type IpcLogger = {
  error: (message: string, detail: string) => void;
};

export const wrapHandler = <C extends IpcChannel>(
  channel: C,
  handler: Handler<C>,
  logger: IpcLogger,
): ((input: unknown) => Promise<Result<unknown>>) => {
  return async (rawInput: unknown) => {
    try {
      return (await handler(rawInput as IpcInput<C>)) as Result<unknown>;
    } catch (error) {
      const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
      logger.error(`IPC ${channel} lỗi`, detail);

      return error instanceof InvalidInputError
        ? err('INVALID_INPUT', error.message)
        : err('UNKNOWN', `Lỗi khi xử lý ${channel}`, errorMessage(error));
    }
  };
};
