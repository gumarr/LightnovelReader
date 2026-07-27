import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VIEWER_PANE_RATIO_MAX, VIEWER_PANE_RATIO_MIN } from '@ln/shared';
import { PaneSplitter } from './PaneSplitter';

/**
 * Thanh kéo chỉnh tỉ lệ viewer / phụ đề.
 *
 * Điều đáng test nhất là **tách `onDrag` khỏi `onCommit`**: kéo chuột bắn ra
 * hàng chục sự kiện mỗi giây, mà mỗi lần `onCommit` là một lượt IPC + ghi
 * SQLite. Lẫn hai đường này thì kéo thanh một cái là ghi đĩa 60 lần/giây.
 */

const setup = (ratio = 0.5) => {
  const onDrag = vi.fn();
  const onCommit = vi.fn();
  render(<PaneSplitter ratio={ratio} onDrag={onDrag} onCommit={onCommit} />);
  return { onDrag, onCommit, bar: screen.getByTestId('pane-splitter') };
};

describe('bàn phím', () => {
  it('mũi tên xuống nới phụ đề, lên thu lại', () => {
    const { onDrag, bar } = setup(0.5);

    bar.focus();
    bar.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(onDrag).toHaveBeenLastCalledWith(0.52);

    bar.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(onDrag).toHaveBeenLastCalledWith(0.48);
  });

  it('bàn phím chốt luôn — không có thao tác "nhả chuột"', () => {
    const { onCommit, bar } = setup(0.5);

    bar.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('không nới quá biên trên', () => {
    const { onDrag, bar } = setup(VIEWER_PANE_RATIO_MAX);
    bar.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(onDrag).toHaveBeenLastCalledWith(VIEWER_PANE_RATIO_MAX);
  });

  it('không thu quá biên dưới', () => {
    const { onDrag, bar } = setup(VIEWER_PANE_RATIO_MIN);
    bar.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(onDrag).toHaveBeenLastCalledWith(VIEWER_PANE_RATIO_MIN);
  });

  it('phím khác không đụng tới tỉ lệ', () => {
    const { onDrag, onCommit, bar } = setup();
    bar.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(onDrag).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe('trợ năng', () => {
  it('khai báo là separator kèm giá trị hiện tại', () => {
    const { bar } = setup(0.66);
    expect(bar.getAttribute('role')).toBe('separator');
    expect(bar.getAttribute('aria-valuenow')).toBe('66');
    expect(bar.getAttribute('aria-valuemin')).toBe('20');
    expect(bar.getAttribute('aria-valuemax')).toBe('80');
  });

  it('nhận được tiêu điểm bàn phím', () => {
    const { bar } = setup();
    expect(bar.getAttribute('tabindex')).toBe('0');
  });
});
