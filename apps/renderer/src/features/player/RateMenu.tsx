import { useEffect, useRef, useState } from 'react';
import { PLAYBACK_RATE_STEPS, rateLabel } from './format';
import { ChevronDownIcon } from './icons';

/**
 * Chọn tốc độ phát bằng menu thả xuống.
 *
 * Tám mốc (0.75×…3×) bày ngang hết thì thanh player chật, và trên cửa sổ hẹp sẽ
 * xuống dòng đè lên thanh tiến độ. Đổi tốc độ là việc làm một lần rồi giữ hàng
 * giờ, nên thêm một cú bấm để mở menu là đánh đổi đáng.
 *
 * Tự dựng chứ không lấy `shadcn/ui DropdownMenu`: cần đúng một menu không có
 * submenu, và bản của Radix kéo theo focus trap + portal — thừa cho chỗ này.
 */

export type RateMenuProps = {
  rate: number;
  onSelect: (rate: number) => void;
};

export const RateMenu = ({ rate, onSelect }: RateMenuProps): JSX.Element => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Bấm ra ngoài hoặc Esc thì đóng. Thiếu cái này thì menu dính lại trên màn
  // hình và che mất thanh tiến độ.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent): void => {
      if (rootRef.current?.contains(event.target as Node) === true) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
      }
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        data-testid="player-rate-menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title={`Tốc độ phát — đang ${rateLabel(rate)}`}
        aria-label={`Tốc độ phát, đang ${rateLabel(rate)}`}
        className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs tabular-nums text-fg transition-colors hover:bg-bg-subtle"
      >
        {/* `tabular-nums` để bề ngang không nhảy khi đổi giữa `1×` và `1.75×` */}
        {rateLabel(rate)}
        <ChevronDownIcon size={12} />
      </button>

      {open && (
        <div
          role="menu"
          data-testid="player-rate-list"
          aria-label="Tốc độ phát"
          // `bottom-full` — thanh player nằm sát đáy cửa sổ nên menu phải mở
          // LÊN; mở xuống là nằm ngoài màn hình.
          className="absolute bottom-full right-0 z-20 mb-1 min-w-[5.5rem] overflow-hidden rounded border border-border bg-bg-elevated py-1 shadow-lg"
        >
          {PLAYBACK_RATE_STEPS.map((step) => (
            <button
              key={step}
              type="button"
              role="menuitemradio"
              aria-checked={rate === step}
              data-testid={`player-rate-${String(step)}`}
              data-active={rate === step}
              onClick={() => {
                onSelect(step);
                setOpen(false);
              }}
              className={
                rate === step
                  ? 'flex w-full items-center justify-between gap-2 bg-accent/10 px-2.5 py-1 text-left text-xs font-medium text-accent'
                  : 'flex w-full items-center justify-between gap-2 px-2.5 py-1 text-left text-xs text-fg transition-colors hover:bg-bg-subtle'
              }
            >
              <span className="tabular-nums">{rateLabel(step)}</span>
              {/* Dấu tick cho mốc đang chọn — không dựa vào riêng màu chữ, vì
                  người mù màu sẽ không phân biệt được */}
              {rate === step && <span aria-hidden>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
