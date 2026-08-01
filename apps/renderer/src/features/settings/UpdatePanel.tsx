import type { UpdateStatus } from '@ln/shared';
import {
  downloadProgressLabel,
  updateAction,
  updateActionLabel,
  updateDetail,
  updateTitle,
} from './update-format';

/**
 * Ô cập nhật trong màn Cài đặt (P5.5c).
 *
 * Đây là **chỗ duy nhất** có đủ mọi hành động: kiểm tra, tải, cài, và bật/tắt
 * kiểm tự động. Dải báo ở đầu app cố tình chỉ có một nút — nó xen vào lúc user
 * đang làm việc khác, không phải chỗ bày ra bốn lựa chọn.
 *
 * `autoCheckUpdates` **bắt buộc** có mặt ở đây. Cờ đó nằm trong `AppSettings`
 * từ P5.5b nhưng chưa màn nào đọc — đúng hình dạng "setting chết" của PROGRESS
 * mục 4.71, thứ dự án này đã mắc một lần với `subtitleFontSize`.
 */

export type UpdatePanelProps = {
  /** `null` khi chưa nạp xong — panel vẫn hiện khung để bố cục không nhảy */
  status: UpdateStatus | null;
  autoCheck: boolean;
  onCheck: () => void;
  onDownload: () => void;
  onInstall: () => void;
  onAutoCheckChange: (enabled: boolean) => void;
};

export const UpdatePanel = ({
  status,
  autoCheck,
  onCheck,
  onDownload,
  onInstall,
  onAutoCheckChange,
}: UpdatePanelProps): JSX.Element => {
  const action = status === null ? 'none' : updateAction(status);
  const actionLabel = updateActionLabel(action);
  const detail = status === null ? undefined : updateDetail(status);
  const progress = status === null ? undefined : downloadProgressLabel(status);

  const onAction = (): void => {
    if (action === 'check') onCheck();
    else if (action === 'download') onDownload();
    else if (action === 'install') onInstall();
  };

  return (
    <section
      data-testid="settings-update"
      data-update-state={status?.state ?? 'loading'}
      className="flex flex-col gap-3 rounded-lg border border-border bg-bg-elevated p-3"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 data-testid="update-title" className="text-sm font-semibold text-fg">
            {status === null ? 'Cập nhật' : updateTitle(status)}
          </h2>
          {detail !== undefined && (
            <p data-testid="update-detail" className="mt-0.5 text-xs text-fg-muted">
              {detail}
            </p>
          )}
        </div>

        {actionLabel !== undefined && (
          <button
            type="button"
            onClick={onAction}
            data-testid="update-action"
            data-action={action}
            /*
              Nút cài dùng màu nhấn vì đó là việc app đang mời user làm; nút
              kiểm tra để trung tính — bấm nó chỉ ra một câu trả lời, không phải
              một thao tác thay cả ứng dụng.
            */
            className={
              action === 'install'
                ? 'shrink-0 rounded bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg transition-opacity hover:opacity-90'
                : 'shrink-0 rounded border border-border px-3 py-1.5 text-xs text-fg transition-colors hover:bg-bg-subtle'
            }
          >
            {actionLabel}
          </button>
        )}
      </div>

      {/*
        Thanh tiến độ chỉ dựng khi đang tải. Để nó nằm sẵn ở 0% mọi lúc là hiện
        một thanh không bao giờ chạy — user đọc thành "đang tải mà đứng im".
      */}
      {status?.state === 'downloading' && (
        <div className="flex flex-col gap-1">
          <div className="h-1.5 overflow-hidden rounded-full bg-bg-subtle">
            <div
              data-testid="update-progress-bar"
              className="h-full rounded-full bg-accent transition-[width]"
              style={{ width: `${String(status.percent ?? 0)}%` }}
            />
          </div>
          <p className="text-right text-xs tabular-nums text-fg-muted">
            {progress ?? `${String(status.percent ?? 0)}%`}
          </p>
        </div>
      )}

      <label className="flex items-center gap-2 text-xs text-fg">
        <input
          type="checkbox"
          checked={autoCheck}
          onChange={(e) => onAutoCheckChange(e.target.checked)}
          data-testid="update-auto-check"
          className="accent-accent"
        />
        Tự kiểm tra bản mới khi mở ứng dụng
      </label>
      {/*
        Nói rõ "chỉ kiểm tra": đây là request mạng duy nhất app tự gửi, mà app
        này bán mình là đọc offline. User có quyền biết chính xác nó làm gì.
      */}
      <p className="-mt-1 text-xs text-fg-muted">
        Chỉ hỏi xem có bản mới không (~1 KB). Tải bản cài vẫn do bạn bấm.
      </p>
    </section>
  );
};
