import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WordTiming } from '@ln/shared';
import { createTimingsStore, TIMINGS_FILE_VERSION } from './timings-store.js';
import { segmentTimingsPath } from './paths.js';

let audioDir: string;
const store = createTimingsStore();

const words: WordTiming[] = [
  { w: 'Sau', startMs: 0, endMs: 232, charStart: 0, charEnd: 3 },
  { w: 'giờ', startMs: 232, endMs: 480, charStart: 4, charEnd: 7 },
];

beforeEach(() => {
  audioDir = mkdtempSync(join(tmpdir(), 'ln-timings-'));
});

afterEach(() => {
  rmSync(audioDir, { recursive: true, force: true });
});

const writeSample = async (): Promise<void> => {
  await store.write({
    audioDir,
    bookId: 'book1',
    segmentId: 'seg1',
    durationMs: 2810,
    source: 'phoneme',
    words,
  });
};

describe('createTimingsStore', () => {
  it('ghi đúng chỗ domain model quy định — cạnh file .ogg', async () => {
    await writeSample();

    expect(existsSync(join(audioDir, 'book1', 'seg1.json'))).toBe(true);
  });

  it('tự tạo thư mục sách khi chưa có', async () => {
    // Job đầu tiên của một sách chạy khi `{audioDir}/{bookId}/` chưa tồn tại.
    // Không tạo thì mọi lượt generate đầu tiên đều hỏng với ENOENT.
    await writeSample();

    expect(existsSync(join(audioDir, 'book1'))).toBe(true);
  });

  it('đọc lại đúng những gì đã ghi', async () => {
    await writeSample();

    const read = await store.read({ audioDir, bookId: 'book1', segmentId: 'seg1' });

    expect(read).toEqual({
      version: TIMINGS_FILE_VERSION,
      segmentId: 'seg1',
      durationMs: 2810,
      source: 'phoneme',
      words,
    });
  });

  it('giữ nguyên durationMs — số thật từ sidecar, không ước lượng lại', async () => {
    await writeSample();

    const read = await store.read({ audioDir, bookId: 'book1', segmentId: 'seg1' });
    expect(read?.durationMs).toBe(2810);
  });

  it('phân biệt được timing phoneme với timing ước lượng', async () => {
    await store.write({
      audioDir,
      bookId: 'book1',
      segmentId: 'seg2',
      durationMs: 100,
      source: 'estimate',
      words,
    });

    const read = await store.read({ audioDir, bookId: 'book1', segmentId: 'seg2' });
    expect(read?.source).toBe('estimate');
  });

  it('segment chưa generate thì trả undefined, không ném', async () => {
    // Mở sách chưa generate là chuyện bình thường — ném ở đây thì chặn luôn
    // việc mở sách.
    await expect(
      store.read({ audioDir, bookId: 'book1', segmentId: 'seg-chua-generate' }),
    ).resolves.toBeUndefined();
  });

  it('không để lại file .part sau khi ghi xong', async () => {
    await writeSample();

    const files = readdirSync(join(audioDir, 'book1'));
    expect(files).toEqual(['seg1.json']);
  });

  it('ghi đè lượt generate cũ mà không cần xoá trước', async () => {
    await writeSample();
    await store.write({
      audioDir,
      bookId: 'book1',
      segmentId: 'seg1',
      durationMs: 999,
      source: 'estimate',
      words: [],
    });

    const read = await store.read({ audioDir, bookId: 'book1', segmentId: 'seg1' });
    expect(read?.durationMs).toBe(999);
    expect(read?.words).toEqual([]);
  });

  describe('file hỏng', () => {
    const corrupt = (content: string): void => {
      mkdirSync(join(audioDir, 'book1'), { recursive: true });
      writeFileSync(segmentTimingsPath(audioDir, 'book1', 'seg1'), content, 'utf8');
    };

    it('JSON cụt (mất điện giữa lúc ghi) thì coi như chưa có', async () => {
      corrupt('{"version":1,"words":[');

      await expect(
        store.read({ audioDir, bookId: 'book1', segmentId: 'seg1' }),
      ).resolves.toBeUndefined();
    });

    it('phiên bản lạ thì bỏ qua — Phase 4 sẽ ghi đè file này', async () => {
      // Không có số phiên bản thì file do CTC ghi và file ước lượng lẫn lộn,
      // mà timing sai chỉ biểu hiện thành highlight lệch.
      corrupt(JSON.stringify({ version: 99, durationMs: 1, source: 'phoneme', words: [] }));

      await expect(
        store.read({ audioDir, bookId: 'book1', segmentId: 'seg1' }),
      ).resolves.toBeUndefined();
    });

    it('bỏ mốc từ hỏng nhưng giữ lại phần còn đọc được', async () => {
      corrupt(
        JSON.stringify({
          version: TIMINGS_FILE_VERSION,
          segmentId: 'seg1',
          durationMs: 500,
          source: 'phoneme',
          words: [words[0], { w: 'thiếu-trường' }, null],
        }),
      );

      const read = await store.read({ audioDir, bookId: 'book1', segmentId: 'seg1' });
      expect(read?.words).toEqual([words[0]]);
    });

    it('source không hợp lệ thì bỏ cả file', async () => {
      corrupt(
        JSON.stringify({ version: TIMINGS_FILE_VERSION, durationMs: 1, source: 'ctc', words: [] }),
      );

      await expect(
        store.read({ audioDir, bookId: 'book1', segmentId: 'seg1' }),
      ).resolves.toBeUndefined();
    });
  });

  describe('remove', () => {
    it('xoá được file timing', async () => {
      await writeSample();
      await store.remove({ audioDir, bookId: 'book1', segmentId: 'seg1' });

      expect(existsSync(join(audioDir, 'book1', 'seg1.json'))).toBe(false);
    });

    it('xoá thứ không tồn tại thì im lặng — xoá audio hàng loạt không được vỡ giữa chừng', async () => {
      await expect(
        store.remove({ audioDir, bookId: 'book1', segmentId: 'seg-khong-ton-tai' }),
      ).resolves.toBeUndefined();
    });
  });

  it('ID hỏng không thoát được ra ngoài thư mục audio', async () => {
    // `segmentTimingsPath` đã chặn, nhưng khoá lại ở đây vì store là chỗ thật
    // sự chạm đĩa: ID đi thẳng vào tên file.
    await expect(
      store.write({
        audioDir,
        bookId: 'book1',
        segmentId: '../../thoát',
        durationMs: 1,
        source: 'estimate',
        words: [],
      }),
    ).rejects.toThrow(/segmentId/);
  });

  it('ghi JSON gọn, không xuống dòng — 100k mốc mỗi sách', async () => {
    await writeSample();

    const raw = readFileSync(join(audioDir, 'book1', 'seg1.json'), 'utf8');
    expect(raw).not.toContain('\n');
  });
});
