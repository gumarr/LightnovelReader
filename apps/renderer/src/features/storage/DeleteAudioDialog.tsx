import { formatBytes } from '@ln/shared';

/**
 * Hộp xác nhận trước khi xoá audio.
 *
 * Xoá audio **không lấy lại được** — generate lại một vol mất hàng giờ CPU. Nên
 * mọi đường xoá đều đi qua đây, kể cả xoá một chương.
 *
 * Nói rõ **cái gì được giữ lại** chứ không chỉ cái gì mất: user sợ mất tiến độ
 * đọc và bookmark nhất, mà đó đúng là hai thứ không bị xoá (CLAUDE.md).
 */

export type DeleteAudioDialogProps = {
  /** Tên chương hoặc tên sách, hiện nguyên văn cho user đối chiếu */
  title: string;
  /** Dung lượng sẽ giải phóng, theo DB */
  bytes: number;
  /** Số đoạn sẽ phải tạo lại nếu muốn nghe tiếp */
  segments: number;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export const DeleteAudioDialog = ({
  title,
  bytes,
  segments,
  busy,
  onConfirm,
  onCancel,
}: DeleteAudioDialogProps): JSX.Element => (
  <div
    role="dialog"
    aria-modal="true"
    aria-label={`Xác nhận xoá audio: ${title}`}
    data-testid="delete-audio-dialog"
    className="fixed inset-0 z-50 flex items-center justify-center p-4"
    style={{ backgroundColor: 'rgb(var(--bg) / 0.7)' }}
  >
    <div className="w-full max-w-md rounded-lg border border-border bg-bg-elevated p-4 shadow-lg">
      <h2 className="text-sm font-semibold text-fg">Xoá audio</h2>
      <p className="mt-0.5 truncate text-xs text-fg-muted" title={title}>
        {title}
      </p>

      <dl className="mt-3 flex flex-col gap-1.5 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-fg-muted">Giải phóng</dt>
          <dd className="tabular-nums text-fg" data-testid="delete-bytes">
            {formatBytes(bytes)}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-fg-muted">Số đoạn mất audio</dt>
          <dd className="tabular-nums text-fg">{segments}</dd>
        </div>
      </dl>

      <p className="mt-3 text-xs text-fg-muted">
        Vẫn giữ <strong className="text-fg">tiến độ đọc, bookmark và cấu trúc chương</strong>. Chỉ
        file audio bị xoá — tạo lại được nhưng phải chờ tổng hợp lại.
      </p>

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-border px-3 py-1.5 text-sm text-fg transition-colors hover:bg-bg-subtle"
        >
          Huỷ
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          data-testid="delete-confirm"
          className="rounded bg-danger px-3 py-1.5 text-sm font-medium text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? 'Đang xoá…' : 'Xoá audio'}
        </button>
      </div>
    </div>
  </div>
);
