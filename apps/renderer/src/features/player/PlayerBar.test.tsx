import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { usePlayerStore } from '@/stores/player-store';
import { PlayerBar } from './PlayerBar';

/**
 * Thanh điều khiển player.
 *
 * Trọng tâm: **đoạn bỏ qua không được chặn đường**. Nó hiện thành một dòng chữ
 * nhỏ, không phải hộp cảnh báo có nút — user đang nghe và không cần bấm gì.
 */

const setState = (over: Partial<ReturnType<typeof usePlayerStore.getState>> = {}) => {
  usePlayerStore.setState({
    state: 'idle',
    segmentId: null,
    timings: [],
    durationMs: 0,
    playbackRate: 1,
    skipped: [],
    error: null,
    ...over,
  });
};

beforeEach(() => {
  setState();
});

describe('nút phát', () => {
  it('hiện ▶ lúc chưa phát và ⏸ lúc đang phát', () => {
    const { rerender } = render(<PlayerBar />);
    expect(screen.getByTestId('player-toggle')).toHaveTextContent('▶');

    // `setState` của zustand đẩy vào React ngoài vòng render → phải bọc `act`
    act(() => {
      setState({ state: 'playing', segmentId: 'a' });
    });
    rerender(<PlayerBar />);
    expect(screen.getByTestId('player-toggle')).toHaveTextContent('⏸');
  });

  it('nhãn nói đúng việc nút sẽ làm', () => {
    setState({ state: 'playing', segmentId: 'a' });
    render(<PlayerBar />);

    expect(screen.getByTestId('player-toggle')).toHaveAttribute('aria-label', 'Tạm dừng');
  });

  it('bấm gọi toggle', async () => {
    const toggle = vi.fn(async () => undefined);
    usePlayerStore.setState({ toggle });
    render(<PlayerBar />);

    await userEvent.click(screen.getByTestId('player-toggle'));
    expect(toggle).toHaveBeenCalledOnce();
  });
});

describe('đoạn trước / sau', () => {
  it('nút "đoạn trước" tắt khi chưa phát gì', () => {
    render(<PlayerBar />);
    expect(screen.getByTestId('player-prev')).toBeDisabled();
  });

  it('nút "đoạn trước" bật khi đang có đoạn', () => {
    setState({ state: 'playing', segmentId: 'a' });
    render(<PlayerBar />);
    expect(screen.getByTestId('player-prev')).toBeEnabled();
  });

  it('bấm gọi đúng hàm', async () => {
    const next = vi.fn(async () => undefined);
    const previous = vi.fn(async () => undefined);
    setState({ state: 'playing', segmentId: 'a' });
    usePlayerStore.setState({ next, previous });
    render(<PlayerBar />);

    await userEvent.click(screen.getByTestId('player-next'));
    await userEvent.click(screen.getByTestId('player-prev'));

    expect(next).toHaveBeenCalledOnce();
    expect(previous).toHaveBeenCalledOnce();
  });
});

describe('trạng thái', () => {
  it('nói rõ đang tạo audio khi phải chờ', () => {
    setState({ state: 'waiting', segmentId: 'a' });
    render(<PlayerBar />);

    expect(screen.getByTestId('player-state')).toHaveTextContent('Đang tạo audio');
    // Chấm nhấp nháy phân biệt "đang chờ" với "treo"
    expect(screen.getByTestId('player-waiting-dot')).toBeInTheDocument();
  });

  it('không hiện chấm chờ khi đang phát bình thường', () => {
    setState({ state: 'playing', segmentId: 'a' });
    render(<PlayerBar />);

    expect(screen.queryByTestId('player-waiting-dot')).not.toBeInTheDocument();
  });

  it('phơi trạng thái qua data-state để kiểm được ở app thật', () => {
    setState({ state: 'playing', segmentId: 'a' });
    render(<PlayerBar />);

    expect(screen.getByTestId('player-bar')).toHaveAttribute('data-state', 'playing');
  });
});

describe('đoạn bị bỏ qua — thông tin, KHÔNG chặn đường', () => {
  it('không hiện gì khi chưa bỏ đoạn nào', () => {
    render(<PlayerBar />);
    expect(screen.queryByTestId('player-skipped')).not.toBeInTheDocument();
  });

  it('hiện một dòng gộp, không phải hộp cảnh báo có nút', () => {
    setState({
      state: 'playing',
      segmentId: 'c',
      skipped: [
        { segmentId: 'a', index: 0, reason: 'đoạn lỗi' },
        { segmentId: 'b', index: 1, reason: 'đoạn không có chữ để đọc' },
      ],
    });
    render(<PlayerBar />);

    const row = screen.getByTestId('player-skipped');
    expect(row).toHaveTextContent('Đã bỏ qua 2 đoạn không phát được');
    // Không có nút nào trong dòng này — không bắt user xử lý gì
    expect(row.querySelector('button')).toBeNull();
    // Và không phải vùng cảnh báo chặn đọc
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('vẫn hiện nút phát bình thường dù đã bỏ qua nhiều đoạn', () => {
    setState({
      state: 'playing',
      segmentId: 'z',
      skipped: Array.from({ length: 50 }, (_, i) => ({
        segmentId: `s${String(i)}`,
        index: i,
        reason: 'đoạn lỗi',
      })),
    });
    render(<PlayerBar />);

    expect(screen.getByTestId('player-toggle')).toBeEnabled();
    expect(screen.getByTestId('player-bar')).toHaveAttribute('data-state', 'playing');
  });
});

describe('tốc độ', () => {
  it('hiện đủ mốc tốc độ và đánh dấu cái đang chọn', () => {
    setState({ playbackRate: 1.5 });
    render(<PlayerBar />);

    expect(screen.getByTestId('player-rate-1.5')).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('player-rate-1')).toHaveAttribute('data-active', 'false');
  });

  it('bấm mốc gọi setRate với đúng giá trị', async () => {
    const setRate = vi.fn(async () => undefined);
    usePlayerStore.setState({ setRate });
    render(<PlayerBar />);

    await userEvent.click(screen.getByTestId('player-rate-1.5'));
    expect(setRate).toHaveBeenCalledWith(1.5);
  });

  it('mọi mốc đều bấm được', () => {
    render(<PlayerBar />);
    for (const rate of ['0.75', '1', '1.25', '1.5', '1.75', '2']) {
      expect(screen.getByTestId(`player-rate-${rate}`)).toBeEnabled();
    }
  });
});
