import { useRef } from 'react';
import { usePlayerStore } from '@/stores/player-store';
import { useSegmentProgress } from './useSegmentProgress';

/**
 * Thanh tiến độ **trong một đoạn** (không phải cả chương).
 *
 * Đoạn dài ~10s, nên thanh này trả lời đúng một câu hỏi: "câu đang đọc còn bao
 * lâu nữa". Tiến độ cả chương là việc của danh sách đoạn bên phải, đã có từ
 * P1.6c — vẽ lại ở đây là hai chỗ nói cùng một điều mà dễ lệch nhau.
 *
 * Thanh và đồng hồ **không** đi qua state React: `useSegmentProgress` ghi thẳng
 * vào DOM qua `ref` trong `requestAnimationFrame`. Xem chú thích ở hook đó.
 */

export const SegmentProgress = (): JSX.Element => {
  const durationMs = usePlayerStore((s) => s.durationMs);
  const seek = usePlayerStore((s) => s.seek);

  const fill = useRef<HTMLDivElement>(null);
  const clock = useRef<HTMLSpanElement>(null);
  const track = useRef<HTMLDivElement>(null);

  useSegmentProgress({ fill, clock, track });

  /** Bấm vào thanh → nhảy tới đúng chỗ đó trong đoạn */
  const seekToPointer = (clientX: number): void => {
    const element = track.current;
    if (element === null || durationMs <= 0) return;

    const box = element.getBoundingClientRect();
    if (box.width <= 0) return;

    const ratio = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
    seek(ratio * durationMs);
  };

  // Chưa nạp đoạn nào thì thanh vô nghĩa — nhưng vẫn giữ chỗ để thanh player
  // không nhảy chiều cao lúc bắt đầu phát.
  const ready = durationMs > 0;

  return (
    <div className="flex items-center gap-2">
      <div
        ref={track}
        data-testid="player-progress"
        role="slider"
        aria-label="Vị trí trong đoạn"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={0}
        // Bàn phím dùng ←/→ toàn cục (`usePlayerShortcuts`) nên thanh này không
        // nhận tiêu điểm: thêm một chặng tab mà không cho thêm khả năng nào.
        tabIndex={-1}
        aria-disabled={!ready}
        onPointerDown={(event) => {
          if (!ready) return;
          // Bắt con trỏ để kéo ra ngoài thanh vẫn tiếp tục tua
          event.currentTarget.setPointerCapture(event.pointerId);
          seekToPointer(event.clientX);
        }}
        onPointerMove={(event) => {
          // `buttons === 1` = đang giữ chuột trái; di chuột không giữ thì bỏ qua
          if (!ready || event.buttons !== 1) return;
          seekToPointer(event.clientX);
        }}
        className={
          ready
            ? 'group relative h-1.5 min-w-0 flex-1 cursor-pointer rounded-full bg-bg-subtle'
            : 'relative h-1.5 min-w-0 flex-1 rounded-full bg-bg-subtle'
        }
      >
        <div
          ref={fill}
          data-testid="player-progress-fill"
          // `width` do `rAF` ghi; giá trị đầu là 0 để lần vẽ đầu không giật
          style={{ width: '0%' }}
          className="h-full rounded-full bg-accent"
        />
      </div>

      <span
        ref={clock}
        data-testid="player-clock"
        className="shrink-0 tabular-nums text-[11px] text-fg-muted"
      >
        0:00 / 0:00
      </span>
    </div>
  );
};
