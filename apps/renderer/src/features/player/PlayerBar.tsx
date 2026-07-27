import { usePlayerStore } from '@/stores/player-store';
import {
  playButtonLabel,
  playerStateLabel,
  PLAYBACK_RATE_STEPS,
  rateLabel,
  skippedSummary,
} from './format';

/**
 * Thanh điều khiển player: phát/dừng, đoạn trước/sau, tốc độ.
 *
 * **Không** hiện thanh tiến độ theo ms ở đây. Vị trí phát đổi 60 lần/giây; đưa
 * vào state React là re-render cả cây mỗi khung hình, đúng thứ CLAUDE.md cấm.
 * Thanh chạy theo từng từ là việc của subtitle pane ở P3.4, vẽ bằng
 * `requestAnimationFrame` ghi thẳng vào DOM qua `ref`.
 *
 * Đoạn bỏ qua hiện thành **một dòng chữ nhỏ**, không phải hộp cảnh báo: user
 * đang nghe, không cần bấm gì, và chặn đường vì một đoạn hỏng là đúng thứ P3.2
 * sinh ra để tránh.
 */

export const PlayerBar = (): JSX.Element => {
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

  return (
    <div
      data-testid="player-bar"
      data-state={state}
      className="flex shrink-0 flex-col gap-1 border-t border-border bg-bg-elevated px-4 py-2"
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid="player-prev"
          onClick={() => void previous()}
          disabled={segmentId === null}
          title="Đoạn trước"
          aria-label="Đoạn trước"
          className="rounded border border-border px-2 py-1 text-sm text-fg transition-colors hover:bg-bg-subtle disabled:cursor-not-allowed disabled:opacity-40"
        >
          ⏮
        </button>

        <button
          type="button"
          data-testid="player-toggle"
          onClick={() => void toggle()}
          title={playButtonLabel(state)}
          aria-label={playButtonLabel(state)}
          className="rounded bg-accent px-3 py-1 text-sm font-medium text-accent-fg transition-opacity hover:opacity-90"
        >
          {isPlaying ? '⏸' : '▶'}
        </button>

        <button
          type="button"
          data-testid="player-next"
          onClick={() => void next()}
          title="Đoạn sau"
          aria-label="Đoạn sau"
          className="rounded border border-border px-2 py-1 text-sm text-fg transition-colors hover:bg-bg-subtle"
        >
          ⏭
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

        <div className="flex shrink-0 items-center gap-1">
          {PLAYBACK_RATE_STEPS.map((rate) => (
            <button
              key={rate}
              type="button"
              data-testid={`player-rate-${String(rate)}`}
              data-active={playbackRate === rate}
              onClick={() => void setRate(rate)}
              // CLAUDE.md: đổi tốc độ KHÔNG regenerate audio — playbackRate +
              // preservesPitch, xử lý trong `audio-element.ts`
              title={`Tốc độ ${rateLabel(rate)}`}
              className={
                playbackRate === rate
                  ? 'rounded bg-accent/10 px-1.5 py-0.5 text-xs font-medium text-accent'
                  : 'rounded px-1.5 py-0.5 text-xs text-fg-muted transition-colors hover:bg-bg-subtle hover:text-fg'
              }
            >
              {rateLabel(rate)}
            </button>
          ))}
        </div>
      </div>

      {summary !== undefined && (
        <p data-testid="player-skipped" className="truncate text-xs text-fg-muted">
          {summary}
        </p>
      )}
    </div>
  );
};
