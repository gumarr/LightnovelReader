import type { QueueStatusInfo } from '@ln/shared';
import { queuePercent, queueStateLabel } from './format';

/**
 * Thanh tiến độ hàng đợi generate + nút tạm dừng / huỷ.
 *
 * Hiện **số job**, không phải phần trăm thời gian: một segment mất 0.1–1.5s tuỳ
 * lần đầu có phải nạp model hay không, nên quy ra phần trăm thời gian sẽ nhảy
 * giật. Số đoạn còn lại là con số user kiểm chứng được.
 */

export type QueueProgressProps = {
  status: QueueStatusInfo;
  onPause: () => void;
  onResume: () => void;
  onCancelAll: () => void;
};

export const QueueProgress = ({
  status,
  onPause,
  onResume,
  onCancelAll,
}: QueueProgressProps): JSX.Element => {
  const remaining = status.queued + status.running;
  const percent = queuePercent(status);

  return (
    <div
      data-testid="queue-progress"
      data-state={status.state}
      className="flex flex-col gap-1.5 rounded-lg border border-border bg-bg-elevated p-2.5"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-fg">
          {queueStateLabel(status)}
          {status.error > 0 && (
            <span data-testid="queue-error-count" className="ml-2 text-danger">
              {status.error} lỗi
            </span>
          )}
        </p>

        <div className="flex shrink-0 items-center gap-1.5">
          {status.state === 'paused' ? (
            <button
              type="button"
              onClick={onResume}
              className="rounded border border-border px-2 py-0.5 text-xs text-fg transition-colors hover:bg-bg-subtle"
            >
              Tiếp tục
            </button>
          ) : (
            <button
              type="button"
              onClick={onPause}
              disabled={remaining === 0}
              className="rounded border border-border px-2 py-0.5 text-xs text-fg transition-colors hover:bg-bg-subtle disabled:cursor-not-allowed disabled:opacity-40"
            >
              Tạm dừng
            </button>
          )}
          <button
            type="button"
            onClick={onCancelAll}
            disabled={remaining === 0}
            className="rounded border border-border px-2 py-0.5 text-xs text-fg transition-colors hover:border-danger hover:text-danger disabled:cursor-not-allowed disabled:opacity-40"
          >
            Huỷ hết
          </button>
        </div>
      </div>

      <div
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Tiến độ tạo audio"
        data-testid="queue-progress-bar"
        className="h-1.5 w-full overflow-hidden rounded-full bg-bg-subtle"
      >
        <div
          className="h-full rounded-full transition-[width]"
          // Màu lấy từ CSS variable, không hardcode hex — xem PROGRESS mục 4.23
          style={{ width: `${String(percent)}%`, backgroundColor: 'rgb(var(--accent))' }}
        />
      </div>
    </div>
  );
};
