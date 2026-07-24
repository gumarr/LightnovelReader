import { join } from 'node:path';

/**
 * Nguồn DUY NHẤT sinh đường dẫn file của app. Không hardcode path ở nơi khác.
 *
 * `audioDir` do user cấu hình và có thể nằm ngoài `userData` (ổ khác) — mọi
 * hàm ở đây nhận nó làm tham số thay vì tự đoán.
 */

export type AppPaths = {
  /** Thư mục userData của Electron — chứa DB và sách đã import */
  userData: string;
  /** Thư mục lưu audio, user đổi được */
  audioDir: string;
};

/**
 * ID sinh ra trong app không chứa ký tự lạ, nhưng ID cũng đi vào tên file —
 * kiểm tra để một ID hỏng (`..`, dấu `/`) không thoát ra ngoài thư mục audio.
 */
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

export const isSafeId = (id: string): boolean =>
  id.length > 0 && id.length <= 64 && SAFE_ID.test(id);

export const assertSafeId = (id: string, label: string): void => {
  if (!isSafeId(id)) {
    throw new Error(`${label} không hợp lệ để dùng làm tên file: ${JSON.stringify(id)}`);
  }
};

export const dbPath = (userData: string): string => join(userData, 'ln-reader.db');

/** Thư mục chứa bản copy của sách đã import */
export const libraryDir = (userData: string): string => join(userData, 'library');

export const bookFilePath = (userData: string, bookId: string, ext: string): string => {
  assertSafeId(bookId, 'bookId');
  return join(libraryDir(userData), `${bookId}${ext.startsWith('.') ? ext : `.${ext}`}`);
};

export const coversDir = (userData: string): string => join(userData, 'covers');

export const coverPath = (userData: string, bookId: string): string => {
  assertSafeId(bookId, 'bookId');
  return join(coversDir(userData), `${bookId}.jpg`);
};

export const logsDir = (userData: string): string => join(userData, 'logs');

/** Thư mục model TTS / aligner tải runtime từ Hugging Face */
export const modelsDir = (userData: string): string => join(userData, 'models');

export const voiceDir = (userData: string, voiceId: string): string =>
  join(modelsDir(userData), 'voices', voiceId);

/** Audio của một sách: `{audioDir}/{bookId}/` */
export const bookAudioDir = (audioDir: string, bookId: string): string => {
  assertSafeId(bookId, 'bookId');
  return join(audioDir, bookId);
};

/** File audio của segment: `{audioDir}/{bookId}/{segmentId}.ogg` */
export const segmentAudioPath = (audioDir: string, bookId: string, segmentId: string): string => {
  assertSafeId(segmentId, 'segmentId');
  return join(bookAudioDir(audioDir, bookId), `${segmentId}.ogg`);
};

/** File timing của segment: `{audioDir}/{bookId}/{segmentId}.json` */
export const segmentTimingsPath = (audioDir: string, bookId: string, segmentId: string): string => {
  assertSafeId(segmentId, 'segmentId');
  return join(bookAudioDir(audioDir, bookId), `${segmentId}.json`);
};
