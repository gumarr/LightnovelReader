import { describe, expect, it } from 'vitest';
import { estimateGenerate, formatBytes, formatDuration } from './estimate.js';
import { CHARS_PER_SECOND_ESTIMATE, bytesPerSecondAt } from './constants.js';

describe('estimateGenerate', () => {
  it('trả về 0 cho danh sách rỗng', () => {
    const e = estimateGenerate([], 24);
    expect(e).toEqual({
      totalChars: 0,
      segmentCount: 0,
      audioDurationMs: 0,
      audioBytes: 0,
      processingMs: 0,
    });
  });

  it('cộng dồn ký tự của mọi segment', () => {
    const e = estimateGenerate(['abc', 'de'], 24);
    expect(e.totalChars).toBe(5);
    expect(e.segmentCount).toBe(2);
  });

  it('quy đổi ký tự sang thời lượng theo CHARS_PER_SECOND_ESTIMATE', () => {
    const text = 'x'.repeat(CHARS_PER_SECOND_ESTIMATE * 10);
    const e = estimateGenerate([text], 24);
    expect(e.audioDurationMs).toBe(10_000);
  });

  it('dung lượng tỉ lệ thuận với bitrate', () => {
    const text = 'x'.repeat(CHARS_PER_SECOND_ESTIMATE * 60);
    const low = estimateGenerate([text], 16);
    const high = estimateGenerate([text], 32);
    expect(high.audioBytes).toBe(low.audioBytes * 2);
    expect(low.audioBytes).toBe(60 * bytesPerSecondAt(16));
  });

  it('thời gian xử lý nhỏ hơn thời lượng audio (RTF < 1)', () => {
    const e = estimateGenerate(['x'.repeat(3000)], 24);
    expect(e.processingMs).toBeGreaterThan(0);
    expect(e.processingMs).toBeLessThan(e.audioDurationMs);
  });

  it('một vol LN 9 giờ ở 24 kbps ≈ 90–100 MB', () => {
    // plan.md ghi 800MB–1.2GB cho 1 vol, nhưng con số đó không khớp với Opus
    // 24 kbps: 9h × 3000 B/s ≈ 97 MB. Muốn 1 GB phải cần ~250 kbps.
    // Test khoá theo phép tính đúng để storage manager ước lượng không sai một bậc.
    const nineHoursChars = 9 * 3600 * CHARS_PER_SECOND_ESTIMATE;
    const e = estimateGenerate(['x'.repeat(nineHoursChars)], 24);
    const mb = e.audioBytes / 1024 ** 2;
    expect(mb).toBeGreaterThan(90);
    expect(mb).toBeLessThan(100);
  });
});

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [1024, '1.0 KB'],
    [1536, '1.5 KB'],
    [1024 ** 2 * 15, '15 MB'],
    [1024 ** 3, '1.0 GB'],
  ])('formatBytes(%i) = %s', (input, expected) => {
    expect(formatBytes(input)).toBe(expected);
  });

  it('xử lý giá trị không hợp lệ mà không throw', () => {
    expect(formatBytes(-1)).toBe('0 B');
    expect(formatBytes(Number.NaN)).toBe('0 B');
  });
});

describe('formatDuration', () => {
  it.each([
    [0, '0:00'],
    [5_000, '0:05'],
    [65_000, '1:05'],
    [3_600_000, '1:00:00'],
    [3_725_000, '1:02:05'],
  ])('formatDuration(%i) = %s', (input, expected) => {
    expect(formatDuration(input)).toBe(expected);
  });

  it('xử lý giá trị không hợp lệ mà không throw', () => {
    expect(formatDuration(-100)).toBe('0:00');
    expect(formatDuration(Number.NaN)).toBe('0:00');
  });
});
