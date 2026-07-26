import { useEffect, useMemo, useRef, useState } from 'react';
import type { Segment } from '@ln/shared';
import { cumulativeOffsets, scrollTopFor, visibleRange } from './windowing';

/**
 * Danh sách segment của chương đang đọc, có ảo hoá.
 *
 * Chương lớn nhất đo trên sách thật là 1353 segment — render hết là hàng nghìn
 * node DOM cho một panel người dùng chỉ nhìn thấy chục dòng.
 */

/** Chiều cao cố định mỗi dòng. Ảo hoá cần biết trước, nên text bị cắt bằng CSS. */
const ROW_HEIGHT = 64;

/**
 * Màu + nhãn cho trạng thái audio của segment.
 *
 * Lấy từ CSS variable, không hardcode hex — xem CLAUDE.md mục Renderer. `pending`
 * trả `undefined`: chưa generate là trạng thái mặc định của gần như mọi segment,
 * gắn dấu cho tất cả thì dấu không còn nghĩa gì.
 */
const statusDot = (status: Segment['status']): { color: string; label: string } | undefined => {
  switch (status) {
    case 'ready':
      return { color: 'rgb(var(--accent))', label: 'Đã có audio' };
    case 'generating':
      return { color: 'rgb(var(--accent))', label: 'Đang tạo audio' };
    case 'queued':
      return { color: 'rgb(var(--fg-muted))', label: 'Đang chờ trong hàng đợi' };
    case 'error':
      return { color: 'rgb(var(--danger))', label: 'Tạo audio lỗi' };
    default:
      return undefined;
  }
};

export type SegmentListProps = {
  segments: readonly Segment[];
  activeSegmentId: string | null;
  onSelect: (segmentId: string) => void;
};

export const SegmentList = ({
  segments,
  activeSegmentId,
  onSelect,
}: SegmentListProps): JSX.Element => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const element = scrollRef.current;
    if (element === null) return;

    const measure = (): void => setHeight(element.clientHeight);
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  const offsets = useMemo(
    () => cumulativeOffsets(new Array<number>(segments.length).fill(ROW_HEIGHT)),
    [segments.length],
  );

  const range = useMemo(
    () => visibleRange({ offsets, scrollTop, viewportHeight: height, overscan: 3 }),
    [offsets, scrollTop, height],
  );

  const activeIndex = segments.findIndex((s) => s.id === activeSegmentId);

  // Segment đang đọc phải luôn nhìn thấy — Phase 2 audio sẽ tự đổi segment
  useEffect(() => {
    const element = scrollRef.current;
    if (element === null || activeIndex < 0) return;

    const target = scrollTopFor(offsets, activeIndex, height, element.scrollTop);
    if (target !== undefined) element.scrollTo({ top: target, behavior: 'smooth' });
  }, [activeIndex, offsets, height]);

  if (segments.length === 0) {
    return <p className="p-4 text-center text-sm text-fg-muted">Chương này chưa có đoạn nào.</p>;
  }

  return (
    <div
      ref={scrollRef}
      data-testid="segment-scroll"
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      className="h-full overflow-y-auto"
    >
      <div style={{ height: range.totalHeight, position: 'relative' }}>
        <ul style={{ transform: `translateY(${range.offsetTop}px)` }}>
          {segments.slice(range.start, range.end).map((segment, index) => {
            const isActive = segment.id === activeSegmentId;
            const dot = statusDot(segment.status);

            return (
              <li key={segment.id} style={{ height: ROW_HEIGHT }}>
                <button
                  type="button"
                  data-testid="segment-row"
                  data-active={isActive}
                  data-status={segment.status}
                  onClick={() => onSelect(segment.id)}
                  className={`flex h-full w-full items-start gap-2 border-b border-border px-3 py-2 text-left transition-colors ${
                    isActive ? 'bg-accent/10' : 'hover:bg-bg-subtle'
                  }`}
                >
                  <span className="w-8 shrink-0 pt-0.5 text-right text-xs tabular-nums text-fg-muted">
                    {range.start + index + 1}
                  </span>
                  <span
                    className={`line-clamp-2 flex-1 text-sm leading-snug ${
                      isActive ? 'text-fg' : 'text-fg-muted'
                    }`}
                  >
                    {segment.text}
                  </span>
                  {dot !== undefined && (
                    <span
                      data-testid="segment-status-dot"
                      title={dot.label}
                      aria-label={dot.label}
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                        segment.status === 'generating' ? 'animate-pulse' : ''
                      }`}
                      style={{ backgroundColor: dot.color }}
                    />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
};
