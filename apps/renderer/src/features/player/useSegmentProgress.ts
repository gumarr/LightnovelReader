import { useEffect, useRef, type RefObject } from 'react';
import { playerPositionMs, usePlayerStore } from '@/stores/player-store';
import { formatClock, positionPercent } from './format';

/**
 * Vẽ vị trí phát trong đoạn — thanh chạy + đồng hồ — bằng `requestAnimationFrame`
 * ghi **thẳng vào DOM**, không qua state React.
 *
 * Đây là luật của CLAUDE.md ("không re-render mỗi frame"), và ở đây nó không
 * phải chuyện lý thuyết: `ReaderScreen` bọc cả PdfViewer lẫn danh sách đoạn, nên
 * một lượt re-render 60 lần/giây kéo theo cả cây đó. Vị trí phát vì thế **không**
 * nằm trong `player-store` (xem `playerPositionMs`).
 *
 * Cùng khuôn mẫu mà P3.4 sẽ dùng để highlight từng từ: đọc vị trí trong `rAF`,
 * so với giá trị lần trước, chỉ đụng DOM khi thật sự khác.
 */

export type SegmentProgressRefs = {
  /** Thanh chạy — hook chỉ đổi `style.width` */
  fill: RefObject<HTMLDivElement>;
  /** Ô chữ `0:04 / 0:11` */
  clock: RefObject<HTMLSpanElement>;
  /** Vùng bấm — hook đặt `aria-valuenow`/`aria-valuetext` cho screen reader */
  track: RefObject<HTMLDivElement>;
};

export const useSegmentProgress = ({ fill, clock, track }: SegmentProgressRefs): void => {
  const state = usePlayerStore((s) => s.state);
  const durationMs = usePlayerStore((s) => s.durationMs);
  const segmentId = usePlayerStore((s) => s.segmentId);

  /**
   * Giá trị đã ghi ra DOM lần gần nhất.
   *
   * Không có nó thì mỗi khung hình đều ghi `style.width` và `textContent` dù
   * chữ số không đổi — 60 lần/giây ghi đè cùng một chuỗi, và mỗi lần ghi
   * `textContent` là một lần trình duyệt tính lại layout của ô đó.
   */
  const painted = useRef({ percent: -1, label: '' });

  useEffect(() => {
    // Đổi đoạn thì buộc vẽ lại kể cả khi con số tình cờ trùng
    painted.current = { percent: -1, label: '' };
  }, [segmentId]);

  useEffect(() => {
    const paint = (): void => {
      const positionMs = playerPositionMs();

      // Làm tròn tới 0.1% mới ghi: mắt không thấy nổi mức nhỏ hơn, mà mỗi lần
      // đổi `style.width` là một lượt tính lại layout.
      const percent = Math.round(positionPercent(positionMs, durationMs) * 10) / 10;
      if (percent !== painted.current.percent) {
        painted.current.percent = percent;
        if (fill.current !== null) fill.current.style.width = `${String(percent)}%`;
        // Screen reader đọc theo giá trị này, không đọc được thanh màu
        track.current?.setAttribute('aria-valuenow', String(Math.round(percent)));
      }

      // Đồng hồ chỉ đổi mỗi giây — `formatClock` cắt tới giây nên 59 khung hình
      // trong số 60 cho ra đúng chuỗi cũ và bị chặn ngay tại đây.
      const label = `${formatClock(positionMs)} / ${formatClock(durationMs)}`;
      if (label !== painted.current.label) {
        painted.current.label = label;
        if (clock.current !== null) clock.current.textContent = label;
        track.current?.setAttribute('aria-valuetext', label);
      }
    };

    // Vẽ ngay một lần: lúc tạm dừng thì vòng `rAF` không chạy, mà thanh vẫn phải
    // hiện đúng chỗ đang dừng chứ không phải chỗ của đoạn trước.
    paint();

    // Chỉ quay vòng khi đang phát. `paused`/`waiting`/`idle` thì vị trí đứng yên,
    // chạy `rAF` lúc đó là đốt pin để vẽ lại đúng một hình.
    if (state !== 'playing') return;

    let handle = requestAnimationFrame(function loop() {
      paint();
      handle = requestAnimationFrame(loop);
    });

    return () => {
      cancelAnimationFrame(handle);
    };
  }, [state, durationMs, segmentId, fill, clock, track]);
};
