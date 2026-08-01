import type { UpdateStatus } from '@ln/shared';
import { shouldNotify, updateTitle } from './update-format';

/**
 * Dải báo có bản mới, nằm ngay dưới titlebar (P5.5c).
 *
 * **Vì sao cần dải này chứ không chỉ ô trong màn Cài đặt.** Không ai mở Cài đặt
 * để xem có bản mới hay không. Bản cập nhật nào chỉ nằm trong màn Cài đặt thì
 * thực tế là không tồn tại.
 *
 * **Vì sao chỉ một nút.** Dải xen vào lúc user đang đọc sách. Nó nói đúng một
 * việc và cho đúng một cách làm việc đó; ai muốn nhiều lựa chọn hơn thì vào Cài
 * đặt. Nút đóng luôn có mặt: một dải không tắt được là một dải phiền.
 *
 * Chỉ hiện ở `available` và `downloaded` — xem `shouldNotify` để biết vì sao
 * `error` cố tình không được báo ra đây.
 */

export type UpdateBannerProps = {
  status: UpdateStatus | null;
  dismissed: boolean;
  onDownload: () => void;
  onInstall: () => void;
  onDismiss: () => void;
};

export const UpdateBanner = ({
  status,
  dismissed,
  onDownload,
  onInstall,
  onDismiss,
}: UpdateBannerProps): JSX.Element | null => {
  if (status === null || dismissed || !shouldNotify(status)) return null;

  const ready = status.state === 'downloaded';

  return (
    <div
      data-testid="update-banner"
      data-update-state={status.state}
      className="flex shrink-0 items-center gap-3 border-b border-border bg-bg-elevated px-3 py-1.5"
    >
      <span className="min-w-0 flex-1 truncate text-xs text-fg">{updateTitle(status)}</span>

      <button
        type="button"
        onClick={ready ? onInstall : onDownload}
        data-testid="update-banner-action"
        className="shrink-0 rounded bg-accent px-2.5 py-1 text-xs font-medium text-accent-fg transition-opacity hover:opacity-90"
      >
        {ready ? 'Khởi động lại & cài' : 'Tải bản mới'}
      </button>

      <button
        type="button"
        onClick={onDismiss}
        data-testid="update-banner-dismiss"
        aria-label="Đóng thông báo cập nhật"
        className="shrink-0 rounded px-1.5 py-1 text-xs text-fg-muted transition-colors hover:bg-bg-subtle hover:text-fg"
      >
        ✕
      </button>
    </div>
  );
};
