import { formatBytes, formatDuration } from '@ln/shared';
import { useBookmarkStore } from '@/stores/bookmark-store';
import { audioPercent, lastOpenedLabel, positionLabel, readPercent } from './stats-format';

/**
 * Thống kê đọc của sách đang mở (P5.4).
 *
 * **Hai thanh riêng, không gộp**: tiến độ *đọc* và tiến độ *generate audio* là
 * hai chuyện khác nhau và thường lệch nhau nhiều — đọc tới chương 2 mà đã
 * generate cả sách, hoặc ngược lại.
 *
 * `stats === null` nghĩa là chưa nạp xong hoặc kênh thống kê hỏng. Ẩn hẳn khối
 * này chứ không hiện số 0: "chưa biết" và "bằng 0" phải trông khác nhau.
 */

/** Một dòng nhãn — giá trị. Tách ra vì khối này lặp 5 lần */
const Row = ({ label, value }: { label: string; value: string }): JSX.Element => (
  <div className="flex items-baseline justify-between gap-2 text-xs">
    <span className="shrink-0 text-fg-muted">{label}</span>
    <span className="truncate text-right text-fg">{value}</span>
  </div>
);

/**
 * Thanh tiến độ. `percent` đã được kẹp về [0,100] ở `stats-format`.
 *
 * Màu đặt qua `style` với `rgb(var(--…))`, đúng lối `QueueProgress` đang dùng —
 * **không** bịa token Tailwind mới. Chỉ có 11 màu trong `tailwind.config.js`;
 * viết `bg-success` cho ra class không tồn tại, và lỗi đó trong suốt chứ không
 * đỏ ở đâu cả (PROGRESS mục 4.23).
 */
const Bar = ({
  percent,
  testId,
  cssVar,
}: {
  percent: number;
  testId: string;
  cssVar: '--accent' | '--subtitle-past';
}): JSX.Element => (
  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-bg-subtle">
    <div
      data-testid={testId}
      className="h-full rounded-full"
      style={{ width: `${String(percent)}%`, backgroundColor: `rgb(var(${cssVar}))` }}
    />
  </div>
);

export const ReadingStatsPanel = (): JSX.Element | null => {
  const stats = useBookmarkStore((s) => s.stats);

  if (stats === null) return null;

  return (
    <section data-testid="reading-stats" aria-label="Thống kê đọc" className="space-y-2 p-3">
      <div>
        <Row label="Đã đọc" value={`${String(readPercent(stats))}%`} />
        <Bar percent={readPercent(stats)} testId="reading-progress-bar" cssVar="--accent" />
      </div>

      <Row label="Vị trí" value={positionLabel(stats)} />
      <Row
        label="Chương"
        value={`${String(stats.chaptersRead)}/${String(stats.chapterCount)} đọc xong`}
      />

      <div>
        <Row
          label="Đã tạo audio"
          value={`${String(stats.segmentsWithAudio)}/${String(stats.segmentCount)} đoạn`}
        />
        <Bar percent={audioPercent(stats)} testId="audio-progress-bar" cssVar="--subtitle-past" />
      </div>

      {/*
        Thời lượng và dung lượng chỉ có nghĩa khi đã generate gì đó. Hiện
        "0:00 · 0 B" cho sách chưa generate là hai dòng nhiễu không nói thêm gì.
      */}
      {stats.segmentsWithAudio > 0 ? (
        <Row
          label="Audio"
          value={`${formatDuration(stats.audioDurationMs)} · ${formatBytes(stats.audioBytes)}`}
        />
      ) : null}

      <Row label="Dấu trang" value={String(stats.bookmarkCount)} />
      <Row label="Mở gần nhất" value={lastOpenedLabel(stats)} />
    </section>
  );
};
