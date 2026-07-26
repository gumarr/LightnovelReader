import { AUDIO_BITRATES, formatBytes, type AudioBitrate } from '@ln/shared';

/**
 * Thiết lập ảnh hưởng trực tiếp tới dung lượng: thư mục lưu, bitrate, ngưỡng
 * cảnh báo. Đặt ngay trong Storage Manager vì đây là chỗ user đang xem con số và
 * muốn thay đổi nó.
 *
 * **Đổi bitrate không sửa audio đã có.** File cũ giữ nguyên bitrate lúc sinh ra;
 * chỉ segment tạo sau mới theo giá trị mới. Nói rõ chứ không để user tưởng đổi
 * xuống 16 kbps là tự nhiên nhẹ đi một nửa.
 */

/** Ngưỡng chọn được. 0 = tắt cảnh báo, dành cho người có ổ rất lớn */
const WARN_CHOICES = [0, 2, 5, 10, 20, 50].map((gb) => gb * 1024 ** 3);

export type StorageSettingsProps = {
  audioDir: string;
  bitrate: AudioBitrate;
  warnBytes: number;
  onPickAudioDir: () => void;
  onChangeBitrate: (bitrate: AudioBitrate) => void;
  onChangeWarnBytes: (bytes: number) => void;
};

export const StorageSettings = ({
  audioDir,
  bitrate,
  warnBytes,
  onPickAudioDir,
  onChangeBitrate,
  onChangeWarnBytes,
}: StorageSettingsProps): JSX.Element => (
  <section className="flex flex-col gap-3 rounded-lg border border-border bg-bg-elevated p-3">
    <h2 className="text-sm font-semibold text-fg">Thiết lập</h2>

    <div className="flex items-center gap-3">
      <span className="w-32 shrink-0 text-xs text-fg-muted">Thư mục audio</span>
      <code
        data-testid="storage-audio-dir"
        title={audioDir}
        className="min-w-0 flex-1 truncate rounded bg-bg-subtle px-2 py-1 text-xs text-fg"
      >
        {audioDir}
      </code>
      <button
        type="button"
        onClick={onPickAudioDir}
        data-testid="storage-pick-dir"
        className="shrink-0 rounded border border-border px-2 py-1 text-xs text-fg transition-colors hover:bg-bg-subtle"
      >
        Đổi…
      </button>
    </div>

    {/* Đổi thư mục KHÔNG di chuyển file cũ — audio đã sinh vẫn nằm ở chỗ cũ và
        sẽ hiện thành "chưa có audio". Cảnh báo trước thay vì để user tự phát
        hiện sau khi đã đổi. */}
    <p className="text-xs text-fg-muted">
      Đổi thư mục không di chuyển audio đã tạo. File cũ vẫn ở thư mục trước đó — chép sang tay hoặc
      tạo lại.
    </p>

    <div className="flex items-center gap-3">
      <label htmlFor="storage-bitrate" className="w-32 shrink-0 text-xs text-fg-muted">
        Chất lượng audio
      </label>
      <select
        id="storage-bitrate"
        value={bitrate}
        onChange={(e) => onChangeBitrate(Number(e.target.value) as AudioBitrate)}
        className="rounded border border-border bg-bg px-2 py-1 text-xs text-fg"
      >
        {AUDIO_BITRATES.map((rate) => (
          <option key={rate} value={rate}>
            {rate} kbps
          </option>
        ))}
      </select>
      <span className="text-xs text-fg-muted">Chỉ áp dụng cho audio tạo sau này.</span>
    </div>

    <div className="flex items-center gap-3">
      <label htmlFor="storage-warn" className="w-32 shrink-0 text-xs text-fg-muted">
        Cảnh báo khi vượt
      </label>
      <select
        id="storage-warn"
        value={warnBytes}
        onChange={(e) => onChangeWarnBytes(Number(e.target.value))}
        className="rounded border border-border bg-bg px-2 py-1 text-xs text-fg"
      >
        {WARN_CHOICES.map((bytes) => (
          <option key={bytes} value={bytes}>
            {bytes === 0 ? 'Không cảnh báo' : formatBytes(bytes)}
          </option>
        ))}
      </select>
    </div>
  </section>
);
