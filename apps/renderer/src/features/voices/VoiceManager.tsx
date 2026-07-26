import { useEffect } from 'react';
import type { BookLang } from '@ln/shared';
import { useVoiceStore } from '@/stores/voice-store';
import { useSettingsStore } from '@/stores/settings-store';
import { SidecarBadge } from './SidecarBadge';
import { VoiceRow } from './VoiceRow';

/**
 * Màn quản lý giọng đọc: xem catalog, tải, xoá.
 *
 * Đây là màn **đầu tiên thật sự cần sidecar sống**, nên cũng là chỗ đầu tiên
 * hiện trạng thái sidecar cho user (trước đó chỉ thấy trong log).
 *
 * Model **không** bundle vào installer mà tải runtime từ Hugging Face — xem
 * CLAUDE.md mục "Không làm".
 */

export type VoiceManagerProps = {
  onBack: () => void;
};

export const VoiceManager = ({ onBack }: VoiceManagerProps): JSX.Element => {
  const catalog = useVoiceStore((s) => s.catalog);
  const progress = useVoiceStore((s) => s.progress);
  const loading = useVoiceStore((s) => s.loading);
  const error = useVoiceStore((s) => s.error);
  const sidecar = useVoiceStore((s) => s.sidecar);
  const load = useVoiceStore((s) => s.load);
  const download = useVoiceStore((s) => s.download);
  const cancel = useVoiceStore((s) => s.cancel);
  const remove = useVoiceStore((s) => s.remove);
  const applyProgress = useVoiceStore((s) => s.applyProgress);
  const setSidecar = useVoiceStore((s) => s.setSidecar);
  const clearError = useVoiceStore((s) => s.clearError);

  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.update);

  /** Giọng đang chọn cho một ngôn ngữ. Rỗng = chưa chọn. */
  const selectedFor = (lang: BookLang): string =>
    (lang === 'vi' ? settings?.voiceVi : settings?.voiceEn) ?? '';

  const selectVoice = (lang: BookLang, voiceId: string): void => {
    void updateSettings(lang === 'vi' ? { voiceVi: voiceId } : { voiceEn: voiceId });
  };

  const removeVoice = (lang: BookLang, voiceId: string): void => {
    // Xoá voice đang chọn thì phải bỏ chọn luôn: để nguyên thì settings trỏ tới
    // model không còn trên đĩa, và hàng đợi chỉ báo lỗi tới lúc generate.
    if (selectedFor(lang) === voiceId) selectVoice(lang, '');
    void remove(voiceId);
  };

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    // Hai nguồn đẩy: tiến độ tải và trạng thái sidecar. Cả hai đều huỷ đăng ký
    // khi rời màn — thiếu là rò listener mỗi lần vào ra.
    const offProgress = window.api.voices.onDownloadProgress(applyProgress);
    const offStatus = window.api.sidecar.onStatusChanged(setSidecar);
    return () => {
      offProgress();
      offStatus();
    };
  }, [applyProgress, setSidecar]);

  // Tải model cần sidecar sống, nhưng **không** cần `engineReady` — engine chỉ
  // nạp ở P2.4, chặn theo nó thì không bao giờ tải được voice nào.
  const canDownload = sidecar?.state === 'ready';

  // Có voice đã cài mà ngôn ngữ của nó chưa chọn giọng nào
  const hasInstalledUnselected = catalog.some(
    (voice) => voice.installed && selectedFor(voice.lang) === '',
  );

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <button
            type="button"
            onClick={onBack}
            className="text-xs text-fg-muted transition-colors hover:text-fg"
          >
            ← Quay lại
          </button>
          <h1 className="mt-1 text-lg font-semibold text-fg">Giọng đọc</h1>
          <p className="mt-0.5 text-xs text-fg-muted">
            Model tải từ Hugging Face khi cần, không đi kèm bộ cài.
          </p>
        </div>
        <SidecarBadge status={sidecar} />
      </header>

      {error !== null && (
        <div
          role="alert"
          data-testid="voice-error"
          className="flex items-start justify-between gap-3 rounded-lg border border-danger p-3 text-sm text-danger"
          style={{ backgroundColor: 'rgb(var(--danger) / 0.08)' }}
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={clearError}
            aria-label="Đóng thông báo lỗi"
            className="shrink-0 text-xs underline"
          >
            Đóng
          </button>
        </div>
      )}

      {/*
        Cài rồi mà chưa bấm chọn là cái bẫy dễ gặp nhất: hàng đợi dừng ngay với
        "Chưa cài giọng đọc nào" trong khi màn này hiện rõ "Đã cài". Nhắc đúng ở
        chỗ sửa được.
      */}
      {hasInstalledUnselected && (
        <p data-testid="voice-unselected-hint" className="text-xs text-fg-muted">
          Đã cài giọng nhưng chưa chọn dùng. Bấm <strong className="text-fg">Dùng giọng này</strong>{' '}
          ở giọng bạn muốn, nếu không mọi lượt tạo audio sẽ dừng ngay.
        </p>
      )}

      {loading && catalog.length === 0 ? (
        <p className="text-sm text-fg-muted">Đang tải danh sách giọng đọc…</p>
      ) : catalog.length === 0 ? (
        <p className="text-sm text-fg-muted">
          Chưa có giọng đọc nào trong danh mục.
          {sidecar?.state !== 'ready' && ' Danh mục chỉ đọc được khi dịch vụ TTS đã chạy.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {catalog.map((voice) => (
            <VoiceRow
              key={voice.id}
              voice={voice}
              progress={progress[voice.id]}
              canDownload={canDownload}
              selected={selectedFor(voice.lang) === voice.id}
              onDownload={() => void download(voice.id)}
              onCancel={() => void cancel(voice.id)}
              onRemove={() => removeVoice(voice.lang, voice.id)}
              onSelect={() => selectVoice(voice.lang, voice.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
};
