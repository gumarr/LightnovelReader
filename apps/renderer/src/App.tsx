import { useEffect } from 'react';
import { TitleBar } from '@/features/titlebar/TitleBar';
import { useSettingsStore } from '@/stores/settings-store';
import { useTheme } from '@/features/theme/use-theme';
import { THEME_LABELS } from '@/lib/theme';

export const App = (): JSX.Element => {
  // Selector riêng từng field — tránh re-render khi field không dùng thay đổi
  const settings = useSettingsStore((s) => s.settings);
  const error = useSettingsStore((s) => s.error);
  const loading = useSettingsStore((s) => s.loading);
  const load = useSettingsStore((s) => s.load);
  const applyExternal = useSettingsStore((s) => s.applyExternal);
  const { mode, resolved } = useTheme();

  useEffect(() => {
    void load();
    // Main có thể đổi settings (ví dụ user chọn thư mục audio) → nhận event
    return window.api.settings.onChanged(applyExternal);
  }, [load, applyExternal]);

  return (
    <div className="flex h-full flex-col bg-bg text-fg">
      <TitleBar title="LN Reader" />

      <main className="flex flex-1 items-center justify-center p-8">
        {error !== null ? (
          <p role="alert" className="text-danger">
            {error}
          </p>
        ) : loading && settings === null ? (
          <p className="text-fg-muted">Đang tải…</p>
        ) : (
          <StatusPanel themeLabel={THEME_LABELS[mode]} resolved={resolved} />
        )}
      </main>
    </div>
  );
};

type StatusPanelProps = {
  themeLabel: string;
  resolved: string;
};

/** Màn hình tạm của Phase 0 — thay bằng Library ở Phase 1 */
const StatusPanel = ({ themeLabel, resolved }: StatusPanelProps): JSX.Element => (
  <div className="flex flex-col items-center gap-3 text-center">
    <h1 className="text-2xl font-semibold text-fg">LN Reader</h1>
    <p className="text-fg-muted">Đọc Light Novel với TTS local và phụ đề đồng bộ theo từ.</p>
    <p className="text-sm text-fg-muted">
      Giao diện: <span className="font-medium text-accent">{themeLabel}</span> (đang hiển thị{' '}
      {resolved})
    </p>
  </div>
);
