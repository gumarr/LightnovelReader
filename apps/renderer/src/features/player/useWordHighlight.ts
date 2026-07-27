import { useEffect, useRef, type RefObject } from 'react';
import { wordIndexAt } from '@ln/shared';
import { playerPositionMs, usePlayerStore } from '@/stores/player-store';
import { wordIndexForTiming, type SubtitleWord } from './subtitle';

/**
 * Tô sáng từ đang đọc, ghi **thẳng vào DOM** trong `requestAnimationFrame`.
 *
 * Cùng khuôn mẫu với `useSegmentProgress` và vì cùng một lý do (CLAUDE.md: không
 * re-render mỗi khung hình). Ở đây áp lực còn lớn hơn: một segment có tới ~60
 * từ, mỗi từ là một `<span>`. Cho chỉ số từ vào `useState` thì mỗi khung hình
 * React phải so lại 60 phần tử con — kéo theo cả `ReaderScreen` bên ngoài.
 *
 * Nên hook này chỉ đụng đúng **hai** phần tử mỗi lần đổi từ: bỏ `data-active` ở
 * từ cũ, đặt vào từ mới. Không đọc `children` của container, không tạo mảng mới.
 */

export type WordHighlightRefs = {
  /** Vùng chứa các `<span>` từ. Hook tìm con theo `data-word-index`. */
  container: RefObject<HTMLElement>;
};

export type WordHighlightOptions = WordHighlightRefs & {
  /** Danh sách từ đang vẽ — phải khớp thứ tự với `<span>` trong container */
  words: readonly SubtitleWord[];
  /**
   * Cuộn để từ đang đọc luôn nằm trong tầm nhìn. Tắt khi user vừa cuộn tay —
   * giật màn về chỗ đang phát lúc user đang đọc chỗ khác là rất khó chịu.
   */
  autoScroll: boolean;
};

export const useWordHighlight = ({
  container,
  words,
  autoScroll,
}: WordHighlightOptions): void => {
  const state = usePlayerStore((s) => s.state);
  const timings = usePlayerStore((s) => s.timings);
  const segmentId = usePlayerStore((s) => s.segmentId);

  /** Chỉ số từ đã tô lần gần nhất. `-1` = chưa tô từ nào. */
  const painted = useRef(-1);

  useEffect(() => {
    // Đổi đoạn thì các `<span>` cũ đã bị React thay hết — chỉ số cũ không còn
    // trỏ đúng phần tử nào. Quên nó đi để lượt vẽ sau tô lại từ đầu.
    painted.current = -1;
  }, [segmentId]);

  useEffect(() => {
    const paint = (): void => {
      const root = container.current;
      if (root === null) return;

      // Hai bước tra: vị trí → timing (nhị phân), timing → từ trên màn (giao
      // khoảng). Không gộp được vì `timings` và `words` không tương ứng 1–1 —
      // xem chú thích ở `subtitle.ts`.
      const timingIndex = wordIndexAt(timings, playerPositionMs());
      const next =
        timingIndex === -1 ? -1 : wordIndexForTiming(words, timings[timingIndex]);

      if (next === painted.current) return;

      // `querySelector` theo thuộc tính chứ không `children[i]`: container có
      // thể chèn phần tử khác (khoảng trắng, dấu câu tách riêng) và lúc đó chỉ
      // số con lệch khỏi chỉ số từ.
      const previous = painted.current;
      painted.current = next;

      if (previous !== -1) {
        root
          .querySelector(`[data-word-index="${String(previous)}"]`)
          ?.removeAttribute('data-active');
      }

      if (next === -1) return;

      const element = root.querySelector(`[data-word-index="${String(next)}"]`);
      if (element === null) return;

      element.setAttribute('data-active', 'true');

      if (autoScroll && element instanceof HTMLElement) {
        // `nearest` chứ không `center`: subtitle chỉ cao 3 dòng, kéo về giữa
        // làm chữ nhảy mỗi từ. `nearest` chỉ cuộn khi từ thật sự ra khỏi khung.
        element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    };

    // Vẽ ngay một lượt: lúc tạm dừng vòng `rAF` không chạy, mà từ đang đọc vẫn
    // phải sáng đúng chỗ dừng.
    paint();

    if (state !== 'playing') return;

    let handle = requestAnimationFrame(function loop() {
      paint();
      handle = requestAnimationFrame(loop);
    });

    return () => {
      cancelAnimationFrame(handle);
    };
  }, [state, timings, segmentId, words, autoScroll, container]);
};
