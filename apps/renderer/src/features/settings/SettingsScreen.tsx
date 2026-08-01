import { useEffect, useState } from 'react';
import {
  DEFAULT_SETTINGS,
  SUBTITLE_FONT_SIZE_MAX,
  SUBTITLE_FONT_SIZE_MIN,
  SUBTITLE_FONT_SIZE_STEP,
  type AppInfo,
} from '@ln/shared';
import { useSettingsStore } from '@/stores/settings-store';
import { useUpdateStore } from '@/stores/update-store';
import { SubtitleFontSetting } from './SubtitleFontSetting';
import { UpdatePanel } from './UpdatePanel';
import { AppInfoPanel } from './AppInfoPanel';

/**
 * Màn Cài đặt (P5.3 — plan.md Phase 5).
 *
 * Trước màn này, thiết lập của app nằm rải ba chỗ: theme ở titlebar, thư mục
 * audio / bitrate / ngưỡng ở trong Storage Manager, còn cỡ chữ phụ đề thì **có
 * trong settings mà không màn nào đọc** — một setting chết từ Phase 0.
 *
 * **Không gom hết về đây.** Thư mục audio, bitrate và ngưỡng cảnh báo vẫn ở
 * Storage Manager: đó là chỗ user đang nhìn con số dung lượng và muốn đổi nó
 * ngay. Bê sang đây là bắt user nhảy màn để làm một việc. Màn này lo phần
 * **đọc** — thứ Storage Manager không có chỗ nói tới.
 */

export type SettingsScreenProps = {
  onBack: () => void;
  /** Mở Storage Manager — chỗ thật sự chỉnh dung lượng */
  onManageStorage: () => void;
};

export const SettingsScreen = ({
  onBack,
  onManageStorage,
}: SettingsScreenProps): JSX.Element => {
  const settings = useSettingsStore((s) => s.settings);
  const error = useSettingsStore((s) => s.error);
  const update = useSettingsStore((s) => s.update);

  const updateStatus = useUpdateStore((s) => s.status);
  const updateError = useUpdateStore((s) => s.error);
  const checkUpdate = useUpdateStore((s) => s.check);
  const downloadUpdate = useUpdateStore((s) => s.download);
  const installUpdate = useUpdateStore((s) => s.install);

  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    // Thông tin phiên bản chỉ để hiện — hỏng thì bỏ trống chứ không chặn cả
    // màn hình, vì mọi thiết lập bên trên vẫn dùng được bình thường.
    void (async () => {
      try {
        const result = await window.api.app.getInfo();
        if (result.ok) setInfo(result.data);
      } catch {
        // Giữ `null` → panel tự ẩn
      }
    })();
  }, []);

  const fontSize = settings?.subtitleFontSize ?? DEFAULT_SETTINGS.subtitleFontSize;

  return (
    <section
      data-testid="settings-screen"
      className="mx-auto flex w-full max-w-3xl flex-col gap-4 overflow-y-auto p-6"
    >
      <header>
        <button
          type="button"
          data-testid="settings-back"
          onClick={onBack}
          className="text-xs text-fg-muted transition-colors hover:text-fg"
        >
          ← Quay lại
        </button>
        <h1 className="mt-1 text-lg font-semibold text-fg">Cài đặt</h1>
        <p className="mt-0.5 text-xs text-fg-muted">
          Giao diện đổi ở nút góc trên bên phải cửa sổ.
        </p>
      </header>

      {error !== null && (
        <p role="alert" data-testid="settings-error" className="text-sm text-danger">
          {error}
        </p>
      )}

      {/*
        Lỗi đường IPC của cập nhật hiện riêng: nó không phải lỗi lưu settings, và
        gộp vào một ô sẽ khiến "không kiểm được bản mới" trông như "không lưu
        được cỡ chữ".
      */}
      {updateError !== null && (
        <p role="alert" data-testid="update-error" className="text-sm text-danger">
          {updateError}
        </p>
      )}

      <SubtitleFontSetting
        value={fontSize}
        min={SUBTITLE_FONT_SIZE_MIN}
        max={SUBTITLE_FONT_SIZE_MAX}
        step={SUBTITLE_FONT_SIZE_STEP}
        onChange={(subtitleFontSize) => void update({ subtitleFontSize })}
      />

      {/*
        Đường tắt chứ không phải bản sao: dung lượng có màn riêng với số liệu
        thật (quét đĩa, xoá theo chương). Dựng lại vài ô ở đây sẽ thành hai chỗ
        chỉnh cùng một thứ mà chỉ một chỗ hiện hậu quả.
      */}
      <section className="flex items-center justify-between gap-3 rounded-lg border border-border bg-bg-elevated p-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-fg">Dung lượng &amp; audio</h2>
          <p className="mt-0.5 text-xs text-fg-muted">
            Thư mục lưu, chất lượng audio, ngưỡng cảnh báo và xoá audio đã tạo.
          </p>
        </div>
        <button
          type="button"
          onClick={onManageStorage}
          data-testid="settings-open-storage"
          className="shrink-0 rounded border border-border px-3 py-1.5 text-xs text-fg transition-colors hover:bg-bg-subtle"
        >
          Mở
        </button>
      </section>

      {/*
        Đặt ngay trên "Về ứng dụng": user vào đây nhìn số phiên bản rồi mới hỏi
        "có bản mới chưa" — hai ô đó thuộc cùng một câu hỏi.
      */}
      <UpdatePanel
        status={updateStatus}
        autoCheck={settings?.autoCheckUpdates ?? DEFAULT_SETTINGS.autoCheckUpdates}
        onCheck={() => void checkUpdate()}
        onDownload={() => void downloadUpdate()}
        onInstall={() => void installUpdate()}
        onAutoCheckChange={(autoCheckUpdates) => void update({ autoCheckUpdates })}
      />

      {info !== null && <AppInfoPanel info={info} />}
    </section>
  );
};
