import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { attachPlayer, detachPlayer, usePlayerStore } from '@/stores/player-store';
import { SegmentProgress } from './SegmentProgress';
import type { AudioSink } from './audio-element';

/**
 * Thanh tiến độ trong đoạn.
 *
 * Phép kiểm quan trọng nhất **không** phải "thanh có đúng độ dài" mà là **thanh
 * chạy mà không re-render React**: CLAUDE.md cấm re-render mỗi frame, và
 * `ReaderScreen` bọc cả PdfViewer nên vi phạm ở đây kéo theo cả cây.
 */

let position = 0;

const sink = (): AudioSink => ({
  play: vi.fn(async () => undefined),
  resume: vi.fn(async () => undefined),
  pause: vi.fn(),
  positionMs: () => position,
  seek: vi.fn(),
  setRate: vi.fn(),
  dispose: vi.fn(),
});

let currentSink: AudioSink;

const attach = (): void => {
  currentSink = sink();
  attachPlayer({
    sink: currentSink,
    preloader: { hold: vi.fn(), take: vi.fn(), clear: vi.fn() },
    getSegments: () => [],
    canGenerate: () => true,
    onSegmentChanged: vi.fn(),
    fetchAudio: vi.fn(async () => undefined),
    enqueueUrgent: vi.fn(async () => undefined),
  });
};

/** Chạy tay N khung hình `rAF` — jsdom không tự quay vòng */
const advanceFrames = async (count: number): Promise<void> => {
  for (let i = 0; i < count; i += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16);
    });
  }
};

beforeEach(() => {
  vi.useFakeTimers();
  position = 0;
  attach();
  usePlayerStore.setState({ state: 'idle', segmentId: null, durationMs: 0 });
});

afterEach(() => {
  vi.useRealTimers();
  detachPlayer();
});

describe('vẽ vị trí phát', () => {
  it('ghi thẳng width vào DOM, không qua state', async () => {
    usePlayerStore.setState({ state: 'playing', segmentId: 'a', durationMs: 10_000 });
    render(<SegmentProgress />);

    position = 2500;
    await advanceFrames(2);

    expect(screen.getByTestId('player-progress-fill').style.width).toBe('25%');
  });

  it('đồng hồ hiện vị trí / thời lượng', async () => {
    usePlayerStore.setState({ state: 'playing', segmentId: 'a', durationMs: 11_000 });
    render(<SegmentProgress />);

    position = 4000;
    await advanceFrames(2);

    expect(screen.getByTestId('player-clock').textContent).toBe('0:04 / 0:11');
  });

  it('KHÔNG re-render React dù chạy hàng chục khung hình', async () => {
    usePlayerStore.setState({ state: 'playing', segmentId: 'a', durationMs: 10_000 });

    let renders = 0;
    const Counting = (): JSX.Element => {
      renders += 1;
      return <SegmentProgress />;
    };
    render(<Counting />);

    const before = renders;
    for (let i = 1; i <= 30; i += 1) {
      position = i * 100;
      await advanceFrames(1);
    }

    // Thanh đã chạy thật…
    expect(screen.getByTestId('player-progress-fill').style.width).not.toBe('0%');
    // …mà React không dựng lại lần nào. Đây là điều CLAUDE.md bắt buộc.
    expect(renders).toBe(before);
  });

  it('không vẽ lại DOM khi con số không đổi', async () => {
    usePlayerStore.setState({ state: 'playing', segmentId: 'a', durationMs: 10_000 });
    render(<SegmentProgress />);

    position = 3000;
    await advanceFrames(2);

    const fill = screen.getByTestId('player-progress-fill');
    const spy = vi.spyOn(fill.style, 'width', 'set');

    // Vị trí đứng yên (audio tạm dừng ở mức hệ thống) → 10 khung hình sau vẫn
    // đúng chuỗi cũ, không được đụng vào DOM lần nào
    await advanceFrames(10);
    expect(spy).not.toHaveBeenCalled();
  });

  it('dừng vòng rAF khi không phát — không đốt pin lúc tạm dừng', async () => {
    usePlayerStore.setState({ state: 'playing', segmentId: 'a', durationMs: 10_000 });
    const { rerender } = render(<SegmentProgress />);

    act(() => {
      usePlayerStore.setState({ state: 'paused' });
    });
    rerender(<SegmentProgress />);

    const fill = screen.getByTestId('player-progress-fill');
    const spy = vi.spyOn(fill.style, 'width', 'set');

    position = 9000;
    await advanceFrames(10);

    // Vị trí đổi hẳn mà thanh không nhúc nhích → vòng lặp đã dừng thật
    expect(spy).not.toHaveBeenCalled();
  });

  it('vẽ một lần ngay cả khi đang tạm dừng — thanh phải đúng chỗ đang dừng', async () => {
    position = 5000;
    usePlayerStore.setState({ state: 'paused', segmentId: 'a', durationMs: 10_000 });
    render(<SegmentProgress />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByTestId('player-progress-fill').style.width).toBe('50%');
  });
});

describe('bấm để tua', () => {
  it('chưa nạp đoạn nào thì không tua', () => {
    usePlayerStore.setState({ state: 'idle', durationMs: 0 });
    const seek = vi.fn();
    usePlayerStore.setState({ seek });
    render(<SegmentProgress />);

    const track = screen.getByTestId('player-progress');
    expect(track).toHaveAttribute('aria-disabled', 'true');
  });

  it('phơi vị trí cho screen reader — thanh màu thì đọc không được', async () => {
    usePlayerStore.setState({ state: 'playing', segmentId: 'a', durationMs: 10_000 });
    render(<SegmentProgress />);

    position = 5000;
    await advanceFrames(2);

    const track = screen.getByTestId('player-progress');
    expect(track).toHaveAttribute('role', 'slider');
    expect(track).toHaveAttribute('aria-valuenow', '50');
    expect(track).toHaveAttribute('aria-valuetext', '0:05 / 0:10');
  });

  it('không nhận tiêu điểm tab — ←/→ đã là phím tắt toàn cục', () => {
    usePlayerStore.setState({ state: 'playing', segmentId: 'a', durationMs: 10_000 });
    render(<SegmentProgress />);

    expect(screen.getByTestId('player-progress')).toHaveAttribute('tabindex', '-1');
  });
});
