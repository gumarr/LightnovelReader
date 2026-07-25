import {
  GlobalWorkerOptions,
  getDocument,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from 'pdfjs-dist/legacy/build/pdf.mjs';
// Vite copy worker vào bundle rồi trả URL đã băm. Không dùng CDN: app chạy
// offline, và `base: './'` khiến URL tương đối vẫn đúng ở bản đóng gói
// (giao thức `file:`).
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

/**
 * Nạp tài liệu PDF **trong renderer**.
 *
 * Renderer vẫn **không** chạm `fs`: bytes do main gửi qua `reader:getBookFile`.
 *
 * Dùng bản `legacy` chứ không phải bản thường, dù renderer là Chromium thật:
 * pdfjs 6 gọi thẳng `Uint8Array.prototype.toHex()` (ES2025), mà Electron 33
 * chạy Chromium 130 — API đó mãi Chromium 140 mới có. Bản thường nổ ngay khi
 * mở file với `a.toHex is not a function`; bản legacy có kiểm tra rồi mới bù.
 * Kiểm trên bản đóng gói, không phải suy đoán — xem PROGRESS mục 4.
 *
 * Lỗi `DOMMatrix` khiến bản legacy phiền phức ở main (mục 4.19) không xảy ra
 * ở đây: renderer có `DOMMatrix`/`Path2D` thật của Chromium.
 */

GlobalWorkerOptions.workerSrc = workerUrl;

export type LoadedPdf = {
  doc: PDFDocumentProxy;
  pageCount: number;
  /**
   * Giải phóng tài liệu **và** worker.
   *
   * `destroy()` nằm ở `PDFDocumentLoadingTask` chứ không phải proxy, nên phải
   * giữ task lại — bỏ qua bước này là mỗi lần mở sách lại bỏ rơi một worker.
   */
  destroy: () => Promise<void>;
};

export const loadPdf = async (bytes: ArrayBuffer): Promise<LoadedPdf> => {
  // pdfjs **chiếm quyền** buffer được truyền vào (chuyển sang worker) khiến nó
  // rỗng đi. Sao một bản để mở lại lần nữa vẫn còn dữ liệu.
  const copy = bytes.slice(0);
  const task = getDocument({ data: copy });
  const doc = await task.promise;

  return { doc, pageCount: doc.numPages, destroy: () => task.destroy() };
};

/** Kích thước trang ở scale 1 — dùng để dựng chỗ trống trước khi render */
export type PageSize = {
  width: number;
  height: number;
};

export const pageSizes = async (doc: PDFDocumentProxy): Promise<PageSize[]> => {
  const sizes: PageSize[] = [];

  for (let number = 1; number <= doc.numPages; number += 1) {
    const page = await doc.getPage(number);
    const viewport = page.getViewport({ scale: 1 });
    sizes.push({ width: viewport.width, height: viewport.height });
    // Nhả ngay: giữ 270 `PDFPageProxy` chỉ để biết kích thước là phí bộ nhớ
    page.cleanup();
  }

  return sizes;
};

/**
 * Scale để trang vừa bề ngang khung nhìn.
 *
 * Trừ hao lề hai bên rồi kẹp trần: trang khổ nhỏ phóng quá to thì chữ vỡ mà
 * canvas lại ngốn bộ nhớ vô ích.
 */
export const fitWidthScale = (
  pageWidth: number,
  containerWidth: number,
  margin = 32,
  maxScale = 2,
): number => {
  if (pageWidth <= 0 || containerWidth <= 0) return 1;
  const usable = Math.max(containerWidth - margin, 1);
  return Math.min(usable / pageWidth, maxScale);
};

export type RenderPageInput = {
  page: PDFPageProxy;
  canvas: HTMLCanvasElement;
  scale: number;
  /** `devicePixelRatio` — màn Retina cần canvas lớn hơn CSS pixel */
  pixelRatio: number;
};

/**
 * Vẽ một trang vào canvas.
 *
 * Trả về hàm huỷ: cuộn nhanh khiến trang bị gỡ giữa chừng, mà `RenderTask`
 * còn chạy sẽ vẽ đè lên canvas đã dùng cho trang khác.
 */
export const renderPage = ({
  page,
  canvas,
  scale,
  pixelRatio,
}: RenderPageInput): { done: Promise<void>; cancel: () => void } => {
  const viewport = page.getViewport({ scale });
  const context = canvas.getContext('2d');

  if (context === null) {
    return { done: Promise.resolve(), cancel: () => {} };
  }

  canvas.width = Math.floor(viewport.width * pixelRatio);
  canvas.height = Math.floor(viewport.height * pixelRatio);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;

  const task = page.render({
    canvas,
    canvasContext: context,
    viewport,
    // Màn Retina: phóng nội dung lên đúng tỉ lệ pixel thật. Màn thường bỏ hẳn
    // field vì kiểu của pdfjs chỉ nhận mảng hoặc `undefined`, không nhận `null`.
    ...(pixelRatio === 1 ? {} : { transform: [pixelRatio, 0, 0, pixelRatio, 0, 0] }),
  });

  return {
    done: task.promise,
    cancel: () => {
      task.cancel();
    },
  };
};
