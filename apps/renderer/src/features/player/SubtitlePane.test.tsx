import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { WordTiming } from '@ln/shared';
import { attachPlayer, detachPlayer, usePlayerStore } from '@/stores/player-store';
import { SubtitlePane } from './SubtitlePane';
import type { AudioSink } from './audio-element';

/**
 * Phụ đề tô sáng từng từ.
 *
 * Hai điều phải giữ, đều là luật của CLAUDE.md:
 * - Highlight chạy mà **không** re-render React (60 khung hình/giây × ~60 từ).
 * - Chữ hiện lên là text **gốc**, không phải bản đọc đã phiên âm (P3.5).
 */

let position = 0;
let seeked: number[] = [];

const sink = (): AudioSink => ({
  play: vi.fn(async () => undefined),
  resume: vi.fn(async () => undefined),
  pause: vi.fn(),
  positionMs: () => position,
  seek: vi.fn((ms: number) => {
    seeked.push(ms);
  }),
  setRate: vi.fn(),
  dispose: vi.fn(),
});

const attach = (): void => {
  attachPlayer({
    sink: sink(),
    preloader: { hold: vi.fn(), take: vi.fn(), clear: vi.fn() },
    getSegments: () => [],
    canGenerate: () => true,
    onSegmentChanged: vi.fn(),
    fetchAudio: vi.fn(async () => undefined),
    enqueueUrgent: vi.fn(async () => undefined),
  });
};

const advanceFrames = async (count: number): Promise<void> => {
  for (let i = 0; i < count; i += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16);
    });
  }
};

/** `Chuyến tới Tokyo.` — `Tokyo` đọc thành ba mảnh, cùng trỏ khoảng [11,17) */
const TEXT = 'Chuyến tới Tokyo.';
const TIMINGS: WordTiming[] = [
  { w: 'Chuyến', startMs: 0, endMs: 400, charStart: 0, charEnd: 6 },
  { w: 'tới', startMs: 400, endMs: 700, charStart: 7, charEnd: 10 },
  { w: 'Tô', startMs: 700, endMs: 900, charStart: 11, charEnd: 17 },
  { w: 'ki', startMs: 900, endMs: 1100, charStart: 11, charEnd: 17 },
  { w: 'ô', startMs: 1100, endMs: 1300, charStart: 11, charEnd: 17 },
];

const activeWord = (): string | undefined =>
  screen.getByTestId('subtitle-pane').querySelector('[data-active]')?.textContent ?? undefined;

beforeEach(() => {
  vi.useFakeTimers();
  position = 0;
  seeked = [];
  attach();
  usePlayerStore.setState({ state: 'idle', segmentId: null, timings: [], durationMs: 0 });
});

afterEach(() => {
  vi.useRealTimers();
  detachPlayer();
});

describe('hiển thị', () => {
  it('hiện text gốc, không phải bản đọc đã phiên âm', () => {
    usePlayerStore.setState({ state: 'playing', segmentId: 's1', timings: TIMINGS });
    render(<SubtitlePane text={TEXT} fontSizePx={18} />);

    // `Tokyo` chứ không phải `Tô-ki-ô` — user đang nhìn sách.
    expect(screen.getByRole('button', { name: 'Tokyo.' })).toBeTruthy();
    expect(screen.queryByText('Tô-ki-ô')).toBeNull();
  });

  it('chưa phát gì thì mời bấm phát', () => {
    render(<SubtitlePane text="" fontSizePx={18} />);
    expect(screen.getByText('Bấm phát để xem phụ đề.')).toBeTruthy();
  });

  it('áp đúng cỡ chữ user đặt trong Cài đặt', () => {
    // `subtitleFontSize` nằm trong settings từ Phase 0 nhưng tới P5.3 mới có
    // component nào đọc. Khoá lại đường đó để nó không thành setting chết lần nữa.
    usePlayerStore.setState({ state: 'playing', segmentId: 's1', timings: TIMINGS });
    render(<SubtitlePane text={TEXT} fontSizePx={32} />);

    expect(screen.getByTestId('subtitle-pane').style.fontSize).toBe('32px');
  });
});

describe('tô sáng theo audio', () => {
  it('tô đúng từ đang đọc', async () => {
    usePlayerStore.setState({ state: 'playing', segmentId: 's1', timings: TIMINGS });
    render(<SubtitlePane text={TEXT} fontSizePx={18} />);

    position = 500;
    await advanceFrames(2);
    expect(activeWord()).toBe('tới');
  });

  it('cả ba mảnh của `Tokyo` đều giữ nguyên một từ sáng', async () => {
    // Đây là hệ quả trực tiếp của P3.5. Sai chỗ này thì highlight tắt giữa tên
    // riêng — mà tên riêng thì trang nào cũng có.
    usePlayerStore.setState({ state: 'playing', segmentId: 's1', timings: TIMINGS });
    render(<SubtitlePane text={TEXT} fontSizePx={18} />);

    for (const ms of [750, 950, 1150]) {
      position = ms;
      await advanceFrames(2);
      expect(activeWord()).toBe('Tokyo.');
    }
  });

  it('chỉ một từ sáng tại một thời điểm', async () => {
    usePlayerStore.setState({ state: 'playing', segmentId: 's1', timings: TIMINGS });
    render(<SubtitlePane text={TEXT} fontSizePx={18} />);

    position = 200;
    await advanceFrames(2);
    position = 500;
    await advanceFrames(2);

    expect(screen.getByTestId('subtitle-pane').querySelectorAll('[data-active]')).toHaveLength(1);
  });

  it('KHÔNG re-render React dù chạy hàng chục khung hình', async () => {
    usePlayerStore.setState({ state: 'playing', segmentId: 's1', timings: TIMINGS });

    let renders = 0;
    const Counting = (): JSX.Element => {
      renders += 1;
      return <SubtitlePane text={TEXT} fontSizePx={18} />;
    };
    render(<Counting />);

    const before = renders;
    for (let i = 1; i <= 30; i += 1) {
      position = i * 40;
      await advanceFrames(1);
    }

    // Highlight đã chạy thật…
    expect(activeWord()).toBeTruthy();
    // …mà React không dựng lại lần nào.
    expect(renders).toBe(before);
  });
});

describe('bấm để nhảy tới', () => {
  it('bấm một từ thì tua tới mốc của từ đó', async () => {
    usePlayerStore.setState({ state: 'playing', segmentId: 's1', timings: TIMINGS });
    render(<SubtitlePane text={TEXT} fontSizePx={18} />);

    await act(async () => {
      screen.getByRole('button', { name: 'tới' }).click();
    });

    expect(seeked).toEqual([400]);
  });

  it('bấm vào tên riêng tua tới mảnh đọc đầu tiên', async () => {
    usePlayerStore.setState({ state: 'playing', segmentId: 's1', timings: TIMINGS });
    render(<SubtitlePane text={TEXT} fontSizePx={18} />);

    await act(async () => {
      screen.getByRole('button', { name: 'Tokyo.' }).click();
    });

    // 700 = mốc của `Tô`, không phải của `ki` hay `ô`
    expect(seeked).toEqual([700]);
  });

  it('đoạn chưa có timing thì bấm không tua bừa về đầu', async () => {
    usePlayerStore.setState({ state: 'idle', segmentId: 's1', timings: [] });
    render(<SubtitlePane text={TEXT} fontSizePx={18} />);

    await act(async () => {
      screen.getByRole('button', { name: 'tới' }).click();
    });

    expect(seeked).toEqual([]);
  });
});

describe('đổi đoạn giữa chừng', () => {
  it('đổi đoạn thì highlight bám đoạn mới, không kẹt ở chỉ số cũ', async () => {
    usePlayerStore.setState({ state: 'playing', segmentId: 's1', timings: TIMINGS });
    const { rerender } = render(<SubtitlePane text={TEXT} fontSizePx={18} />);

    position = 1150;
    await advanceFrames(2);
    expect(activeWord()).toBe('Tokyo.');

    // Đoạn mới ngắn hơn: chỉ số 3 của đoạn cũ không còn tồn tại. Không xoá
    // `painted` thì hook tưởng đã tô đúng rồi và không tô gì nữa.
    await act(async () => {
      usePlayerStore.setState({
        segmentId: 's2',
        timings: [{ w: 'Ừ', startMs: 0, endMs: 300, charStart: 0, charEnd: 2 }],
      });
      rerender(<SubtitlePane text="Ừ." fontSizePx={18} />);
    });

    position = 100;
    await advanceFrames(2);
    expect(activeWord()).toBe('Ừ.');
  });

  it('audio chạy quá từ cuối thì tắt highlight, không kẹt sáng', async () => {
    usePlayerStore.setState({ state: 'playing', segmentId: 's1', timings: TIMINGS });
    render(<SubtitlePane text={TEXT} fontSizePx={18} />);

    position = 800;
    await advanceFrames(2);
    expect(activeWord()).toBe('Tokyo.');

    // Quá `endMs` của từ cuối — khoảng lặng đuôi file
    position = 5000;
    await advanceFrames(2);
    expect(activeWord()).toBeUndefined();
  });

  it('tạm dừng vẫn giữ từ đang đọc sáng', async () => {
    usePlayerStore.setState({ state: 'playing', segmentId: 's1', timings: TIMINGS });
    render(<SubtitlePane text={TEXT} fontSizePx={18} />);

    position = 500;
    await advanceFrames(2);

    await act(async () => {
      usePlayerStore.setState({ state: 'paused' });
    });
    await advanceFrames(2);

    // Dừng nhạc mà chữ tắt thì user mất chỗ đang nghe dở
    expect(activeWord()).toBe('tới');
  });
});

describe('sửa cách đọc (P5.2)', () => {
  it('chuột phải vào một từ gọi callback với đúng từ đó', () => {
    const onEditPronunciation = vi.fn();
    render(<SubtitlePane text={TEXT} fontSizePx={18} onEditPronunciation={onEditPronunciation} />);

    const words = screen.getAllByRole('button');
    const tokyo = words.find((b) => b.textContent === 'Tokyo.');
    fireEvent.contextMenu(tokyo!);

    // Gửi text GỐC trên màn hình, không phải bản đọc đã phiên âm — user chọn
    // sửa cái tên họ nhìn thấy trong sách.
    expect(onEditPronunciation).toHaveBeenCalledWith('Tokyo.');
  });

  it('chuột phải chặn menu mặc định của Chromium', () => {
    // Không chặn thì menu hệ thống đè lên hộp thoại vừa mở.
    const onEditPronunciation = vi.fn();
    render(<SubtitlePane text={TEXT} fontSizePx={18} onEditPronunciation={onEditPronunciation} />);

    const word = screen.getAllByRole('button')[0]!;
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    fireEvent(word, event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('không truyền callback thì chuột phải không làm gì', () => {
    // P3.4 dựng pane này khi chưa có tính năng sửa cách đọc — vẫn phải chạy.
    render(<SubtitlePane text={TEXT} fontSizePx={18} />);
    const word = screen.getAllByRole('button')[0]!;
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    fireEvent(word, event);
    expect(event.defaultPrevented).toBe(false);
  });
});
