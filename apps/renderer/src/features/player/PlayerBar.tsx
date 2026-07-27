import { usePlayerStore } from '@/stores/player-store';
import { playButtonLabel, playerStateLabel, skippedSummary } from './format';
import { NextIcon, PauseIcon, PlayIcon, PreviousIcon } from './icons';
import { RateMenu } from './RateMenu';
import { SegmentProgress } from './SegmentProgress';

/**
 * Thanh điều khiển player: phát/dừng, đoạn trước/sau, tốc độ, tiến độ trong đoạn.
 *
 * Thanh tiến độ và đồng hồ **không** đi qua state React — `SegmentProgress` ghi
 * thẳng vào DOM trong `requestAnimationFrame`. Vị trí phát đổi 60 lần/giây; đưa
 * vào state là re-render cả cây mỗi khung hình, đúng thứ CLAUDE.md cấm. Thanh
 * chạy theo **từng từ** là việc của subtitle pane ở P3.4, dùng chung khuôn mẫu.
 *
 * Đoạn bỏ qua hiện thành **một dòng chữ nhỏ**, không phải hộp cảnh báo: user
 * đang nghe, không cần bấm gì, và chặn đường vì một đoạn hỏng là đúng thứ P3.2
 * sinh ra để tránh.
 */

export type PlayerBarProps = {
  /**
   * Chưa chọn giọng đọc cho sách này — player không tự sinh audio được.
   *
   * `undefined` nghĩa là người gọi không quản chuyện giọng đọc (chỗ khác dùng
   * lại thanh này), khác với `false` nghĩa là đã chọn rồi.
   */
  voiceReady?: boolean;
  /** Đưa user tới màn Giọng đọc. Không có thì không hiện đường tắt. */
  onOpenVoices?: () => void;
};

export const PlayerBar = ({ voiceReady, onOpenVoices }: PlayerBarProps = {}): JSX.Element => {
  const state = usePlayerStore((s) => s.state);
  const segmentId = usePlayerStore((s) => s.segmentId);
  const playbackRate = usePlayerStore((s) => s.playbackRate);
  const skipped = usePlayerStore((s) => s.skipped);

  const toggle = usePlayerStore((s) => s.toggle);
  const next = usePlayerStore((s) => s.next);
  const previous = usePlayerStore((s) => s.previous);
  const setRate = usePlayerStore((s) => s.setRate);

  const summary = skippedSummary(skipped);
  const isPlaying = state === 'playing';
  const isWaiting = state === 'waiting';
  const needsVoice = voiceReady === false;

  return (
    <div
      data-testid="player-bar"
      data-state={state}
      className="flex shrink-0 flex-col gap-1.5 border-t border-border bg-bg-elevated px-4 py-2"
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid="player-prev"
          onClick={() => void previous()}
          disabled={segmentId === null}
          title="Đoạn trước (J)"
          aria-label="Đoạn trước"
          className="rounded border border-border p-1.5 text-fg transition-colors hover:bg-bg-subtle disabled:cursor-not-allowed disabled:opacity-40"
        >
          <PreviousIcon />
        </button>

        <button
          type="button"
          data-testid="player-toggle"
          data-playing={isPlaying}
          onClick={() => void toggle()}
          title={`${playButtonLabel(state)} (Space)`}
          aria-label={playButtonLabel(state)}
          className="rounded bg-accent p-1.5 text-accent-fg transition-opacity hover:opacity-90"
        >
          {isPlaying ? <PauseIcon /> : <PlayIcon />}
        </button>

        <button
          type="button"
          data-testid="player-next"
          onClick={() => void next()}
          title="Đoạn sau (K)"
          aria-label="Đoạn sau"
          className="rounded border border-border p-1.5 text-fg transition-colors hover:bg-bg-subtle"
        >
          <NextIcon />
        </button>

        <p data-testid="player-state" className="min-w-0 flex-1 truncate text-xs text-fg-muted">
          {playerStateLabel(state)}
          {isWaiting && (
            // Chấm nhấp nháy để phân biệt "đang chờ" với "treo" — chữ đứng im
            // một mình thì không nói được điều đó
            <span
              data-testid="player-waiting-dot"
              className="ml-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent align-middle"
            />
          )}
        </p>

        <RateMenu rate={playbackRate} onSelect={(rate) => void setRate(rate)} />
      </div>

      <SegmentProgress />

      {needsVoice && (
        // Chưa chọn giọng thì mọi lượt phát đều dừng ở "đang tạo audio" mãi —
        // nói ngay tại thanh player kèm đường đi thẳng tới chỗ sửa, thay vì để
        // user tự mò ra màn Giọng đọc.
        <p data-testid="player-no-voice" className="flex items-center gap-1.5 text-xs text-danger">
          <span className="min-w-0 truncate">Chưa chọn giọng đọc — không tạo được audio.</span>
          {onOpenVoices !== undefined && (
            <button
              type="button"
              data-testid="player-open-voices"
              onClick={onOpenVoices}
              className="shrink-0 underline transition-opacity hover:opacity-80"
            >
              Chọn giọng
            </button>
          )}
        </p>
      )}

      {summary !== undefined && (
        <p data-testid="player-skipped" className="truncate text-xs text-fg-muted">
          {summary}
        </p>
      )}
    </div>
  );
};
