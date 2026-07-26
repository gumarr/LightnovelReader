import { useState } from 'react';
import type { GenerateEstimateInfo } from '@ln/shared';
import { useQueueStore, isBusyOf } from '@/stores/queue-store';
import { useSettingsStore } from '@/stores/settings-store';
import { GenerateEstimateDialog } from './GenerateEstimateDialog';
import { QueueProgress } from './QueueProgress';

/**
 * Nút tạo audio cho chương / cả sách, kèm hộp ước lượng và thanh tiến độ.
 *
 * Đây là chỗ **đầu tiên** renderer gọi tới nhóm `queue:*` — trước P2.6 cả 9
 * channel đã chạy thật qua probe nhưng không có nút nào bấm được.
 *
 * Cả hai nút đều đi qua hộp ước lượng, không riêng "cả sách": một chương LN có
 * thể là 500 segment, cũng đủ lâu để user muốn biết trước.
 */

export type GenerateControlsProps = {
  bookId: string;
  bookTitle: string;
  /** Chương đang mở. Vắng mặt thì chỉ hiện nút cả sách (màn chi tiết sách). */
  chapterId?: string;
  chapterTitle?: string;
  /** Đã chọn giọng đọc cho ngôn ngữ của sách chưa — chưa thì hàng đợi dừng ngay */
  voiceReady: boolean;
};

/** Phạm vi đang xin xác nhận */
type Pending = {
  scope: 'chapter' | 'book';
  title: string;
  estimate: GenerateEstimateInfo;
};

export const GenerateControls = ({
  bookId,
  bookTitle,
  chapterId,
  chapterTitle,
  voiceReady,
}: GenerateControlsProps): JSX.Element => {
  const status = useQueueStore((s) => s.status);
  const error = useQueueStore((s) => s.error);
  const estimateChapter = useQueueStore((s) => s.estimateChapter);
  const estimateBook = useQueueStore((s) => s.estimateBook);
  const enqueueChapter = useQueueStore((s) => s.enqueueChapter);
  const enqueueBook = useQueueStore((s) => s.enqueueBook);
  const pause = useQueueStore((s) => s.pause);
  const resume = useQueueStore((s) => s.resume);
  const cancelAll = useQueueStore((s) => s.cancelAll);
  const clearError = useQueueStore((s) => s.clearError);

  const storageWarnBytes = useSettingsStore((s) => s.settings?.storageWarnBytes ?? 0);

  const [pending, setPending] = useState<Pending | null>(null);
  /** Chặn bấm hai lần trong lúc chờ IPC ước lượng hoặc xếp hàng đợi */
  const [working, setWorking] = useState(false);

  const ask = async (scope: 'chapter' | 'book'): Promise<void> => {
    setWorking(true);
    try {
      const estimate =
        scope === 'book'
          ? await estimateBook(bookId)
          : chapterId === undefined
            ? null
            : await estimateChapter(chapterId);

      // `null` = IPC hỏng; lỗi đã nằm trong store, không mở hộp rỗng lên nữa.
      if (estimate === null) return;

      setPending({
        scope,
        title: scope === 'book' ? bookTitle : (chapterTitle ?? 'Chương đang đọc'),
        estimate,
      });
    } finally {
      setWorking(false);
    }
  };

  const confirm = async (): Promise<void> => {
    if (pending === null) return;

    setWorking(true);
    try {
      if (pending.scope === 'book') await enqueueBook(bookId);
      else if (chapterId !== undefined) await enqueueChapter(chapterId);
      setPending(null);
    } finally {
      setWorking(false);
    }
  };

  const busy = isBusyOf(status);

  return (
    <div className="flex flex-col gap-2">
      {!voiceReady && (
        <p data-testid="generate-no-voice" className="text-xs text-danger">
          Chưa chọn giọng đọc cho sách này. Vào màn Giọng đọc để tải và chọn, nếu không mọi lượt tạo
          audio sẽ dừng ngay.
        </p>
      )}

      {error !== null && (
        <div
          role="alert"
          data-testid="generate-error"
          className="flex items-start justify-between gap-3 text-xs text-danger"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={clearError}
            aria-label="Đóng thông báo lỗi"
            className="shrink-0 underline"
          >
            Đóng
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {chapterId !== undefined && (
          <button
            type="button"
            onClick={() => void ask('chapter')}
            disabled={working || !voiceReady}
            data-testid="generate-chapter"
            title={voiceReady ? undefined : 'Chọn giọng đọc trước'}
            className="rounded bg-accent px-2.5 py-1 text-xs font-medium text-accent-fg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Tạo audio chương này
          </button>
        )}

        <button
          type="button"
          onClick={() => void ask('book')}
          disabled={working || !voiceReady}
          data-testid="generate-book"
          title={voiceReady ? undefined : 'Chọn giọng đọc trước'}
          className="rounded border border-border px-2.5 py-1 text-xs text-fg transition-colors hover:bg-bg-subtle disabled:cursor-not-allowed disabled:opacity-40"
        >
          Tạo audio cả sách
        </button>
      </div>

      {/* Chỉ hiện thanh tiến độ khi có việc: chỗ trống lúc rỗi là nhiễu */}
      {status !== null && busy && (
        <QueueProgress
          status={status}
          onPause={() => void pause()}
          onResume={() => void resume()}
          onCancelAll={() => void cancelAll()}
        />
      )}

      {pending !== null && (
        <GenerateEstimateDialog
          title={pending.title}
          estimate={pending.estimate}
          storageWarnBytes={storageWarnBytes}
          busy={working}
          onConfirm={() => void confirm()}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
};
