import { useEffect, useState } from 'react';
import { useLibraryStore, mostRecentlyRead } from '@/stores/library-store';
import { BookCard } from './BookCard';

/**
 * Màn thư viện: grid sách đã nhập, nút đọc tiếp, nút nhập sách mới.
 */

export type LibraryGridProps = {
  onImport: () => void;
  /** Mở màn quản lý giọng đọc (P2.3) */
  onManageVoices: () => void;
  /** Mở Storage Manager (P2.7) */
  onManageStorage: () => void;
  /** Mở màn Cài đặt (P5.3) */
  onOpenSettings: () => void;
  onOpen: (bookId: string) => void;
};

export const LibraryGrid = ({
  onImport,
  onManageVoices,
  onManageStorage,
  onOpenSettings,
  onOpen,
}: LibraryGridProps): JSX.Element => {
  const entries = useLibraryStore((s) => s.entries);
  const loading = useLibraryStore((s) => s.loading);
  const error = useLibraryStore((s) => s.error);
  const load = useLibraryStore((s) => s.load);
  const remove = useLibraryStore((s) => s.remove);

  // Chốt "bây giờ" một lần mỗi lần mở màn: nhãn thời gian không cần chạy theo
  // đồng hồ, mà đọc `Date.now()` trong render sẽ khiến test không tiền đoán được.
  const [now] = useState(() => Date.now());

  // Xoá sách là mất luôn cấu trúc chương user đã sửa tay ở màn xác nhận —
  // một cú bấm nhầm không được phép huỷ công đó.
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  const resume = mostRecentlyRead(entries);
  const pending = entries.find((e) => e.book.id === confirmRemoveId);

  if (loading && entries.length === 0) {
    return <p className="p-8 text-center text-fg-muted">Đang tải thư viện…</p>;
  }

  return (
    <div className="relative flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-3 px-4 py-3">
        <h1 className="text-lg font-semibold text-fg">Thư viện</h1>
        <span className="text-sm text-fg-muted">{entries.length} sách</span>

        <div className="ml-auto flex items-center gap-2">
          {resume !== undefined ? (
            <button
              type="button"
              onClick={() => onOpen(resume.book.id)}
              className="rounded border border-border px-3 py-1.5 text-sm text-fg transition-colors hover:bg-bg-subtle"
            >
              Đọc tiếp: {resume.book.title}
            </button>
          ) : null}

          <button
            type="button"
            onClick={onManageVoices}
            className="rounded border border-border px-3 py-1.5 text-sm text-fg transition-colors hover:bg-bg-subtle"
          >
            Giọng đọc
          </button>

          <button
            type="button"
            onClick={onManageStorage}
            data-testid="open-storage"
            className="rounded border border-border px-3 py-1.5 text-sm text-fg transition-colors hover:bg-bg-subtle"
          >
            Dung lượng
          </button>

          <button
            type="button"
            onClick={onOpenSettings}
            data-testid="open-settings"
            className="rounded border border-border px-3 py-1.5 text-sm text-fg transition-colors hover:bg-bg-subtle"
          >
            Cài đặt
          </button>

          <button
            type="button"
            onClick={onImport}
            className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg transition-opacity hover:opacity-90"
          >
            Nhập sách
          </button>
        </div>
      </header>

      {error !== null ? (
        <p role="alert" className="mx-4 mb-2 text-sm text-danger">
          {error}
        </p>
      ) : null}

      {entries.length === 0 ? (
        <EmptyState onImport={onImport} />
      ) : (
        <ul className="grid flex-1 grid-cols-[repeat(auto-fill,minmax(150px,1fr))] content-start gap-3 overflow-y-auto px-4 pb-4">
          {entries.map((entry) => (
            <BookCard
              key={entry.book.id}
              entry={entry}
              now={now}
              onOpen={() => onOpen(entry.book.id)}
              onRemove={() => setConfirmRemoveId(entry.book.id)}
            />
          ))}
        </ul>
      )}

      {pending !== undefined ? (
        <ConfirmRemove
          title={pending.book.title}
          chapterCount={pending.chapterCount}
          onCancel={() => setConfirmRemoveId(null)}
          onConfirm={() => {
            setConfirmRemoveId(null);
            void remove(pending.book.id);
          }}
        />
      ) : null}
    </div>
  );
};

type ConfirmRemoveProps = {
  title: string;
  chapterCount: number;
  onCancel: () => void;
  onConfirm: () => void;
};

const ConfirmRemove = ({
  title,
  chapterCount,
  onCancel,
  onConfirm,
}: ConfirmRemoveProps): JSX.Element => (
  <div
    role="dialog"
    aria-modal="true"
    aria-label="Xác nhận xoá sách"
    className="absolute inset-0 flex items-center justify-center bg-bg/80 p-8"
  >
    <div className="w-full max-w-sm rounded-lg border border-border bg-bg-elevated p-4">
      <h2 className="text-sm font-medium text-fg">Xoá &quot;{title}&quot;?</h2>
      {/* Nói đúng những gì bị xoá: từ P2.7 lượt xoá này dọn cả bản copy trong
          thư viện và audio đã tạo. File user tự chọn lúc nhập thì vẫn còn. */}
      <p className="mt-1 text-sm text-fg-muted">
        Mất luôn {chapterCount} chương đã xác nhận và toàn bộ audio đã tạo. File gốc bạn chọn lúc
        nhập vẫn còn trên máy.
      </p>

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-3 py-1.5 text-sm text-fg-muted transition-colors hover:bg-bg-subtle hover:text-fg"
        >
          Huỷ
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="rounded bg-danger px-3 py-1.5 text-sm font-medium text-accent-fg transition-opacity hover:opacity-90"
        >
          Xoá
        </button>
      </div>
    </div>
  </div>
);

const EmptyState = ({ onImport }: { onImport: () => void }): JSX.Element => (
  <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
    <p className="text-fg-muted">Thư viện còn trống.</p>
    <button
      type="button"
      onClick={onImport}
      className="rounded bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-opacity hover:opacity-90"
    >
      Nhập sách đầu tiên
    </button>
  </div>
);
