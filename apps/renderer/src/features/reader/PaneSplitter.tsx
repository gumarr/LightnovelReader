import { useRef } from 'react';
import { VIEWER_PANE_RATIO_MAX, VIEWER_PANE_RATIO_MIN } from '@ln/shared';

/**
 * Thanh kéo chỉnh tỉ lệ giữa viewer và phụ đề.
 *
 * Kéo bằng con trỏ **không** đi qua settings mỗi khung hình: `onDrag` chỉ đổi
 * state cục bộ của `ReaderScreen`, còn `onCommit` (nhả chuột) mới ghi xuống
 * SQLite. Ghi mỗi khung hình là 60 lượt IPC + 60 lượt ghi đĩa mỗi giây cho một
 * con số user vẫn đang chỉnh dở.
 */

export type PaneSplitterProps = {
  /** Tỉ lệ hiện tại của pane trên (viewer), trong khoảng min–max */
  ratio: number;
  /** Kéo tới đâu báo tới đó — nơi gọi chỉ đổi state, không ghi đĩa */
  onDrag: (ratio: number) => void;
  /** Nhả chuột / rời bàn phím: chốt giá trị, ghi xuống settings */
  onCommit: (ratio: number) => void;
};

/** Một nhịp bàn phím. 2% cho cảm giác chỉnh được mà không phải giữ phím lâu. */
const KEYBOARD_STEP = 0.02;

const clamp = (value: number): number =>
  Math.min(VIEWER_PANE_RATIO_MAX, Math.max(VIEWER_PANE_RATIO_MIN, value));

export const PaneSplitter = ({ ratio, onDrag, onCommit }: PaneSplitterProps): JSX.Element => {
  const bar = useRef<HTMLDivElement>(null);

  /** Tỉ lệ suy từ vị trí con trỏ, đo trên phần tử cha (khung chứa cả hai pane) */
  const ratioAt = (clientY: number): number | undefined => {
    const parent = bar.current?.parentElement;
    if (parent === undefined || parent === null) return undefined;

    const box = parent.getBoundingClientRect();
    if (box.height <= 0) return undefined;

    return clamp((clientY - box.top) / box.height);
  };

  const nudge = (delta: number): void => {
    const next = clamp(ratio + delta);
    onDrag(next);
    // Bàn phím không có "nhả chuột" — mỗi nhịp là một lần chốt. Chấp nhận được
    // vì user bấm vài lần rồi thôi, khác hẳn 60 lần/giây của kéo chuột.
    onCommit(next);
  };

  return (
    <div
      ref={bar}
      role="separator"
      aria-label="Chỉnh tỉ lệ trang đọc và phụ đề"
      aria-orientation="horizontal"
      aria-valuemin={Math.round(VIEWER_PANE_RATIO_MIN * 100)}
      aria-valuemax={Math.round(VIEWER_PANE_RATIO_MAX * 100)}
      aria-valuenow={Math.round(ratio * 100)}
      tabIndex={0}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        // Không giữ con trỏ thì đây chỉ là rê chuột ngang qua, không phải kéo.
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const next = ratioAt(event.clientY);
        if (next !== undefined) onDrag(next);
      }}
      onPointerUp={(event) => {
        event.currentTarget.releasePointerCapture(event.pointerId);
        const next = ratioAt(event.clientY);
        onCommit(next ?? ratio);
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          nudge(-KEYBOARD_STEP);
        } else if (event.key === 'ArrowDown') {
          event.preventDefault();
          nudge(KEYBOARD_STEP);
        }
      }}
      data-testid="pane-splitter"
      // `h-1.5` mảnh cho gọn, nhưng `after` nới vùng bắt chuột lên 9px: thanh
      // 6px là quá khó trúng, mà nới thật thì tốn chỗ của cả hai pane.
      className="group relative h-1.5 shrink-0 cursor-row-resize border-y border-border bg-bg-elevated transition-colors after:absolute after:inset-x-0 after:-top-1.5 after:h-[9px] after:content-[''] hover:bg-accent/30 focus-visible:bg-accent/40 focus-visible:outline-none"
    >
      {/* Vạch giữa cho thấy đây là chỗ kéo được, không phải đường kẻ trang trí */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-0.5 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full bg-border group-hover:bg-accent" />
    </div>
  );
};
