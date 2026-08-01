import { useEffect, useState } from 'react';
import { TitleBar } from '@/features/titlebar/TitleBar';
import { ImportScreen } from '@/features/import/ImportScreen';
import { LibraryGrid } from '@/features/library/LibraryGrid';
import { BookDetailView } from '@/features/library/BookDetailView';
import { ReaderScreen } from '@/features/reader/ReaderScreen';
import { VoiceManager } from '@/features/voices/VoiceManager';
import { StorageManager } from '@/features/storage/StorageManager';
import { SettingsScreen } from '@/features/settings/SettingsScreen';
import { UpdateBanner } from '@/features/settings/UpdateBanner';
import { useSettingsStore } from '@/stores/settings-store';
import { useLibraryStore } from '@/stores/library-store';
import { useUpdateStore } from '@/stores/update-store';

/**
 * Điều hướng: thư viện → nhập sách → chi tiết sách → trình đọc.
 *
 * Chưa dùng router: ít màn, không có URL cần chia sẻ, và Electron không có
 * thanh địa chỉ. Thêm router lúc này là thêm phụ thuộc mà chưa cần.
 */
type Screen = 'library' | 'import' | 'voices' | 'storage' | 'settings';

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

  const updateStatus = useUpdateStore((s) => s.status);
  const updateDismissed = useUpdateStore((s) => s.dismissed);
  const loadUpdate = useUpdateStore((s) => s.load);
  const applyUpdate = useUpdateStore((s) => s.applyExternal);
  const downloadUpdate = useUpdateStore((s) => s.download);
  const installUpdate = useUpdateStore((s) => s.install);
  const dismissUpdate = useUpdateStore((s) => s.dismiss);

  const [screen, setScreen] = useState<Screen>('library');
  // Chương đang đọc. `null` = đang xem mục lục; `undefined` bên trong nghĩa là
  // mở chỗ đọc dở. Reset khi đóng sách để lần mở sau vào lại mục lục.
  const [reading, setReading] = useState<{ chapterId?: string } | null>(null);

  useEffect(() => {
    void load();
    // Main có thể đổi settings (ví dụ user chọn thư mục audio) → nhận event
    return window.api.settings.onChanged(applyExternal);
  }, [load, applyExternal]);

  useEffect(() => {
    // Đăng ký TRƯỚC khi nạp: lượt kiểm tự động ở main chạy sau 5 giây kể từ lúc
    // khởi động (P5.5b), nhưng không có gì bảo đảm renderer luôn sẵn sàng trước
    // mốc đó. Đăng ký sau `await` là để hở một khe mà event rơi vào là mất.
    const off = window.api.update.onStatusChanged(applyUpdate);
    void loadUpdate();
    return off;
  }, [loadUpdate, applyUpdate]);

  const body = (): JSX.Element => {
    if (opened !== null) {
      if (reading !== null) {
        return (
          <ReaderScreen
            detail={opened}
            {...(reading.chapterId === undefined ? {} : { startChapterId: reading.chapterId })}
            onBack={() => setReading(null)}
            onOpenVoices={() => {
              // Màn Giọng đọc chỉ hiện khi không có sách nào mở, nên đường tắt
              // từ thanh player phải đóng sách chứ không riêng đổi `screen`.
              // Đóng sách cũng là điều đúng: chọn giọng xong thì trình đọc phải
              // dựng lại để `voiceReady` có hiệu lực.
              setReading(null);
              closeBook();
              setScreen('voices');
            }}
          />
        );
      }

      return (
        <BookDetailView
          detail={opened}
          onBack={() => {
            setReading(null);
            closeBook();
          }}
          onRead={(chapterId) => setReading(chapterId === undefined ? {} : { chapterId })}
        />
      );
    }

    if (screen === 'voices') {
      return <VoiceManager onBack={() => setScreen('library')} />;
    }

    if (screen === 'storage') {
      return (
        <StorageManager
          onBack={() => {
            setScreen('library');
            // Xoá audio đổi `generateStatus` của chương — thư viện phải nạp lại,
            // nếu không grid vẫn hiện số cũ.
            void loadLibrary();
          }}
        />
      );
    }

    if (screen === 'settings') {
      return (
        <SettingsScreen
          onBack={() => setScreen('library')}
          onManageStorage={() => setScreen('storage')}
        />
      );
    }

    if (screen === 'import') {
      return (
        <ImportScreen
          onSaved={() => {
            // Quay về thư viện và nạp lại để thấy sách vừa thêm
            setScreen('library');
            void loadLibrary();
          }}
          onBack={() => setScreen('library')}
        />
      );
    }

    return (
      <LibraryGrid
        onImport={() => setScreen('import')}
        onManageVoices={() => setScreen('voices')}
        onManageStorage={() => setScreen('storage')}
        onOpenSettings={() => setScreen('settings')}
        onOpen={(bookId) => {
          void openBook(bookId);
        }}
      />
    );
  };

  return (
    <div className="flex h-full flex-col bg-bg text-fg">
      <TitleBar title="LN Reader" />

      {/*
        Ngoài `<main>` và `shrink-0`: dải này không được ăn vào chiều cao của
        vùng nội dung theo kiểu làm co ô cuộn — đó đúng là lỗi bố cục 4.43.
      */}
      <UpdateBanner
        status={updateStatus}
        dismissed={updateDismissed}
        onDownload={() => void downloadUpdate()}
        onInstall={() => void installUpdate()}
        onDismiss={dismissUpdate}
      />

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
