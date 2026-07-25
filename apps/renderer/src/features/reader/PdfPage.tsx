import { useEffect, useRef } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { Rect } from '@ln/shared';
import { renderPage } from './pdf-document';

/**
 * Một trang PDF: canvas + lớp phủ highlight.
 *
 * Chỉ mount khi trang nằm trong tầm nhìn (xem `PdfViewer`), nên `useEffect` ở
 * đây cũng chính là lúc bắt đầu vẽ.
 */

export type PdfPageProps = {
  doc: PDFDocumentProxy;
  /** Số trang 1-based, đúng như pdfjs đánh */
  pageNumber: number;
  scale: number;
  width: number;
  height: number;
  /** Vùng của segment đang chọn, toạ độ trong không gian trang (scale 1) */
  highlights: readonly Rect[];
};

export const PdfPage = ({
  doc,
  pageNumber,
  scale,
  width,
  height,
  highlights,
}: PdfPageProps): JSX.Element => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;

    let cancelled = false;
    let cancelRender: (() => void) | undefined;

    void (async () => {
      const page = await doc.getPage(pageNumber);

      // Cuộn nhanh khiến trang bị gỡ trước khi `getPage` xong — vẽ tiếp là vẽ
      // lên canvas đã tháo khỏi DOM.
      if (cancelled) {
        page.cleanup();
        return;
      }

      const { done, cancel } = renderPage({
        page,
        canvas,
        scale,
        pixelRatio: window.devicePixelRatio,
      });
      cancelRender = cancel;

      try {
        await done;
      } catch {
        // `RenderTask.cancel()` làm promise reject — đó là đường đi bình thường
        // khi user cuộn, không phải lỗi cần báo.
      } finally {
        page.cleanup();
      }
    })();

    return () => {
      cancelled = true;
      cancelRender?.();
    };
  }, [doc, pageNumber, scale]);

  return (
    <div
      data-testid="pdf-page"
      data-page={pageNumber}
      className="relative mx-auto bg-white shadow-sm"
      style={{ width, height }}
    >
      <canvas ref={canvasRef} className="block" />

      {highlights.map((rect, index) => (
        <span
          key={`${rect.x}-${rect.y}-${index}`}
          data-testid="pdf-highlight"
          aria-hidden="true"
          // Neo lưu toạ độ trong không gian trang, gốc góc TRÊN-trái — nhân
          // scale là ra vị trí trên canvas, không phải lật trục.
          //
          // Không dùng `mix-blend-multiply`: trang PDF nền trắng, nhân với một
          // lớp phủ nhạt gần như không đổi gì — kiểm trên bản đóng gói thì ô
          // highlight vô hình. Phủ thẳng màu mờ 28% thì thấy rõ mà chữ vẫn đọc được.
          className="pointer-events-none absolute rounded-sm bg-accent/[0.28]"
          style={{
            left: rect.x * scale,
            top: rect.y * scale,
            width: rect.width * scale,
            height: rect.height * scale,
          }}
        />
      ))}
    </div>
  );
};
