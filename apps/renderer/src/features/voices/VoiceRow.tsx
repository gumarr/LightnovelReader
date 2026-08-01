import type { VoiceCatalogItem, VoiceDownloadProgress } from '@ln/shared';
import {
  downloadPercent,
  engineNote,
  formatBytes,
  langLabel,
  voiceSpecLabel,
} from './format';

/**
 * Một dòng voice trong danh sách: thông tin + nút tải/xoá + thanh tiến trình.
 */

export type VoiceRowProps = {
  voice: VoiceCatalogItem;
  /** `undefined` = voice này không đang tải */
  progress: VoiceDownloadProgress | undefined;
  /** Chặn nút tải khi sidecar chưa sẵn sàng — tải cần sidecar sống */
  canDownload: boolean;
  /** Voice này đang được chọn cho ngôn ngữ của nó (`AppSettings.voiceVi/voiceEn`) */
  selected: boolean;
  /** Đang tổng hợp câu nghe thử cho voice này */
  previewing: boolean;
  /** Đang phát tiếng nghe thử của voice này */
  playing: boolean;
  onDownload: () => void;
  onCancel: () => void;
  onRemove: () => void;
  onSelect: () => void;
  onPreview: () => void;
};

export const VoiceRow = ({
  voice,
  progress,
  canDownload,
  selected,
  previewing,
  playing,
  onDownload,
  onCancel,
  onRemove,
  onSelect,
  onPreview,
}: VoiceRowProps): JSX.Element => {
  const downloading = progress !== undefined;
  // `totalBytes` của khung SSE đầu tiên có thể là 0 (sidecar chưa kịp đọc
  // catalog) — rơi về số trong catalog để thanh tiến trình không nhảy về 0.
  const total = progress?.totalBytes !== undefined && progress.totalBytes > 0
    ? progress.totalBytes
    : voice.totalBytes;
  const percent = downloading ? downloadPercent(progress.receivedBytes, total) : 0;
  const note = engineNote(voice.engine);

  return (
    <li
      data-testid="voice-row"
      data-voice-id={voice.id}
      data-installed={voice.installed}
      data-selected={selected}
      data-engine={voice.engine}
      className="flex flex-col gap-2 rounded-lg border border-border bg-bg-elevated p-3"
      // Viền nhấn cho giọng đang dùng: đây là thứ quyết định mọi lượt generate
      // sau đó, phải nhìn ra ngay chứ không phải đọc từng dòng chữ.
      style={selected ? { borderColor: 'rgb(var(--accent))' } : undefined}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-fg">
            {voice.name}
            <span className="ml-2 text-xs font-normal text-fg-muted">{langLabel(voice.lang)}</span>
          </p>
          <p className="mt-0.5 text-xs text-fg-muted">{voiceSpecLabel(voice)}</p>
          {note !== undefined && (
            <p data-testid="voice-engine-note" className="mt-0.5 text-xs text-fg-muted">
              {note}
            </p>
          )}
          <p className="mt-0.5 truncate text-xs text-fg-muted" title={voice.license}>
            Giấy phép: {voice.license}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {voice.installed && !downloading && (
            <span
              data-testid="voice-installed"
              className="rounded bg-bg-subtle px-2 py-0.5 text-xs text-fg-muted"
            >
              Đã cài
            </span>
          )}

          {/*
            Nghe thử đứng TRƯỚC "Dùng giọng này" vì đó là thứ tự user thật sự
            làm: nghe rồi mới quyết định chọn. Chỉ hiện với voice đã cài —
            nghe thử voice chưa tải thì không có model nào để tổng hợp.
          */}
          {voice.installed && !downloading && (
            <button
              type="button"
              onClick={onPreview}
              // Đang tổng hợp thì khoá nút: bấm lại lần nữa cũng bị store bỏ
              // qua, mà nút vẫn sáng thì user tưởng lần bấm đầu không ăn.
              disabled={previewing}
              data-testid="voice-preview"
              data-previewing={previewing}
              data-playing={playing}
              title={
                playing
                  ? 'Dừng nghe thử'
                  : 'Đọc thử một câu mẫu có tên riêng Nhật và chữ số'
              }
              className="rounded border border-border px-2.5 py-1 text-xs text-fg transition-colors hover:bg-bg-subtle disabled:cursor-not-allowed disabled:opacity-40"
            >
              {previewing ? 'Đang tạo…' : playing ? 'Dừng' : 'Nghe thử'}
            </button>
          )}

          {/*
            Chọn giọng chỉ có nghĩa khi voice đã nằm trên đĩa: chọn một voice
            chưa tải sẽ ghi vào settings một id mà hàng đợi không nạp được, và
            lỗi chỉ lộ ra lúc generate.
          */}
          {voice.installed &&
            !downloading &&
            (selected ? (
              <span
                data-testid="voice-selected"
                className="rounded px-2 py-0.5 text-xs font-medium text-accent-fg"
                style={{ backgroundColor: 'rgb(var(--accent))' }}
              >
                Đang dùng
              </span>
            ) : (
              <button
                type="button"
                onClick={onSelect}
                data-testid="voice-select"
                className="rounded border border-border px-2.5 py-1 text-xs text-fg transition-colors hover:bg-bg-subtle"
              >
                Dùng giọng này
              </button>
            ))}

          {downloading ? (
            <button
              type="button"
              onClick={onCancel}
              className="rounded border border-border px-2.5 py-1 text-xs text-fg transition-colors hover:border-danger hover:text-danger"
            >
              Huỷ
            </button>
          ) : voice.installed ? (
            <button
              type="button"
              onClick={onRemove}
              className="rounded border border-border px-2.5 py-1 text-xs text-fg transition-colors hover:border-danger hover:text-danger"
            >
              Xoá
            </button>
          ) : (
            <button
              type="button"
              onClick={onDownload}
              disabled={!canDownload}
              // Nói rõ vì sao nút mờ: nút disabled không kèm lý do là chỗ user
              // hay tưởng app hỏng.
              title={canDownload ? undefined : 'Chờ dịch vụ TTS khởi động xong'}
              className="rounded bg-accent px-2.5 py-1 text-xs font-medium text-accent-fg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Tải về
            </button>
          )}
        </div>
      </div>

      {downloading && (
        <div>
          <div
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Tiến độ tải ${voice.name}`}
            data-testid="voice-progress"
            className="h-1.5 w-full overflow-hidden rounded-full bg-bg-subtle"
          >
            <div
              className="h-full rounded-full transition-[width]"
              style={{ width: `${String(percent)}%`, backgroundColor: 'rgb(var(--accent))' }}
            />
          </div>
          <p className="mt-1 text-xs text-fg-muted">
            {progress.state === 'verifying'
              ? 'Đang kiểm tra tính toàn vẹn…'
              : `${formatBytes(progress.receivedBytes)} / ${formatBytes(total)} · ${String(percent)}%`}
          </p>
        </div>
      )}
    </li>
  );
};
