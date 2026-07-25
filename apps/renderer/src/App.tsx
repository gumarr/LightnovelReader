import { useEffect, useState } from 'react';
import { TitleBar } from '@/features/titlebar/TitleBar';
import { ImportScreen } from '@/features/import/ImportScreen';
import { LibraryGrid } from '@/features/library/LibraryGrid';
import { BookDetailView } from '@/features/library/BookDetailView';
import { useSettingsStore } from '@/stores/settings-store';
import { useLibraryStore } from '@/stores/library-store';

/**
 * Điều hướng giữa ba màn: thư viện → nhập sách → chi tiết sách.
 *
 * Chưa dùng router: ba màn, không có URL cần chia sẻ, và Electron không có
 * thanh địa chỉ. Thêm router lúc này là thêm phụ thuộc mà chưa cần.
 */
type Screen = 'library' | 'import';

export const App = (): JSX.Element => {
  // Selector riêng từng field — tránh re-render khi field không dùng thay đổi
  const settings = useSettingsStore((s) => s.settings);
  const error = useSettingsStore((s) => s.error);
  const loading = useSettingsStore((s) => s.loading);
  const load = useSettingsStore((s) => s.load);
  const applyExternal = useSettingsStore((s) => s.applyExternal);

  const opened = useLibraryStore((s) => s.opened);
  const openBook = useLibraryStore((s) => s.open);
  const closeBook = useLibraryStore((s) => s.close);
  const loadLibrary = useLibraryStore((s) => s.load);

  const [screen, setScreen] = useState<Screen>('library');

  useEffect(() => {
    void load();
    // Main có thể đổi settings (ví dụ user chọn thư mục audio) → nhận event
    return window.api.settings.onChanged(applyExternal);
  }, [load, applyExternal]);

  const body = (): JSX.Element => {
    if (opened !== null) {
      return <BookDetailView detail={opened} onBack={closeBook} />;
    }

    if (screen === 'import') {
      return (
        <ImportScreen
          onSaved={() => {
            // Quay về thư viện và nạp lại để thấy sách vừa thêm
            setScreen('library');
            void loadLibrary();
          }}
        />
      );
    }

    return (
      <LibraryGrid
        onImport={() => setScreen('import')}
        onOpen={(bookId) => {
          void openBook(bookId);
        }}
      />
    );
  };

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
        ) : (
          body()
        )}
      </main>
    </div>
  );
};
