import type { SidecarStatus } from '@ln/shared';
import { sidecarLabel } from './format';

/**
 * Hiện trạng thái sidecar cho user.
 *
 * Trước P2.3, `sidecar:getStatus` và event `sidecar:statusChanged` đã có sẵn
 * nhưng **không UI nào đọc** — sidecar chết thì chỉ log thấy, user thì không.
 * Đây là chỗ đầu tiên thật sự cần sidecar sống nên hiện luôn ở đây.
 *
 * Màu lấy từ CSS variable, không hardcode hex (CLAUDE.md).
 */

export type SidecarBadgeProps = {
  status: SidecarStatus | null;
};

const TONE_CLASS: Record<'ok' | 'pending' | 'error', string> = {
  ok: 'text-fg-muted',
  pending: 'text-fg-muted',
  error: 'text-danger',
};

export const SidecarBadge = ({ status }: SidecarBadgeProps): JSX.Element | null => {
  // Chưa biết trạng thái thì không hiện gì — một badge trống nhấp nháy lúc mở
  // app còn gây phân tâm hơn là không có.
  if (status === null) return null;

  const label = sidecarLabel(status.state, status.restarts);

  return (
    <p
      data-testid="sidecar-badge"
      data-state={status.state}
      data-tone={label.tone}
      title={label.hint}
      className={`flex items-center gap-2 text-xs ${TONE_CLASS[label.tone]}`}
    >
      <span
        aria-hidden="true"
        className="size-2 shrink-0 rounded-full"
        // Chấm màu: xanh khi sẵn sàng, đỏ khi hỏng, xám khi đang chờ. Dùng
        // biến màu nên đúng ở cả dark lẫn light.
        style={{
          backgroundColor:
            label.tone === 'error'
              ? 'rgb(var(--danger))'
              : label.tone === 'ok'
                ? 'rgb(var(--accent))'
                : 'rgb(var(--fg-muted) / 0.5)',
        }}
      />
      {label.text}
      {status.state === 'failed' && status.message !== undefined && (
        <span className="text-fg-muted">— {status.message}</span>
      )}
    </p>
  );
};
