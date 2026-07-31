import { useEffect } from 'react';
import { useQueueStore } from '@/stores/queue-store';
import { jobDetail, jobStatusLabel, priorityLabel } from './job-format';

/**
 * Bảng hàng đợi: job nào đang chờ, job nào hỏng, huỷ từng job (P5.4).
 *
 * `queue:listPending` và `queue:cancelJob` có từ P2.6 mà **chưa ai gọi** suốt
 * ba phase — trước bảng này user chỉ huỷ được cả sách hoặc tất cả, và không có
 * cách nào thấy job nào đang chắn đường.
 *
 * **Nạp một lần khi mở, không hỏi vòng.** Danh sách tới 200 job và không có
 * event nào đẩy nó xuống; hỏi vòng trong lúc generate cả sách là hàng nghìn
 * lượt IPC cho một bảng user mở ra xem vài giây. Có nút nạp lại cho ca user
 * muốn xem tình hình mới.
 */

export type QueueTableProps = {
  onClose: () => void;
};

export const QueueTable = ({ onClose }: QueueTableProps): JSX.Element => {
  const pending = useQueueStore((s) => s.pending);
  const pendingLoaded = useQueueStore((s) => s.pendingLoaded);
  const error = useQueueStore((s) => s.error);
  const loadPending = useQueueStore((s) => s.loadPending);
  const cancelJob = useQueueStore((s) => s.cancelJob);

  useEffect(() => {
    void loadPending();
  }, [loadPending]);

  return (
    <div
      data-testid="queue-table"
      className="flex max-h-80 flex-col rounded border border-border bg-bg-elevated"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <h3 className="flex-1 text-xs font-medium text-fg">Hàng đợi</h3>
        <button
          type="button"
          data-testid="queue-table-refresh"
          onClick={() => void loadPending()}
          className="rounded px-2 py-1 text-xs text-fg-muted transition-colors hover:bg-bg-subtle hover:text-fg"
        >
          Nạp lại
        </button>
        <button
          type="button"
          data-testid="queue-table-close"
          onClick={onClose}
          className="rounded px-2 py-1 text-xs text-fg-muted transition-colors hover:bg-bg-subtle hover:text-fg"
        >
          Đóng
        </button>
      </div>

      {error !== null ? (
        <p role="alert" className="px-3 py-2 text-xs text-danger">
          {error}
        </p>
      ) : null}

      {/*
        `min-h-0` bắt buộc để ô cuộn co được dưới chiều cao nội dung — thiếu nó
        thì danh sách đẩy tràn khỏi `max-h-80` (cùng loại lỗi 4.43).
      */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!pendingLoaded ? (
          <p className="px-3 py-2 text-xs text-fg-muted">Đang tải…</p>
        ) : pending.length === 0 ? (
          <p data-testid="queue-table-empty" className="px-3 py-2 text-xs text-fg-muted">
            Không có việc nào đang chờ.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {pending.map((job) => {
              const detail = jobDetail(job);
              return (
                <li
                  key={job.id}
                  data-testid="queue-job-row"
                  className="flex items-start gap-2 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex items-baseline gap-1.5 text-xs">
                      <span
                        className={
                          job.status === 'error'
                            ? 'shrink-0 text-danger'
                            : job.status === 'running'
                              ? 'shrink-0 text-accent'
                              : 'shrink-0 text-fg-muted'
                        }
                      >
                        {jobStatusLabel(job)}
                      </span>
                      <span className="shrink-0 text-fg-muted">·</span>
                      <span className="shrink-0 text-fg-muted">
                        {priorityLabel(job.priority)}
                      </span>
                    </p>

                    {/*
                      Hiện `segmentId` chứ không hiện text đoạn: job chỉ mang id,
                      và đi tra text cho tới 200 hàng là 200 lượt truy vấn cho một
                      bảng chẩn đoán. Id đủ để đối chiếu với danh sách đoạn.
                    */}
                    <p className="truncate font-mono text-[11px] text-fg-muted">{job.segmentId}</p>

                    {detail === undefined ? null : (
                      <p className="mt-0.5 line-clamp-2 text-[11px] text-danger">{detail}</p>
                    )}
                  </div>

                  <button
                    type="button"
                    data-testid={`queue-cancel-${job.id}`}
                    onClick={() => void cancelJob(job.id)}
                    className="shrink-0 rounded px-2 py-1 text-xs text-fg-muted transition-colors hover:bg-danger/10 hover:text-danger"
                  >
                    Huỷ
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};
