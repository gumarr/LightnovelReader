import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { attachPlayer, detachPlayer, usePlayerStore } from '@/stores/player-store';
import { SEEK_STEP_MS, usePlayerShortcuts } from './usePlayerShortcuts';
import type { AudioSink } from './audio-element';

/**
 * Phím tắt của player.
 *
 * Hai nhóm phép kiểm, và nhóm thứ hai mới là nhóm hay hỏng: phím tắt gắn ở
 * `window` nên nó **cướp phím của cả app** nếu không loại trừ đúng chỗ. Space
 * trong ô nhập phải ra dấu cách, Space trên một nút phải bấm nút đó.
 */

const Harness = (): JSX.Element => {
  usePlayerShortcuts();
  return (
    <div>
      <input data-testid="field" />
      <textarea data-testid="area" />
      <div contentEditable suppressContentEditableWarning data-testid="rich">
        <span data-testid="rich-child">chữ trong vùng soạn</span>
      </div>
      {/* `contenteditable="false"` KHÔNG phải chỗ gõ chữ */}
      <div contentEditable={false} data-testid="not-rich" />
      <button type="button" data-testid="btn">
        nút
      </button>
    </div>
  );
};

/** Sink giả — chỉ cần `positionMs` để kiểm ←/→ tua tương đối */
const fakeSink = (positionMs: number): AudioSink => ({
  play: vi.fn(async () => undefined),
  resume: vi.fn(async () => undefined),
  pause: vi.fn(),
  positionMs: () => positionMs,
  seek: vi.fn(),
  setRate: vi.fn(),
  dispose: vi.fn(),
});

const actions = () => ({
  toggle: vi.fn(async () => undefined),
  next: vi.fn(async () => undefined),
  previous: vi.fn(async () => undefined),
  seek: vi.fn(),
  setRate: vi.fn(async () => undefined),
});

beforeEach(() => {
  detachPlayer();
  usePlayerStore.setState({ state: 'playing', segmentId: 'a', playbackRate: 1 });
});

describe('phím điều khiển', () => {
  it('Space bật/tắt phát', () => {
    const spy = actions();
    usePlayerStore.setState(spy);
    render(<Harness />);

    fireEvent.keyDown(window, { key: ' ' });
    expect(spy.toggle).toHaveBeenCalledOnce();
  });

  it('J lùi đoạn, K tới đoạn', () => {
    const spy = actions();
    usePlayerStore.setState(spy);
    render(<Harness />);

    fireEvent.keyDown(window, { key: 'j' });
    fireEvent.keyDown(window, { key: 'k' });

    expect(spy.previous).toHaveBeenCalledOnce();
    expect(spy.next).toHaveBeenCalledOnce();
  });

  it('chữ hoa cũng ăn — user có thể đang bật Caps Lock', () => {
    const spy = actions();
    usePlayerStore.setState(spy);
    render(<Harness />);

    fireEvent.keyDown(window, { key: 'J' });
    fireEvent.keyDown(window, { key: 'K' });

    expect(spy.previous).toHaveBeenCalledOnce();
    expect(spy.next).toHaveBeenCalledOnce();
  });

  it('←/→ tua TRONG đoạn theo vị trí hiện tại, không nhảy đoạn', () => {
    const spy = actions();
    usePlayerStore.setState(spy);
    // Đoạn ~10s: tua 5s là nửa câu, còn nhảy đoạn là bước quá thô
    attachPlayer({
      sink: fakeSink(6000),
      preloader: { hold: vi.fn(), take: vi.fn(), clear: vi.fn() },
      getSegments: () => [],
      canGenerate: () => true,
      onSegmentChanged: vi.fn(),
      fetchAudio: vi.fn(async () => undefined),
      enqueueUrgent: vi.fn(async () => undefined),
    });
    render(<Harness />);

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(spy.seek).toHaveBeenCalledWith(6000 + SEEK_STEP_MS);

    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(spy.seek).toHaveBeenCalledWith(6000 - SEEK_STEP_MS);

    // Và tuyệt đối không nhảy đoạn
    expect(spy.next).not.toHaveBeenCalled();
    expect(spy.previous).not.toHaveBeenCalled();
  });

  it('← không tua về số âm khi đang ở đầu đoạn', () => {
    const spy = actions();
    usePlayerStore.setState(spy);
    attachPlayer({
      sink: fakeSink(1000),
      preloader: { hold: vi.fn(), take: vi.fn(), clear: vi.fn() },
      getSegments: () => [],
      canGenerate: () => true,
      onSegmentChanged: vi.fn(),
      fetchAudio: vi.fn(async () => undefined),
      enqueueUrgent: vi.fn(async () => undefined),
    });
    render(<Harness />);

    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(spy.seek).toHaveBeenCalledWith(0);
  });

  it('[ và ] đổi tốc độ theo mốc', () => {
    const spy = actions();
    usePlayerStore.setState({ ...spy, playbackRate: 2 });
    render(<Harness />);

    fireEvent.keyDown(window, { key: ']' });
    expect(spy.setRate).toHaveBeenCalledWith(2.5);

    fireEvent.keyDown(window, { key: '[' });
    expect(spy.setRate).toHaveBeenCalledWith(1.75);
  });
});

describe('KHÔNG cướp phím của chỗ khác', () => {
  it.each([
    ['ô nhập', 'field'],
    ['vùng soạn nhiều dòng', 'area'],
    ['vùng contenteditable', 'rich'],
  ])('user đang gõ trong %s thì Space ra dấu cách, không tạm dừng nhạc', (_label, testId) => {
    const spy = actions();
    usePlayerStore.setState(spy);
    render(<Harness />);

    fireEvent.keyDown(screen.getByTestId(testId), { key: ' ', bubbles: true });
    expect(spy.toggle).not.toHaveBeenCalled();
  });

  it('tiêu điểm ở thẻ con BÊN TRONG vùng soạn thảo cũng được trả phím', () => {
    const spy = actions();
    usePlayerStore.setState(spy);
    render(<Harness />);

    fireEvent.keyDown(screen.getByTestId('rich-child'), { key: ' ', bubbles: true });
    expect(spy.toggle).not.toHaveBeenCalled();
  });

  it('contenteditable="false" không phải chỗ gõ chữ — phím tắt vẫn ăn', () => {
    const spy = actions();
    usePlayerStore.setState(spy);
    render(<Harness />);

    fireEvent.keyDown(screen.getByTestId('not-rich'), { key: ' ', bubbles: true });
    expect(spy.toggle).toHaveBeenCalledOnce();
  });

  it('gõ chữ "j" trong ô nhập không nhảy đoạn', () => {
    const spy = actions();
    usePlayerStore.setState(spy);
    render(<Harness />);

    fireEvent.keyDown(screen.getByTestId('field'), { key: 'j', bubbles: true });
    expect(spy.previous).not.toHaveBeenCalled();
  });

  it('Space trên nút đang có tiêu điểm thuộc về nút đó, không phải player', () => {
    const spy = actions();
    usePlayerStore.setState(spy);
    render(<Harness />);

    // Đây là thao tác bàn phím chuẩn của web; cướp nó là làm hỏng cả app
    fireEvent.keyDown(screen.getByTestId('btn'), { key: ' ', bubbles: true });
    expect(spy.toggle).not.toHaveBeenCalled();
  });

  it('nhưng J/K trên nút vẫn ăn — không phải phím kích hoạt nút', () => {
    const spy = actions();
    usePlayerStore.setState(spy);
    render(<Harness />);

    fireEvent.keyDown(screen.getByTestId('btn'), { key: 'k', bubbles: true });
    expect(spy.next).toHaveBeenCalledOnce();
  });

  it.each([
    ['Ctrl', { ctrlKey: true }],
    ['Alt', { altKey: true }],
    ['Meta', { metaKey: true }],
  ])('tổ hợp có %s thuộc về app/OS, player không đụng', (_label, modifier) => {
    const spy = actions();
    usePlayerStore.setState(spy);
    render(<Harness />);

    fireEvent.keyDown(window, { key: ' ', ...modifier });
    expect(spy.toggle).not.toHaveBeenCalled();
  });
});

describe('vòng đời', () => {
  it('gỡ listener khi rời trình đọc — không thì phím tắt sống mãi', () => {
    const spy = actions();
    usePlayerStore.setState(spy);
    const { unmount } = render(<Harness />);

    unmount();
    fireEvent.keyDown(window, { key: ' ' });
    expect(spy.toggle).not.toHaveBeenCalled();
  });
});
