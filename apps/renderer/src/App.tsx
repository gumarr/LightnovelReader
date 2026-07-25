import { useEffect, useState } from 'react';
import type { SaveBookResponse } from '@ln/shared';
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

  // Kết quả lưu sách. P1.6b thay chỗ này bằng màn Library.
  const [saved, setSaved] = useState<SaveBookResponse | null>(null);

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
        ) : saved !== null ? (
          <SavedPanel result={saved} onBack={() => setSaved(null)} />
        ) : (
          <ImportScreen onSaved={setSaved} />
        )}
      </main>
    </div>
  );
};

type SavedPanelProps = {
  result: SaveBookResponse;
  onBack: () => void;
};

/**
 * Màn tạm sau khi lưu sách.
 *
 * P1.6a dừng ở đây theo đúng phạm vi: Library grid và viewer là P1.6b/c.
 * Hiện số liệu thật lấy từ DB để kiểm chứng luồng đã chạy đúng.
 */
const SavedPanel = ({ result, onBack }: SavedPanelProps): JSX.Element => (
  <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
    <h1 className="text-xl font-semibold text-fg">
      {result.duplicate ? 'Sách này đã có trong thư viện' : 'Đã lưu vào thư viện'}
    </h1>

    {result.duplicate ? (
      <p className="max-w-md text-sm text-fg-muted">
        Cùng nội dung với một sách đã nhập trước đó, nên không tạo bản sao.
      </p>
    ) : (
      <p className="max-w-md text-sm text-fg-muted">
        <span className="font-medium text-fg">{result.chapterCount}</span> chương ·{' '}
        <span className="font-medium text-fg">{result.segmentCount}</span> segment đã sẵn sàng
        để generate audio.
      </p>
    )}

    <p className="max-w-md text-xs text-fg-muted">
      Màn thư viện và trình đọc thuộc P1.6b/c — chưa nối vào đây.
    </p>

    <button
      type="button"
      onClick={onBack}
      className="rounded px-3 py-1.5 text-sm text-fg-muted transition-colors hover:bg-bg-subtle hover:text-fg"
    >
      Nhập sách khác
    </button>
  </div>
);
