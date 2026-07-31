import { describe, expect, it } from 'vitest';
import type { ReadingStats } from '@ln/shared';
import { audioPercent, lastOpenedLabel, positionLabel, readPercent } from './stats-format';

const stats = (overrides: Partial<ReadingStats> = {}): ReadingStats => ({
  bookId: 'book-1',
  chapterCount: 8,
  chaptersRead: 2,
  segmentCount: 100,
  segmentsRead: 25,
  segmentsWithAudio: 40,
  audioDurationMs: 600000,
  audioBytes: 1800000,
  currentChapterTitle: 'Chương 3',
  lastOpenedAt: Date.UTC(2026, 6, 31, 5, 0),
  bookmarkCount: 3,
  ...overrides,
});

describe('readPercent', () => {
  it('tính theo segment, không theo chương', () => {
    expect(readPercent(stats({ segmentsRead: 25, segmentCount: 100 }))).toBe(25);
  });

  it('làm tròn về số nguyên', () => {
    expect(readPercent(stats({ segmentsRead: 1, segmentCount: 3 }))).toBe(33);
  });

  it('sách chưa có segment nào trả 0, không phải NaN', () => {
    // `NaN%` lọt ra `style.width` là thanh biến mất luôn
    expect(readPercent(stats({ segmentsRead: 0, segmentCount: 0 }))).toBe(0);
  });

  it('kẹp trên 100 khi hai con số lệch nhau', () => {
    expect(readPercent(stats({ segmentsRead: 150, segmentCount: 100 }))).toBe(100);
  });

  it('kẹp dưới 0', () => {
    expect(readPercent(stats({ segmentsRead: -5, segmentCount: 100 }))).toBe(0);
  });
});

describe('audioPercent', () => {
  it('đo tiến độ generate, tách khỏi tiến độ đọc', () => {
    // Hai con số này thường lệch nhau nhiều nên không được gộp một thanh
    const s = stats({ segmentsRead: 25, segmentsWithAudio: 40, segmentCount: 100 });

    expect(audioPercent(s)).toBe(40);
    expect(readPercent(s)).toBe(25);
  });

  it('sách rỗng trả 0', () => {
    expect(audioPercent(stats({ segmentCount: 0, segmentsWithAudio: 0 }))).toBe(0);
  });
});

describe('positionLabel', () => {
  it('nói rõ chương và số đoạn', () => {
    // `+1` vì `segmentsRead` là số đoạn ĐỨNG TRƯỚC — đang đọc đoạn thứ 26
    expect(positionLabel(stats({ segmentsRead: 25, segmentCount: 100 }))).toBe(
      'Chương 3 · đoạn 26/100',
    );
  });

  it('chưa mở lần nào thì nói thẳng, không hiện "0/120"', () => {
    // `exactOptionalPropertyTypes`: bỏ hẳn khoá chứ không gán `undefined` —
    // đúng hình dạng main thật trả về cho sách chưa mở.
    const { currentChapterTitle: _omitted, ...withoutChapter } = stats();
    const label = positionLabel(withoutChapter);

    expect(label).toBe('Chưa mở lần nào');
    expect(label).not.toContain('0/');
  });
});

describe('lastOpenedLabel', () => {
  it('hiện ngày cụ thể', () => {
    // Ngày tuyệt đối chứ không "3 ngày trước": chuỗi tương đối sẽ nói sai sau
    // nửa đêm vì màn này không tự làm mới.
    expect(lastOpenedLabel(stats())).toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/);
  });

  it('chưa mở lần nào', () => {
    const { lastOpenedAt: _omitted, ...neverOpened } = stats();

    expect(lastOpenedLabel(neverOpened)).toBe('Chưa mở lần nào');
  });
});
