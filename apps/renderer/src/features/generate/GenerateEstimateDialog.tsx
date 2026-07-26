import { formatBytes, formatDuration, type GenerateEstimateInfo } from '@ln/shared';

/**
 * Hộp xác nhận trước khi generate — CLAUDE.md **bắt buộc** hiện ước lượng thời
 * gian và dung lượng trước khi chạy "generate cả sách".
 *
 * Số liệu là **ước lượng**, không phải đo thật: nói rõ điều đó thay vì đưa ra
 * con số trông như chính xác. Đo thật ở P2.5 cho ~9.3 KB mỗi segment ở 24 kbps,
 * còn `SYNTHESIS_RTF_ESTIMATE` vẫn là hằng số chưa hiệu chỉnh (xem mục 8).
 */

export type GenerateEstimateDialogProps = {
  title: string;
  estimate: GenerateEstimateInfo;
  /** Ngưỡng cảnh báo dung lượng từ `AppSettings.storageWarnBytes` */
  storageWarnBytes: number;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export const GenerateEstimateDialog = ({
  title,
  estimate,
  storageWarnBytes,
  busy,
  onConfirm,
  onCancel,
}: GenerateEstimateDialogProps): JSX.Element => {
  const nothingToDo = estimate.segmentCount === 0;
  // Cảnh báo tính trên TỔNG sau khi generate, không chỉ phần thêm: user quan tâm
  // đĩa còn bao nhiêu, mà phần đã có vẫn đang chiếm chỗ.
  const totalAfter = estimate.existingBytes + estimate.audioBytes;
  const overWarn = totalAfter > storageWarnBytes;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Xác nhận tạo audio: ${title}`}
      data-testid="generate-estimate-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgb(var(--bg) / 0.7)' }}
    >
      <div className="w-full max-w-md rounded-lg border border-border bg-bg-elevated p-4 shadow-lg">
        <h2 className="text-sm font-semibold text-fg">Tạo audio</h2>
        <p className="mt-0.5 truncate text-xs text-fg-muted" title={title}>
          {title}
        </p>

        {nothingToDo ? (
          <p className="mt-3 text-sm text-fg-muted">
            Toàn bộ phần này đã có audio. Không có gì cần tạo thêm.
          </p>
        ) : (
          <>
            <dl className="mt-3 flex flex-col gap-1.5 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-fg-muted">Số đoạn cần tạo</dt>
                <dd className="tabular-nums text-fg">{estimate.segmentCount}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-fg-muted">Thời lượng audio</dt>
                <dd className="tabular-nums text-fg">
                  ~{formatDuration(estimate.audioDurationMs)}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-fg-muted">Dung lượng thêm</dt>
                <dd className="tabular-nums text-fg" data-testid="estimate-bytes">
                  ~{formatBytes(estimate.audioBytes)}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-fg-muted">Thời gian xử lý</dt>
                <dd className="tabular-nums text-fg">~{formatDuration(estimate.processingMs)}</dd>
              </div>
              {estimate.existingBytes > 0 && (
                <div className="flex justify-between gap-3 border-t border-border pt-1.5">
                  <dt className="text-fg-muted">Đã có sẵn</dt>
                  <dd className="tabular-nums text-fg-muted">
                    {formatBytes(estimate.existingBytes)}
                  </dd>
                </div>
              )}
            </dl>

            <p className="mt-2 text-xs text-fg-muted">
              Đây là ước lượng — số thật phụ thuộc giọng đọc và nội dung.
            </p>

            {overWarn && (
              <p
                role="alert"
                data-testid="estimate-storage-warning"
                className="mt-2 text-xs text-danger"
              >
                Sau khi tạo, sách này chiếm ~{formatBytes(totalAfter)} — vượt ngưỡng cảnh báo{' '}
                {formatBytes(storageWarnBytes)}.
              </p>
            )}
          </>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-border px-3 py-1.5 text-sm text-fg transition-colors hover:bg-bg-subtle"
          >
            {nothingToDo ? 'Đóng' : 'Huỷ'}
          </button>
          {!nothingToDo && (
            <button
              type="button"
              onClick={onConfirm}
              disabled={busy}
              className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? 'Đang xếp…' : 'Bắt đầu tạo'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
