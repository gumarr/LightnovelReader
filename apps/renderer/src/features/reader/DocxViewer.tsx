import { useEffect, useRef } from 'react';
import type { BookHtml, Segment } from '@ln/shared';
import { blockIndexOf, findBlockElement } from './docx-anchor';

/**
 * Viewer DOCX: render HTML đã sanitize ở main, highlight khối chứa segment.
 *
 * Không ảo hoá: DOCX là HTML thuần nên trình duyệt tự lo, và sách thật đo được
 * 386 khối — không đủ nhiều để cần cắt lát như canvas PDF.
 */

export type DocxViewerProps = {
  content: BookHtml;
  activeSegment: Segment | undefined;
};

/** Lớp CSS đánh dấu khối đang đọc. Màu lấy từ biến, không hardcode. */
const ACTIVE_CLASS = 'ln-active-block';

export const DocxViewer = ({ content, activeSegment }: DocxViewerProps): JSX.Element => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const blockIndex = blockIndexOf(activeSegment?.anchor);

  useEffect(() => {
    const root = contentRef.current;
    if (root === null) return;

    // Gỡ dấu cũ trước: đổi segment mà không gỡ thì cả sách dần sáng hết
    for (const marked of root.querySelectorAll(`.${ACTIVE_CLASS}`)) {
      marked.classList.remove(ACTIVE_CLASS);
    }

    if (blockIndex === undefined) return;

    const target = findBlockElement(root, blockIndex);
    if (target === null) return;

    target.classList.add(ACTIVE_CLASS);
    // `nearest` để khối đã nằm trong khung thì không cuộn — giữ chỗ đang đọc
    target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [blockIndex, content.html]);

  return (
    <div ref={scrollRef} data-testid="docx-scroll" className="h-full overflow-y-auto bg-bg">
      <div
        ref={contentRef}
        data-testid="docx-content"
        className="ln-docx mx-auto max-w-2xl px-8 py-10 text-fg"
        // HTML đã được sanitize ở main (`services/docx-html.ts`): chỉ còn thẻ
        // văn bản trong danh sách trắng, mọi thuộc tính bị bỏ.
        dangerouslySetInnerHTML={{ __html: content.html }}
      />
    </div>
  );
};
