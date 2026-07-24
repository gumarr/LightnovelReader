import { appendFileSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Log ra file trong `{userData}/logs/` kèm xoay vòng theo kích thước.
 * Không dùng thư viện ngoài — nhu cầu ở đây đủ đơn giản.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type Logger = {
  debug: (message: string, detail?: string) => void;
  info: (message: string, detail?: string) => void;
  warn: (message: string, detail?: string) => void;
  error: (message: string, detail?: string) => void;
};

const MAX_LOG_BYTES = 2 * 1024 * 1024;
const MAX_LOG_FILES = 5;

export const formatLogLine = (level: LogLevel, message: string, detail?: string): string => {
  const timestamp = new Date().toISOString();
  const suffix = detail === undefined ? '' : ` | ${detail.replace(/\r?\n/g, ' ⏎ ')}`;
  return `[${timestamp}] ${level.toUpperCase().padEnd(5)} ${message}${suffix}\n`;
};

const isNotFound = (e: unknown): boolean =>
  typeof e === 'object' && e !== null && 'code' in e && e.code === 'ENOENT';

/** Xoay file khi vượt ngưỡng, giữ tối đa MAX_LOG_FILES bản */
const rotateIfNeeded = (dir: string, file: string): void => {
  let size: number;
  try {
    size = statSync(file).size;
  } catch (e) {
    // File chưa tồn tại là bình thường ở lần ghi đầu; lỗi khác phải nổi lên
    if (isNotFound(e)) return;
    throw e;
  }
  if (size < MAX_LOG_BYTES) return;

  renameSync(file, join(dir, `app-${Date.now()}.log`));

  const archived = readdirSync(dir)
    .filter((name) => name.startsWith('app-') && name.endsWith('.log'))
    .sort()
    .reverse();

  for (const stale of archived.slice(MAX_LOG_FILES - 1)) {
    unlinkSync(join(dir, stale));
  }
};

export const createFileLogger = (logsDirPath: string): Logger => {
  mkdirSync(logsDirPath, { recursive: true });
  const file = join(logsDirPath, 'app.log');

  const write = (level: LogLevel, message: string, detail?: string): void => {
    const line = formatLogLine(level, message, detail);
    process.stdout.write(line);
    rotateIfNeeded(logsDirPath, file);
    appendFileSync(file, line, 'utf8');
  };

  return {
    debug: (m, d) => write('debug', m, d),
    info: (m, d) => write('info', m, d),
    warn: (m, d) => write('warn', m, d),
    error: (m, d) => write('error', m, d),
  };
};
