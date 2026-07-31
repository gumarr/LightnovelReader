import { useMemo, useRef, useState } from 'react';
import { seekMsForChar } from '@ln/shared';
import { usePlayerStore } from '@/stores/player-store';
import { subtitleWords } from './subtitle';
import { useWordHighlight } from './useWordHighlight';

/**
 * Phụ đề của đoạn đang phát, tô sáng từng từ theo audio.
 *
 * Hiện text **gốc** chứ không phải bản đọc: user đang nhìn sách, phụ đề phải
 * khớp mặt chữ trong sách. Sau P3.5 hai bản này khác nhau thật (`Tokyo` đọc
 * thành `Tô-ki-ô`), và cầu nối là `charStart`/`charEnd` đã được quy về text gốc.
 *
 * Không tô màu "đã đọc / chưa đọc" cho từng từ theo thời gian thực: làm thế thì
 * mỗi khung hình phải đụng tới mọi `<span>` đứng trước con trỏ. Chỉ từ **đang
 * đọc** đổi kiểu, đúng hai phần tử mỗi lần — xem `useWordHighlight`.
 */

export type SubtitlePaneProps = {
  /** Text gốc của đoạn đang phát. Rỗng = chưa phát gì. */
  text: string;
  /**
   * Bấm chuột phải vào một từ → mở hộp sửa cách đọc (P5.2, tầng 3).
   *
   * Không bắt buộc: phụ đề vẫn dùng được khi màn hình chứa nó chưa nối tính
   * năng này (test của P3.4 chẳng hạn).
   */
  onEditPronunciation?: (term: string) => void;
};

export const SubtitlePane = ({ text, onEditPronunciation }: SubtitlePaneProps): JSX.Element => {
  const timings = usePlayerStore((s) => s.timings);
  const seek = usePlayerStore((s) => s.seek);
  const state = usePlayerStore((s) => s.state);

  const container = useRef<HTMLParagraphElement>(null);

  /**
   * Tự cuộn theo từ đang đọc, tắt khi user cuộn tay.
   *
   * Không tắt vĩnh viễn: bật lại ngay khi đổi đoạn, vì lúc đó chỗ user đang xem
   * đã không còn liên quan. Trạng thái này ở `useState` chứ không `ref` — nó đổi
   * vài lần mỗi phút, không phải mỗi khung hình.
   */
  const [autoScroll, setAutoScroll] = useState(true);

  // `useMemo` vì `useWordHighlight` nhận `words` vào mảng phụ thuộc của effect:
  // cắt lại mỗi lượt render sẽ tạo mảng mới và dựng lại vòng `rAF` liên tục.
  const words = useMemo(() => subtitleWords(text), [text]);

  useWordHighlight({ container, words, autoScroll });

  /** Bấm một từ → nhảy tới đúng chỗ đó trong đoạn */
  const seekToWord = (charStart: number): void => {
    const positionMs = seekMsForChar(timings, charStart);
    // `undefined` khi đoạn chưa có timing (chưa generate xong). Bấm lúc đó
    // không làm gì còn hơn nhảy về đầu đoạn — đó không phải điều user muốn.
    if (positionMs === undefined) return;
    seek(positionMs);
    setAutoScroll(true);
  };

  if (words.length === 0) {
    return (
      <div
        data-testid="subtitle-pane"
        data-empty="true"
        className="flex h-full items-center justify-center px-4"
      >
        <p className="text-center text-sm text-fg-muted">
          {state === 'idle' ? 'Bấm phát để xem phụ đề.' : 'Đoạn này không có chữ.'}
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <p
        ref={container}
        data-testid="subtitle-pane"
        // `aria-live` tắt: nội dung không đổi khi phát (chỉ đổi màu), mà bật lên
        // thì screen reader đọc lại cả đoạn mỗi lần đổi đoạn — chồng lên audio.
        aria-live="off"
        onScroll={() => {
          // Vòng `rAF` gọi `scrollIntoView` cũng sinh sự kiện này. Chỉ tắt tự
          // cuộn khi đang **không** phát, tức là chắc chắn do user kéo.
          if (state !== 'playing') setAutoScroll(false);
        }}
        onWheel={() => setAutoScroll(false)}
        className="min-h-0 flex-1 overflow-y-auto px-5 py-4 text-lg leading-relaxed text-subtitle-past"
      >
        {words.map((word, index) => (
          <span key={`${String(word.charStart)}-${word.text}`}>
            <button
              type="button"
              data-word-index={index}
              onClick={() => seekToWord(word.charStart)}
              // Chuột phải để sửa cách đọc. Dùng `onContextMenu` chứ không thêm
              // một nút riêng cạnh mỗi từ: phụ đề là chỗ để đọc, nhồi thêm nút
              // vào từng chữ sẽ phá mặt chữ mà user đang bám theo.
              onContextMenu={
                onEditPronunciation === undefined
                  ? undefined
                  : (event) => {
                      event.preventDefault();
                      onEditPronunciation(word.text);
                    }
              }
              // Kiểu của từ đang đọc đặt qua `data-active` để `useWordHighlight`
              // bật/tắt bằng một lệnh DOM, không qua React. Xem hook đó.
              className="rounded px-0.5 text-left transition-colors hover:bg-bg-subtle data-[active]:bg-subtitle-current/15 data-[active]:font-medium data-[active]:text-subtitle-current"
            >
              {word.text}
            </button>
            {/* Khoảng trắng nằm ngoài `<button>` để vùng bấm bám sát mặt chữ */}
            {index < words.length - 1 ? ' ' : null}
          </span>
        ))}
      </p>

      {!autoScroll ? (
        <button
          type="button"
          onClick={() => setAutoScroll(true)}
          className="shrink-0 border-t border-border px-3 py-1.5 text-xs text-fg-muted transition-colors hover:bg-bg-subtle hover:text-fg"
        >
          ↓ Theo từ đang đọc
        </button>
      ) : null}
    </div>
  );
};
