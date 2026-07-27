import { describe, expect, it } from 'vitest';
import { PLAYBACK_RATE_MAX, PLAYBACK_RATE_MIN } from '@ln/shared';
import type { SkippedSegment } from '@/stores/player-store';
import {
  clampRate,
  PLAYBACK_RATE_STEPS,
  playButtonLabel,
  playerStateLabel,
  positionPercent,
  rateLabel,
  skippedSummary,
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
