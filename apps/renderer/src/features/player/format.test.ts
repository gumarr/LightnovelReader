import { describe, expect, it } from 'vitest';
import { PLAYBACK_RATE_MAX, PLAYBACK_RATE_MIN } from '@ln/shared';
import type { SkippedSegment } from '@/stores/player-store';
import {
  clampRate,
  formatClock,
  PLAYBACK_RATE_STEPS,
  playButtonLabel,
  playerStateLabel,
  positionPercent,
  rateLabel,
  skippedSummary,
  stepRate,
} from './format.js';

describe('playButtonLabel', () => {
  it('nói đúng việc nút sẽ làm ở từng trạng thái', () => {
    expect(playButtonLabel('idle')).toBe('Phát');
    expect(playButtonLabel('playing')).toBe('Tạm dừng');
    expect(playButtonLabel('paused')).toBe('Phát tiếp');
    expect(playButtonLabel('waiting')).toContain('dừng chờ');
  });
});

describe('playerStateLabel', () => {
  it('waiting nói rõ đang tạo audio, không để user tưởng treo', () => {
    expect(playerStateLabel('waiting')).toBe('Đang tạo audio…');
  });

  it('mỗi trạng thái một nhãn riêng', () => {
    const labels = (['idle', 'playing', 'paused', 'waiting'] as const).map(playerStateLabel);
    expect(new Set(labels).size).toBe(4);
  });
});

describe('skippedSummary', () => {
  const skip = (id: string): SkippedSegment => ({ segmentId: id, index: 0, reason: 'lỗi' });

  it('chưa bỏ đoạn nào thì không hiện gì', () => {
    expect(skippedSummary([])).toBeUndefined();
  });

  it('gộp thành một dòng chứ không liệt kê từng đoạn', () => {
    const many = Array.from({ length: 30 }, (_, i) => skip(`s${String(i)}`));
    const summary = skippedSummary(many);

    expect(summary).toBe('Đã bỏ qua 30 đoạn không phát được');
    expect(summary).not.toContain('s0');
  });

  it('một đoạn cũng báo', () => {
    expect(skippedSummary([skip('a')])).toBe('Đã bỏ qua 1 đoạn không phát được');
  });
});

describe('rateLabel', () => {
  it('bỏ số 0 thừa', () => {
    expect(rateLabel(1)).toBe('1×');
    expect(rateLabel(1.5)).toBe('1.5×');
    expect(rateLabel(0.75)).toBe('0.75×');
    expect(rateLabel(2)).toBe('2×');
  });
});

describe('PLAYBACK_RATE_STEPS', () => {
  it('mọi mốc nằm trong khoảng hợp lệ của AppSettings', () => {
    for (const rate of PLAYBACK_RATE_STEPS) {
      expect(rate).toBeGreaterThanOrEqual(PLAYBACK_RATE_MIN);
      expect(rate).toBeLessThanOrEqual(PLAYBACK_RATE_MAX);
    }
  });

  it('có mốc 1× để quay về tốc độ thường', () => {
    expect(PLAYBACK_RATE_STEPS).toContain(1);
  });

  it('tăng dần, không trùng', () => {
    const sorted = [...PLAYBACK_RATE_STEPS].sort((a, b) => a - b);
    expect([...PLAYBACK_RATE_STEPS]).toEqual(sorted);
    expect(new Set(PLAYBACK_RATE_STEPS).size).toBe(PLAYBACK_RATE_STEPS.length);
  });

  it('có mốc nhanh 2.5× và 3× (user yêu cầu ở P3.3)', () => {
    expect(PLAYBACK_RATE_STEPS).toContain(2.5);
    expect(PLAYBACK_RATE_STEPS).toContain(3);
  });

  it('mốc cao nhất đúng bằng trần — không có mốc bấm vào là bị kẹp', () => {
    const highest = PLAYBACK_RATE_STEPS[PLAYBACK_RATE_STEPS.length - 1];
    expect(highest).toBe(PLAYBACK_RATE_MAX);
  });
});

describe('stepRate — đi từng mốc bằng phím tắt', () => {
  it('đi tới và đi lui đúng một mốc', () => {
    expect(stepRate(1, 1)).toBe(1.25);
    expect(stepRate(1.25, -1)).toBe(1);
    expect(stepRate(2, 1)).toBe(2.5);
    expect(stepRate(2.5, 1)).toBe(3);
  });

  it('đứng yên ở hai đầu thay vì vòng lại', () => {
    // Vòng từ 3× về 0.75× là cú nhảy tốc độ nghe rất chói khi đang phát
    expect(stepRate(3, 1)).toBe(3);
    expect(stepRate(0.75, -1)).toBe(0.75);
  });

  it('tốc độ lạ (settings cũ) thì bắt lấy mốc gần nhất rồi mới đi', () => {
    // 1.4 gần 1.5 nhất → lui về 1.25, tới lên 1.75
    expect(stepRate(1.4, -1)).toBe(1.25);
    expect(stepRate(1.4, 1)).toBe(1.75);
  });
});

describe('formatClock', () => {
  it('dạng m:ss, giây luôn hai chữ số', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(4_000)).toBe('0:04');
    expect(formatClock(11_500)).toBe('0:11');
    expect(formatClock(65_000)).toBe('1:05');
  });

  it('không vỡ với NaN — `element.duration` là NaN trước khi nạp metadata', () => {
    expect(formatClock(Number.NaN)).toBe('0:00');
    expect(formatClock(Number.POSITIVE_INFINITY)).toBe('0:00');
    expect(formatClock(-5)).toBe('0:00');
  });

  it('phút vượt 59 thì tràn chứ không cắt mất', () => {
    expect(formatClock(3_663_000)).toBe('61:03');
  });
});

describe('clampRate', () => {
  it('kẹp trong 0.5–2.0', () => {
    expect(clampRate(9)).toBe(PLAYBACK_RATE_MAX);
    expect(clampRate(0.01)).toBe(PLAYBACK_RATE_MIN);
    expect(clampRate(1.25)).toBe(1.25);
  });
});

describe('positionPercent', () => {
  it('tính đúng phần trăm', () => {
    expect(positionPercent(500, 1000)).toBe(50);
    expect(positionPercent(0, 1000)).toBe(0);
  });

  it('kẹp ở 100 khi currentTime vượt durationMs vài ms cuối file', () => {
    expect(positionPercent(1050, 1000)).toBe(100);
  });

  it('durationMs bằng 0 trả 0, không chia cho 0', () => {
    expect(positionPercent(500, 0)).toBe(0);
    expect(positionPercent(500, -1)).toBe(0);
  });

  it('vị trí âm kẹp về 0', () => {
    expect(positionPercent(-10, 1000)).toBe(0);
  });
});
