import { useEffect, useRef } from 'react';
import type { Segment } from '@ln/shared';
import { JOB_PRIORITY_URGENT } from '@ln/shared';
import { attachPlayer, detachPlayer, usePlayerStore } from '@/stores/player-store';
import { createAudioPreloader, createAudioSink } from './audio-element';
import { usePlayerShortcuts } from './usePlayerShortcuts';

/**
 * Nối máy trạng thái player với thế giới thật: một thẻ `<audio>` và `window.api`.
 *
 * Tách khỏi `ReaderScreen` vì màn đó đã 259 dòng — CLAUDE.md bảo tách ở 200 —
 * và vì đây là phần **duy nhất** cần vòng đời: thẻ audio phải được dựng một lần,
 * Blob URL phải được nhả khi rời trình đọc, listener phải được gỡ.
 *
 * Thẻ `<audio>` dựng bằng `document.createElement` chứ không render qua JSX: nó
 * không hiện gì trên màn hình, mà đưa vào cây React thì mỗi lần re-render lại có
 * nguy cơ React thay thẻ và cắt ngang audio đang phát. Vẫn **gắn vào**
 * `document.body` (ẩn) để `pnpm ui-check` dò được — xem chú thích ở chỗ gắn.
 */

export type UsePlayerOptions = {
  /** Segment của chương đang mở, theo thứ tự đọc */
  segments: readonly Segment[];
  /** Đã chọn giọng đọc chưa — chưa thì player không xếp hàng đợi, chỉ bỏ qua */
  canGenerate: boolean;
  /** Cuộn viewer + tô đúng đoạn đang phát */
  onSegmentChanged: (segmentId: string) => void;
  /**
   * Tốc độ đã lưu từ phiên trước. `undefined` khi settings chưa nạp xong —
   * player giữ 1× rồi áp lại khi có.
   */
  storedRate?: number;
  /** Ghi tốc độ user vừa chọn xuống settings */
  onRateChanged?: (rate: number) => void;
};

export const usePlayer = ({
  segments,
  canGenerate,
  onSegmentChanged,
  storedRate,
  onRateChanged,
}: UsePlayerOptions): void => {
  /**
   * Tham chiếu tới dữ liệu mới nhất.
   *
   * `attachPlayer` chỉ chạy **một lần**; nếu đóng gói `segments` thẳng vào đó thì
   * player sẽ nhìn mãi danh sách của lần render đầu — đổi chương xong là nó vẫn
   * phát theo chương cũ. Đọc qua `ref` thì luôn thấy bản mới mà không phải dựng
   * lại thẻ audio (dựng lại là cắt ngang tiếng đang phát).
   */
  const latest = useRef({ segments, canGenerate, onSegmentChanged, onRateChanged });
  latest.current = { segments, canGenerate, onSegmentChanged, onRateChanged };

  useEffect(() => {
    const element = document.createElement('audio');
    // Không `autoplay`: mọi lượt phát đều do máy trạng thái quyết định.
    element.preload = 'auto';
    /*
      Gắn vào DOM dù thẻ không hiện gì.

      Thẻ audio rời (detached) vẫn phát được, nên P3.2 để nó ngoài cây. Nhưng
      như thế thì **không kiểm được từ ngoài**: `pnpm ui-check` dò bằng
      `document.querySelector('audio')` và không thấy gì, nên phép kiểm
      "playbackRate tới được thẻ audio thật" âm thầm đo một thẻ `new Audio()`
      nó tự tạo — tức là luôn xanh, kể cả khi chuỗi store → sink → thẻ đứt.

      `data-testid` để dò cho chắc chắn, không phải bắt được thẻ audio nào khác.
    */
    element.dataset.testid = 'player-audio';
    element.hidden = true;
    document.body.appendChild(element);

    const store = usePlayerStore.getState();

    const sink = createAudioSink(element, {
      onEnded: () => {
        void usePlayerStore.getState().handleEnded();
      },
      onError: (message) => {
        void usePlayerStore.getState().handleAudioError(message);
      },
    });

    attachPlayer({
      sink,
      preloader: createAudioPreloader(),
      getSegments: () => latest.current.segments,
      canGenerate: () => latest.current.canGenerate,
      onSegmentChanged: (id) => latest.current.onSegmentChanged(id),

      fetchAudio: async (segmentId) => {
        const result = await window.api.reader.getSegmentAudio(segmentId);
        // `NOT_FOUND` (chưa generate, hoặc file vừa bị xoá) trả `undefined` —
        // player coi đó là tín hiệu bỏ qua chứ không phải lỗi. Xem PROGRESS 4.51.
        return result.ok ? result.data : undefined;
      },

      enqueueUrgent: async (segmentIds) => {
        // plan.md: "segment sắp phát nhảy đầu hàng đợi". Main chỉ **nâng**
        // priority của job đã có chứ không tạo trùng, nên gọi lại là vô hại.
        await window.api.queue.enqueueSegments({
          segmentIds,
          priority: JOB_PRIORITY_URGENT,
        });
      },

      persistRate: (rate) => latest.current.onRateChanged?.(rate),
    });

    // Áp lại tốc độ đang giữ trong store — thẻ audio vừa dựng mặc định 1×
    sink.setRate(store.playbackRate);

    return () => {
      // Thứ tự quan trọng: `reset` gọi `sink.dispose()` để nhả Blob URL, nên
      // phải chạy **trước** khi bỏ deps — sau đó thì không còn sink để gọi.
      usePlayerStore.getState().reset();
      detachPlayer();
      // Gỡ khỏi DOM: giờ thẻ nằm trong `document.body` nên mỗi lần mở trình đọc
      // mà không gỡ là bỏ lại một thẻ audio giữ nguyên bộ đệm giải mã.
      element.remove();
    };
  }, []);

  /**
   * Áp tốc độ đã lưu, **một lần**, khi settings nạp xong.
   *
   * Không gộp vào effect dựng player ở trên: effect đó chạy đúng một lần lúc mở
   * trình đọc, mà `settings` thường về sau đó một nhịp — gộp vào là mãi mãi 1×.
   *
   * `applied` chặn việc áp lại: sau lần đầu, nguồn sự thật là store (user vừa
   * bấm). Không có nó thì mỗi lần `settings` đổi vì lý do khác (đổi theme, đổi
   * thư mục audio) sẽ kéo tốc độ về giá trị đã lưu, đè lên thứ user vừa chọn.
   */
  const applied = useRef(false);
  useEffect(() => {
    if (applied.current || storedRate === undefined) return;
    applied.current = true;
    usePlayerStore.getState().applyStoredRate(storedRate);
  }, [storedRate]);

  usePlayerShortcuts();
};
