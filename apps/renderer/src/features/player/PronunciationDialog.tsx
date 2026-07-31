import { useEffect, useRef, useState } from 'react';
import { usePronunciationStore } from '@/stores/pronunciation-store';

/**
 * Sửa cách đọc một từ — tầng 3 của phiên âm (plan.md mục 8.1).
 *
 * Hai tầng dưới (từ điển ship sẵn + luật romaji tự suy) lo phần lớn tên Nhật;
 * đây là van an toàn cho những cái tên máy đoán sai, và là **chỗ duy nhất** user
 * can thiệp được vào cách đọc.
 *
 * **Mặc định lưu theo sách**, không phải toàn cục: cách đọc một cái tên thường
 * chỉ đúng trong bộ truyện đó — `Kaguya` ở truyện này là tên người, ở truyện
 * khác có thể là địa danh đọc khác hẳn.
 *
 * **Nói rõ audio cũ không đổi.** Sửa xong mà đoạn đang nghe vẫn đọc như cũ là
 * chỗ user chắc chắn tưởng app hỏng. Không tự generate lại: một cuốn có thể là
 * hàng nghìn đoạn, và CLAUDE.md bắt buộc hiện ước lượng trước khi generate hàng
 * loạt.
 */

export type PronunciationDialogProps = {
  /** Từ user bấm chuột phải vào, lấy nguyên văn từ phụ đề */
  term: string;
  onClose: () => void;
};

export const PronunciationDialog = ({ term, onClose }: PronunciationDialogProps): JSX.Element => {
  const entries = usePronunciationStore((s) => s.entries);
  const save = usePronunciationStore((s) => s.save);
  const remove = usePronunciationStore((s) => s.remove);
  const error = usePronunciationStore((s) => s.error);
  const clearError = usePronunciationStore((s) => s.clearError);

  // Mục đã có cho đúng từ này — so theo chữ thường vì `term` trong DB luôn thường.
  const existing = entries.find((e) => e.term === term.trim().toLowerCase());

  const [replacement, setReplacement] = useState(existing?.replacement ?? '');
  const [global, setGlobal] = useState(existing?.bookId === undefined && existing !== undefined);
  const [busy, setBusy] = useState(false);

  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Đưa con trỏ vào ô nhập ngay: user vừa bấm chuột phải vào một từ, thao tác
    // tiếp theo chắc chắn là gõ cách đọc.
    input.current?.focus();
    input.current?.select();
    return () => clearError();
  }, [clearError]);

  const submit = async (): Promise<void> => {
    setBusy(true);
    const okSaved = await save({ term, replacement, global });
    setBusy(false);
    if (okSaved) onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Sửa cách đọc: ${term}`}
      data-testid="pronunciation-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgb(var(--bg) / 0.7)' }}
      onKeyDown={(event) => {
        // Escape đóng: hộp này mở ra từ một cú bấm nhầm cũng là chuyện thường.
        if (event.key === 'Escape') onClose();
      }}
    >
      <div className="w-full max-w-md rounded-lg border border-border bg-bg-elevated p-4 shadow-lg">
        <h2 className="text-sm font-semibold text-fg">Sửa cách đọc</h2>
        <p className="mt-0.5 text-xs text-fg-muted">
          Từ trong sách: <strong className="text-fg">{term}</strong>
        </p>

        <label className="mt-3 block">
          <span className="text-xs text-fg-muted">Đọc thành</span>
          <input
            ref={input}
            type="text"
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && replacement.trim() !== '') void submit();
            }}
            placeholder="Tô-ki-ô"
            data-testid="pronunciation-input"
            className="mt-1 w-full rounded border border-border bg-bg px-2.5 py-1.5 text-sm text-fg outline-none focus:border-accent"
          />
        </label>

        {/*
          Nhắc quy tắc gạch nối ngay dưới ô nhập chứ không đợi tới lúc báo lỗi:
          dấu cách khiến Piper chèn khoảng nghỉ, nghe thành ba tiếng rời rạc.
        */}
        <p className="mt-1 text-xs text-fg-muted">
          Ngăn các âm tiết bằng gạch nối, không dùng dấu cách.
        </p>

        <label className="mt-3 flex items-center gap-2 text-xs text-fg">
          <input
            type="checkbox"
            checked={global}
            onChange={(e) => setGlobal(e.target.checked)}
            data-testid="pronunciation-global"
          />
          Áp dụng cho mọi sách
        </label>

        {error !== null && (
          <p role="alert" data-testid="pronunciation-error" className="mt-3 text-xs text-danger">
            {error}
          </p>
        )}

        {/*
          Cảnh báo audio cũ: đây là hiểu nhầm chắc chắn xảy ra nếu không nói.
          Chỉ hiện khi đã có audio để khỏi nhiễu lúc sách còn chưa generate.
        */}
        <p className="mt-3 rounded border border-border px-2.5 py-2 text-xs text-fg-muted">
          Đoạn đã tạo audio vẫn giữ cách đọc cũ. Tạo lại audio của chương để nghe
          theo cách đọc mới.
        </p>

        <div className="mt-4 flex justify-between gap-2">
          {existing !== undefined ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                void (async () => {
                  setBusy(true);
                  await remove(existing.id);
                  setBusy(false);
                  onClose();
                })();
              }}
              data-testid="pronunciation-remove"
              className="rounded border border-border px-3 py-1.5 text-xs text-fg transition-colors hover:border-danger hover:text-danger disabled:opacity-40"
            >
              Xoá mục này
            </button>
          ) : (
            <span />
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-border px-3 py-1.5 text-xs text-fg transition-colors hover:bg-bg-subtle"
            >
              Huỷ
            </button>
            <button
              type="button"
              // Chặn khi rỗng: gửi đi chắc chắn bị zod từ chối, mà báo lỗi cho
              // một nút lẽ ra không nên bấm được là thừa.
              disabled={busy || replacement.trim() === ''}
              onClick={() => void submit()}
              data-testid="pronunciation-save"
              className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? 'Đang lưu…' : 'Lưu'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
