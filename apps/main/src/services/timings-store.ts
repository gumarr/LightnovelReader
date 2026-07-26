import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { WordTiming } from '@ln/shared';
import { segmentTimingsPath } from './paths.js';

/**
 * Đọc/ghi mốc thời gian từng từ ra `{audioDir}/{bookId}/{segmentId}.json`.
 *
 * **Vì sao ra file chứ không vào SQLite.** Một segment có 10–40 từ, một vol có
 * ~4800 segment → khoảng 100k dòng timing mỗi sách. Nhét vào DB thì file `.db`
 * phình theo nội dung sách, mà timing chỉ được đọc đúng lúc phát segment đó —
 * không có truy vấn nào cần lọc hay join qua chúng. Để cạnh file `.ogg` còn
 * được thêm một thứ: xoá audio là xoá luôn timing tương ứng, không sót rác.
 *
 * `alignStatus` vẫn nằm trong DB vì đó là thứ UI cần biết mà **không** phải
 * chạm đĩa.
 */

/**
 * Nội dung file timing.
 *
 * Có `version` vì Phase 4 (CTC forced alignment) sẽ ghi đè chính file này với
 * dữ liệu chính xác hơn. Không có số phiên bản thì lúc đó không phân biệt nổi
 * file cũ với file mới, mà timing sai chỉ biểu hiện thành highlight lệch —
 * user báo lỗi cũng không lần ra được nguồn.
 */
export type TimingsFile = {
  version: number;
  segmentId: string;
  /** Số thật do sidecar tính từ số mẫu, không phải ước lượng theo độ dài text */
  durationMs: number;
  /** Timing lấy từ phoneme của Piper hay chia đều theo ký tự */
  source: 'phoneme' | 'estimate';
  words: WordTiming[];
};

export const TIMINGS_FILE_VERSION = 1;

export type TimingsStore = {
  write(input: {
    audioDir: string;
    bookId: string;
    segmentId: string;
    durationMs: number;
    source: 'phoneme' | 'estimate';
    words: readonly WordTiming[];
  }): Promise<void>;
  /** `undefined` khi chưa generate, file đã bị xoá, hoặc nội dung không đọc được */
  read(input: {
    audioDir: string;
    bookId: string;
    segmentId: string;
  }): Promise<TimingsFile | undefined>;
  /** Xoá timing của một segment. Không có file thì coi như xong. */
  remove(input: { audioDir: string; bookId: string; segmentId: string }): Promise<void>;
};

/** Lỗi "không tìm thấy file" của Node, phân biệt với lỗi quyền/đĩa hỏng */
const isNotFound = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as NodeJS.ErrnoException).code === 'ENOENT';

/**
 * Kiểm nội dung đọc từ đĩa.
 *
 * File nằm trong thư mục user cấu hình được — nó có thể bị sửa tay, bị cắt cụt
 * do mất điện giữa lúc ghi, hoặc còn sót từ phiên bản cũ. Tin thẳng vào
 * `JSON.parse` thì `words` hỏng sẽ làm player ném đúng lúc đang phát.
 */
const parseTimingsFile = (raw: unknown, segmentId: string): TimingsFile | undefined => {
  if (typeof raw !== 'object' || raw === null) return undefined;

  const body = raw as Record<string, unknown>;
  const { version, durationMs, source, words } = body;

  if (version !== TIMINGS_FILE_VERSION) return undefined;
  if (typeof durationMs !== 'number') return undefined;
  if (source !== 'phoneme' && source !== 'estimate') return undefined;
  if (!Array.isArray(words)) return undefined;

  const parsed: WordTiming[] = [];
  for (const item of words) {
    if (typeof item !== 'object' || item === null) continue;
    const { w, startMs, endMs, charStart, charEnd } = item as Record<string, unknown>;
    if (
      typeof w !== 'string' ||
      typeof startMs !== 'number' ||
      typeof endMs !== 'number' ||
      typeof charStart !== 'number' ||
      typeof charEnd !== 'number'
    ) {
      // Bỏ mốc hỏng chứ không vứt cả file: mất một từ chỉ lệch highlight một
      // chữ, còn trả `undefined` là mất luôn timing của cả segment.
      continue;
    }
    parsed.push({ w, startMs, endMs, charStart, charEnd });
  }

  return {
    version: TIMINGS_FILE_VERSION,
    segmentId: typeof body['segmentId'] === 'string' ? body['segmentId'] : segmentId,
    durationMs,
    source,
    words: parsed,
  };
};

export const createTimingsStore = (): TimingsStore => ({
  async write(input) {
    const { audioDir, bookId, segmentId, durationMs, source, words } = input;
    const target = segmentTimingsPath(audioDir, bookId, segmentId);

    await mkdir(dirname(target), { recursive: true });

    const content: TimingsFile = {
      version: TIMINGS_FILE_VERSION,
      segmentId,
      durationMs,
      source,
      words: [...words],
    };

    // Ghi ra `.part` rồi đổi tên: `rename` trong cùng thư mục là thao tác
    // nguyên tử trên NTFS, nên mất điện giữa chừng để lại file `.part` bỏ đi
    // được chứ không phải file `.json` cụt mà player vẫn tưởng là hợp lệ.
    // Cùng cách sidecar ghi file `.ogg`.
    const temp = `${target}.part`;
    await writeFile(temp, JSON.stringify(content), 'utf8');
    await rename(temp, target);
  },

  async read(input) {
    const { audioDir, bookId, segmentId } = input;
    const target = segmentTimingsPath(audioDir, bookId, segmentId);

    let raw: string;
    try {
      raw = await readFile(target, 'utf8');
    } catch (error) {
      // Chưa generate là chuyện bình thường — không phải lỗi. Nhưng lỗi khác
      // (mất quyền đọc, ổ đĩa rút ra) thì phải nổi lên để còn báo user, chứ
      // nuốt hết thì trông y hệt "chưa generate" và user bấm generate lại mãi.
      if (isNotFound(error)) return undefined;
      throw error;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // File hỏng thì coi như chưa có: generate lại được, còn ném ở đây thì
      // chặn luôn cả việc mở sách.
      return undefined;
    }

    return parseTimingsFile(parsed, segmentId);
  },

  async remove(input) {
    const { audioDir, bookId, segmentId } = input;
    try {
      await unlink(segmentTimingsPath(audioDir, bookId, segmentId));
    } catch (error) {
      if (isNotFound(error)) return;
      throw error;
    }
  },
});
