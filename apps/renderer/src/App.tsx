import { useEffect, useState } from 'react';
import type { ChapterDraft } from '@ln/shared';
import { TitleBar } from '@/features/titlebar/TitleBar';
import { ImportScreen } from '@/features/import/ImportScreen';
import { useSettingsStore } from '@/stores/settings-store';

export const App = (): JSX.Element => {
  // Selector riêng từng field — tránh re-render khi field không dùng thay đổi
  const settings = useSettingsStore((s) => s.settings);
  const error = useSettingsStore((s) => s.error);
  const loading = useSettingsStore((s) => s.loading);
  const load = useSettingsStore((s) => s.load);
  const applyExternal = useSettingsStore((s) => s.applyExternal);

  // Kết quả xác nhận, giữ tạm cho tới khi P1.6 nối vào bước lưu sách vào DB
  const [confirmed, setConfirmed] = useState<ChapterDraft[] | null>(null);

  useEffect(() => {
    void load();
    // Main có thể đổi settings (ví dụ user chọn thư mục audio) → nhận event
    return window.api.settings.onChanged(applyExternal);
  }, [load, applyExternal]);

  return (
    <div className="flex h-full flex-col bg-bg text-fg">
      <TitleBar title="LN Reader" />

      <main className="flex flex-1 flex-col overflow-hidden">
        {error !== null ? (
          <p role="alert" className="p-8 text-center text-danger">
            {error}
          </p>
        ) : loading && settings === null ? (
          <p className="p-8 text-center text-fg-muted">Đang tải…</p>
        ) : confirmed !== null ? (
          <ConfirmedPanel chapters={confirmed} onBack={() => setConfirmed(null)} />
        ) : (
          <ImportScreen onConfirm={setConfirmed} />
        )}
      </main>
    </div>
  );
};

type ConfirmedPanelProps = {
  chapters: readonly ChapterDraft[];
  onBack: () => void;
};

/**
 * Màn tạm sau khi xác nhận cấu trúc.
 *
 * P1.5 dừng ở đây theo đúng phạm vi: lưu sách vào DB và dựng segment là việc
 * của P1.6. Hiện kết quả ra để kiểm chứng được luồng đã chạy đúng.
 */
const ConfirmedPanel = ({ chapters, onBack }: ConfirmedPanelProps): JSX.Element => (
  <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
    <h1 className="text-xl font-semibold text-fg">Đã xác nhận {chapters.length} chương</h1>
    <p className="max-w-md text-sm text-fg-muted">
      Bước lưu sách và tạo segment thuộc P1.6 — chưa nối vào đây.
    </p>
    <ol className="max-h-64 w-full max-w-md space-y-1 overflow-y-auto text-left text-sm">
      {chapters.map((chapter, i) => (
        <li key={chapter.id} className="flex gap-2 text-fg-muted">
          <span className="tabular-nums">{i + 1}.</span>
          <span className="truncate text-fg">{chapter.title}</span>
          <span className="ml-auto shrink-0 tabular-nums">
            {chapter.pageStart}–{chapter.pageEnd}
          </span>
        </li>
      ))}
    </ol>
    <button
      type="button"
      onClick={onBack}
      className="rounded px-3 py-1.5 text-sm text-fg-muted transition-colors hover:bg-bg-subtle hover:text-fg"
    >
      Quay lại
    </button>
  </div>
);
