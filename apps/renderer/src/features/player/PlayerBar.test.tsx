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
  it('đổi giữa icon phát và icon tạm dừng', () => {
    const { rerender } = render(<PlayerBar />);
    // Icon là SVG chứ không phải emoji, nên kiểm bằng `data-playing` — bản P3.2
    // dùng ký tự `▶`/`⏸` và hình dạng do font quyết định, không do mình
    expect(screen.getByTestId('player-toggle')).toHaveAttribute('data-playing', 'false');

    // `setState` của zustand đẩy vào React ngoài vòng render → phải bọc `act`
    act(() => {
      setState({ state: 'playing', segmentId: 'a' });
    });
    rerender(<PlayerBar />);
    expect(screen.getByTestId('player-toggle')).toHaveAttribute('data-playing', 'true');
  });

  it('icon vẽ bằng SVG ăn theo màu chữ, không phải emoji', () => {
    render(<PlayerBar />);

    for (const id of ['player-toggle', 'player-prev', 'player-next']) {
      const svg = screen.getByTestId(id).querySelector('svg');
      expect(svg).not.toBeNull();
      // `currentColor` là thứ khiến icon đổi màu theo theme và theo nền nút.
      // Emoji không làm được điều này — đó là lý do đổi.
      expect(svg?.getAttribute('fill')).toBe('currentColor');
      // Nút đã có `aria-label`; icon đọc thêm là đọc trùng
      expect(svg?.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('không còn ký tự emoji nào trong nút điều khiển', () => {
    render(<PlayerBar />);

    for (const id of ['player-toggle', 'player-prev', 'player-next']) {
      expect(screen.getByTestId(id).textContent).toBe('');
    }
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
  it('nút menu hiện tốc độ đang chọn mà không phải mở menu', () => {
    setState({ playbackRate: 1.5 });
    render(<PlayerBar />);

    expect(screen.getByTestId('player-rate-menu')).toHaveTextContent('1.5×');
  });

  it('mốc chưa hiện cho tới khi mở menu', () => {
    render(<PlayerBar />);
    expect(screen.queryByTestId('player-rate-list')).not.toBeInTheDocument();
  });

  it('mở menu thấy đủ 8 mốc, gồm 2.5× và 3×', async () => {
    render(<PlayerBar />);
    await userEvent.click(screen.getByTestId('player-rate-menu'));

    for (const rate of ['0.75', '1', '1.25', '1.5', '1.75', '2', '2.5', '3']) {
      expect(screen.getByTestId(`player-rate-${rate}`)).toBeEnabled();
    }
  });

  it('đánh dấu mốc đang chọn', async () => {
    setState({ playbackRate: 2.5 });
    render(<PlayerBar />);
    await userEvent.click(screen.getByTestId('player-rate-menu'));

    expect(screen.getByTestId('player-rate-2.5')).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('player-rate-1')).toHaveAttribute('data-active', 'false');
    // Không chỉ dựa vào màu — người mù màu vẫn phải phân biệt được
    expect(screen.getByTestId('player-rate-2.5')).toHaveAttribute('aria-checked', 'true');
  });

  it('bấm mốc gọi setRate rồi đóng menu', async () => {
    const setRate = vi.fn(async () => undefined);
    usePlayerStore.setState({ setRate });
    render(<PlayerBar />);

    await userEvent.click(screen.getByTestId('player-rate-menu'));
    await userEvent.click(screen.getByTestId('player-rate-3'));

    expect(setRate).toHaveBeenCalledWith(3);
    expect(screen.queryByTestId('player-rate-list')).not.toBeInTheDocument();
  });

  it('bấm ra ngoài thì đóng menu — không dính lại che thanh tiến độ', async () => {
    render(<PlayerBar />);
    await userEvent.click(screen.getByTestId('player-rate-menu'));
    expect(screen.getByTestId('player-rate-list')).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('player-state'));
    expect(screen.queryByTestId('player-rate-list')).not.toBeInTheDocument();
  });

  it('menu mở LÊN — thanh player nằm sát đáy cửa sổ', async () => {
    render(<PlayerBar />);
    await userEvent.click(screen.getByTestId('player-rate-menu'));

    // jsdom không tính layout nên không đo được vị trí thật; kiểm lớp định vị.
    // Vị trí thật do `pnpm ui-check` đo trên Chromium.
    expect(screen.getByTestId('player-rate-list').className).toContain('bottom-full');
  });
});

describe('đường tắt tới màn Giọng đọc', () => {
  it('không hiện gì khi đã chọn giọng', () => {
    render(<PlayerBar voiceReady onOpenVoices={vi.fn()} />);
    expect(screen.queryByTestId('player-no-voice')).not.toBeInTheDocument();
  });

  it('chưa chọn giọng thì nói rõ lý do ngay tại thanh player', () => {
    render(<PlayerBar voiceReady={false} onOpenVoices={vi.fn()} />);
    expect(screen.getByTestId('player-no-voice')).toHaveTextContent('Chưa chọn giọng đọc');
  });

  it('bấm "Chọn giọng" gọi đúng hàm điều hướng', async () => {
    const onOpenVoices = vi.fn();
    render(<PlayerBar voiceReady={false} onOpenVoices={onOpenVoices} />);

    await userEvent.click(screen.getByTestId('player-open-voices'));
    expect(onOpenVoices).toHaveBeenCalledOnce();
  });

  it('không có hàm điều hướng thì vẫn báo, chỉ bỏ nút', () => {
    render(<PlayerBar voiceReady={false} />);

    expect(screen.getByTestId('player-no-voice')).toBeInTheDocument();
    expect(screen.queryByTestId('player-open-voices')).not.toBeInTheDocument();
  });

  it('người gọi không truyền voiceReady thì không đoán bừa là thiếu giọng', () => {
    render(<PlayerBar />);
    expect(screen.queryByTestId('player-no-voice')).not.toBeInTheDocument();
  });
});
