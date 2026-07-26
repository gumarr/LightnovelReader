import { describe, expect, it } from 'vitest';
import type { ChapterUsageInfo, StorageUsageInfo } from '@ln/shared';
import {
  canDeleteChapter,
  chapterProgressLabel,
  orphanSummary,
  usageLevel,
  warnPercent,
} from './format';

const usage = (overrides: Partial<StorageUsageInfo> = {}): StorageUsageInfo => ({
  audioDir: 'E:\\ln-audio',
  audioBytes: 0,
  audioBytesOnDisk: 0,
  orphanBytes: 0,
  orphanFiles: 0,
  warnBytes: 1000,
  books: [],
  ...overrides,
});

const chapter = (overrides: Partial<ChapterUsageInfo> = {}): ChapterUsageInfo => ({
  chapterId: 'chap-1',
  title: 'Chương 1',
  index: 0,
  segmentCount: 10,
  readySegments: 0,
  audioBytes: 0,
  ...overrides,
});

describe('warnPercent', () => {
  it('tính phần trăm so với ngưỡng', () => {
    expect(warnPercent(usage({ audioBytes: 500, warnBytes: 1000 }))).toBe(50);
  });

  it('chặn trần 100 để thanh không tràn khung', () => {
    expect(warnPercent(usage({ audioBytes: 3000, warnBytes: 1000 }))).toBe(100);
  });

  it('tắt cảnh báo (ngưỡng 0) thì trả 0 chứ không chia cho 0', () => {
    expect(warnPercent(usage({ audioBytes: 500, warnBytes: 0 }))).toBe(0);
  });

  it('chưa nạp thì trả 0', () => {
    expect(warnPercent(null)).toBe(0);
  });
});

describe('usageLevel', () => {
  it('dưới 80% là ok', () => {
    expect(usageLevel(usage({ audioBytes: 700, warnBytes: 1000 }))).toBe('ok');
  });

  it('từ 80% là near — cảnh báo lúc còn kịp xoá', () => {
    expect(usageLevel(usage({ audioBytes: 800, warnBytes: 1000 }))).toBe('near');
  });

  it('vượt ngưỡng là over', () => {
    expect(usageLevel(usage({ audioBytes: 1001, warnBytes: 1000 }))).toBe('over');
  });

  it('đúng bằng ngưỡng vẫn chưa phải over', () => {
    // Ngưỡng là "cảnh báo khi vượt", không phải "khi đạt"
    expect(usageLevel(usage({ audioBytes: 1000, warnBytes: 1000 }))).toBe('near');
  });

  it('tắt cảnh báo thì luôn ok dù dung lượng bao nhiêu', () => {
    expect(usageLevel(usage({ audioBytes: 10 ** 12, warnBytes: 0 }))).toBe('ok');
  });
});

describe('chapterProgressLabel', () => {
  it('chưa có audio nào', () => {
    expect(chapterProgressLabel(chapter())).toBe('Chưa tạo audio');
  });

  it('đủ audio', () => {
    expect(chapterProgressLabel(chapter({ readySegments: 10 }))).toBe('Đủ audio');
  });

  it('một phần thì hiện tỉ lệ', () => {
    expect(chapterProgressLabel(chapter({ readySegments: 4 }))).toBe('4/10 đoạn');
  });

  it('chương không có đoạn nào KHÁC với chưa tạo audio', () => {
    // Vùng trang toàn ảnh cho ra chương 0 segment — không phải "chưa generate",
    // mà là không có gì để generate.
    expect(chapterProgressLabel(chapter({ segmentCount: 0 }))).toBe('Không có đoạn nào');
  });
});

describe('canDeleteChapter', () => {
  it('có audio thì xoá được', () => {
    expect(canDeleteChapter(chapter({ readySegments: 1 }))).toBe(true);
  });

  it('chưa có audio thì không có gì để xoá', () => {
    expect(canDeleteChapter(chapter())).toBe(false);
  });
});

describe('orphanSummary', () => {
  it('không có rác thì không hiện dòng nào', () => {
    // Ca bình thường của tuyệt đại đa số user — không được thêm dòng nhiễu
    expect(orphanSummary(usage())).toBeUndefined();
  });

  it('có rác thì nói rõ bao nhiêu file và bao nhiêu byte', () => {
    const text = orphanSummary(usage({ orphanFiles: 4, orphanBytes: 2048 }));
    expect(text).toContain('4 file');
    expect(text).toContain('2.0 KB');
  });

  it('chưa nạp thì trả undefined', () => {
    expect(orphanSummary(null)).toBeUndefined();
  });
});
