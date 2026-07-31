import { useState } from 'react';
import { BOOKMARK_NOTE_MAX } from '@ln/shared';
import { bookmarkOfSegment, useBookmarkStore } from '@/stores/bookmark-store';

/**
 * Nút đánh dấu đoạn đang đọc, kèm ô ghi chú (P5.4).
 *
 * **Neo vào đoạn đang chọn, không phải đoạn đang phát.** Hai thứ này lệch nhau
 * khi user bấm một đoạn để xem nó ở trang nào trong lúc đang nghe chỗ khác —
 * và lúc đó thứ họ muốn đánh dấu là đoạn vừa bấm, thứ đang nhìn.
 *
 * Bấm khi đoạn **đã có dấu** thì mở ô sửa ghi chú chứ không xoá ngay: xoá là
 * thao tác mất dữ liệu, không đáng nằm sau một cú bấm nhầm.
 */

export type BookmarkButtonProps = {
  /** Đoạn đang chọn. `null` khi chưa chọn đoạn nào — nút tự vô hiệu hoá */
  segmentId: string | null;
};

export const BookmarkButton = ({ segmentId }: BookmarkButtonProps): JSX.Element => {
  const entries = useBookmarkStore((s) => s.entries);
  const add = useBookmarkStore((s) => s.add);
  const updateNote = useBookmarkStore((s) => s.updateNote);
  const remove = useBookmarkStore((s) => s.remove);

  const existing = bookmarkOfSegment(entries, segmentId);
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState('');

  const openEditor = (): void => {
    setNote(existing?.bookmark.note ?? '');
    setEditing(true);
  };

  const handleSave = async (): Promise<void> => {
    if (segmentId === null) return;

    // Đã có dấu thì chỉ sửa ghi chú; chưa có thì tạo mới kèm ghi chú luôn.
    // Gọi `add` cho cả hai ca cũng chạy (main tự upsert) nhưng tốn thêm một
    // lượt nạp lại danh sách mà thứ tự không hề đổi.
    const done =
      existing === undefined
        ? await add(segmentId, note)
        : await updateNote(existing.bookmark.id, note);

    if (done) setEditing(false);
  };

  if (segmentId === null) {
    return (
      <button
        type="button"
        disabled
        data-testid="bookmark-toggle"
        title="Chọn một đoạn để đánh dấu"
        className="rounded border border-border px-2 py-1 text-xs text-fg-muted opacity-50"
      >
        ☆ Đánh dấu
      </button>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={openEditor}
        data-testid="bookmark-toggle"
        aria-pressed={existing !== undefined}
        title={existing === undefined ? 'Đánh dấu đoạn này' : 'Sửa dấu trang'}
        className={`rounded border px-2 py-1 text-xs transition-colors ${
          existing === undefined
            ? 'border-border text-fg-muted hover:bg-bg-subtle hover:text-fg'
            : 'border-accent bg-accent/15 text-accent'
        }`}
      >
        {existing === undefined ? '☆ Đánh dấu' : '★ Đã đánh dấu'}
      </button>

      {editing ? (
        <div
          data-testid="bookmark-editor"
          // Mở **lên trên**: nút nằm ở thanh đầu trình đọc, nhưng ô này cũng
          // dùng ở chỗ sát đáy — canh theo `bottom-full` cho cả hai chỗ an toàn.
          className="absolute right-0 top-full z-20 mt-1 w-72 rounded border border-border bg-bg-elevated p-3 shadow-lg"
        >
          <label htmlFor="bookmark-note" className="mb-1 block text-xs text-fg-muted">
            Ghi chú (không bắt buộc)
          </label>
          <textarea
            id="bookmark-note"
            data-testid="bookmark-note-input"
            value={note}
            maxLength={BOOKMARK_NOTE_MAX}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            className="w-full resize-none rounded border border-border bg-bg px-2 py-1 text-sm text-fg"
          />

          <div className="mt-2 flex items-center justify-between gap-2">
            {existing === undefined ? (
              <span />
            ) : (
              <button
                type="button"
                data-testid="bookmark-delete"
                onClick={() => {
                  void remove(existing.bookmark.id);
                  setEditing(false);
                }}
                className="rounded px-2 py-1 text-xs text-danger transition-colors hover:bg-danger/10"
              >
                Xoá dấu trang
              </button>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="rounded px-2 py-1 text-xs text-fg-muted transition-colors hover:bg-bg-subtle"
              >
                Huỷ
              </button>
              <button
                type="button"
                data-testid="bookmark-save"
                onClick={() => void handleSave()}
                className="rounded bg-accent px-2 py-1 text-xs text-accent-fg transition-opacity hover:opacity-90"
              >
                Lưu
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
