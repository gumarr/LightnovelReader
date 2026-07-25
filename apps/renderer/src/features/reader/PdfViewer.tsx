import { useEffect, useMemo, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { Rect, Segment } from '@ln/shared';
import { PdfPage } from './PdfPage';
import { fitWidthScale, pageSizes, type PageSize } from './pdf-document';
import { cumulativeOffsets, scrollTopFor, visibleRange } from './windowing';

/**
 * Viewer PDF: cuộn liên tục, chỉ render trang trong tầm nhìn.
 *
 * Sách 270 trang mà render hết thì mỗi canvas vài MB — hết bộ nhớ ngay. Trang
 * ngoài tầm nhìn giữ đúng chỗ trống bằng chiều cao thật nên thanh cuộn không
 * nhảy khi trang được vẽ.
 */

/** Khoảng cách giữa hai trang */
const PAGE_GAP = 16;

export type PdfViewerProps = {
  doc: PDFDocumentProxy;
  /** Segment đang chọn — quyết định cuộn tới đâu và tô vùng nào */
  activeSegment: Segment | undefined;
};

export const PdfViewer = ({ doc, activeSegment }: PdfViewerProps): JSX.Element => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [sizes, setSizes] = useState<PageSize[]>([]);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });

  // Đo kích thước mọi trang một lần: cần biết trước để dựng chỗ trống đúng,
  // nếu không thanh cuộn sẽ co giãn loạn khi trang lần lượt được vẽ.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const measured = await pageSizes(doc);
      if (!cancelled) setSizes(measured);
    })();

    return () => {
      cancelled = true;
    };
  }, [doc]);

  // Theo dõi kích thước khung: đổi cỡ cửa sổ phải tính lại scale vừa bề ngang
  useEffect(() => {
    const element = scrollRef.current;
    if (element === null) return;

    const measure = (): void => {
      setViewport({ width: element.clientWidth, height: element.clientHeight });
    };
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  // Trang đầu quyết định scale cho cả sách: đổi scale giữa chừng làm chiều cao
  // mọi trang thay đổi, thanh cuộn nhảy và mất chỗ đang đọc.
  const scale = useMemo(
    () => fitWidthScale(sizes[0]?.width ?? 0, viewport.width),
    [sizes, viewport.width],
  );

  const offsets = useMemo(
    () => cumulativeOffsets(sizes.map((size) => size.height * scale + PAGE_GAP)),
    [sizes, scale],
  );

  const range = useMemo(
    () => visibleRange({ offsets, scrollTop, viewportHeight: viewport.height, overscan: 1 }),
    [offsets, scrollTop, viewport.height],
  );

  // Neo PDF là 1-based như pdfjs; `rects` chỉ tô lên đúng trang của nó
  const anchor = activeSegment?.anchor;
  const activePage = anchor?.kind === 'pdf' ? anchor.page : undefined;
  const activeRects: readonly Rect[] = anchor?.kind === 'pdf' ? anchor.rects : [];

  // Cuộn tới trang chứa segment đang chọn
  useEffect(() => {
    const element = scrollRef.current;
    if (element === null || activePage === undefined || offsets.length <= 1) return;

    const target = scrollTopFor(offsets, activePage - 1, viewport.height, element.scrollTop);
    if (target !== undefined) element.scrollTo({ top: target, behavior: 'smooth' });
  }, [activePage, offsets, viewport.height]);

  if (sizes.length === 0) {
    return <p className="p-8 text-center text-fg-muted">Đang dựng trang…</p>;
  }

  return (
    <div
      ref={scrollRef}
      data-testid="pdf-scroll"
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      className="h-full overflow-y-auto bg-bg-subtle"
    >
      <div style={{ height: range.totalHeight, position: 'relative' }}>
        <div style={{ transform: `translateY(${range.offsetTop}px)` }}>
          {sizes.slice(range.start, range.end).map((size, index) => {
            const pageNumber = range.start + index + 1;

            return (
              <div key={pageNumber} style={{ paddingBottom: PAGE_GAP }}>
                <PdfPage
                  doc={doc}
                  pageNumber={pageNumber}
                  scale={scale}
                  width={size.width * scale}
                  height={size.height * scale}
                  highlights={pageNumber === activePage ? activeRects : []}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
