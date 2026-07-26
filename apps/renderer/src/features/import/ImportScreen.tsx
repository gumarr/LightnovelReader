import type { SaveBookResponse } from '@ln/shared';
import { useImportStore } from '@/stores/import-store';
import { ChapterConfirm } from './ChapterConfirm';

/**
 * Điểm vào của luồng nhập sách: chọn file → xác nhận cấu trúc chương.
 *
 * Không bao giờ generate audio ngay sau import — phải qua màn xác nhận.
 */

export type ImportScreenProps = {
  /** Gọi sau khi sách đã lưu vào thư viện */
  onSaved: (result: SaveBookResponse) => void;
  /**
   * Về thư viện khi user đổi ý ở bước chọn file.
   *
   * Bước xác nhận chương đã có nút "Huỷ" riêng (nó phải bỏ cả phiên import ở
   * main), còn bước chọn file trước đây **không có đường ra nào** — vào rồi là
   * kẹt, phải đóng app.
   */
  onBack: () => void;
};

export const ImportScreen = ({ onSaved, onBack }: ImportScreenProps): JSX.Element => {
  const preview = useImportStore((s) => s.preview);
  const parsing = useImportStore((s) => s.parsing);
  const error = useImportStore((s) => s.error);
  const pickFile = useImportStore((s) => s.pickFile);
  const reset = useImportStore((s) => s.reset);

  if (preview !== null) {
    return (
      <ChapterConfirm
        preview={preview}
        onSaved={onSaved}
        onCancel={() => {
          void reset();
        }}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Nút về đặt ở góc trên như mọi màn khác (Giọng đọc, Dung lượng), không
          đặt giữa cùng khối nội dung — chỗ đó user không tìm nút điều hướng. */}
      <div className="shrink-0 p-4">
        <button
          type="button"
          onClick={onBack}
          data-testid="import-back"
          className="text-xs text-fg-muted transition-colors hover:text-fg"
        >
          ← Thư viện
        </button>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
        <div>
          <h1 className="text-2xl font-semibold text-fg">Nhập sách</h1>
          <p className="mt-1 text-fg-muted">Chọn file PDF hoặc DOCX để bắt đầu.</p>
        </div>

        <button
          type="button"
          onClick={() => {
            void pickFile();
          }}
          disabled={parsing}
          className="rounded bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {parsing ? 'Đang phân tích…' : 'Chọn file'}
        </button>

        {parsing ? (
          <p className="text-sm text-fg-muted">Sách vài trăm trang có thể mất vài giây.</p>
        ) : null}

        {error !== null ? (
          <p role="alert" className="max-w-md text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
};
