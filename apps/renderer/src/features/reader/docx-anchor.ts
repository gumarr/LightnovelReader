import type { SegmentAnchor } from '@ln/shared';

/**
 * Đọc neo DOCX.
 *
 * `nodePath` có dạng `"p:<index>"`, trong đó `index` là thứ tự khối `<p>`/
 * `<h1..6>` mammoth sinh ra — cùng thứ tự mà main gắn `data-block` (xem
 * `services/docx-html.ts` bên main).
 */

/** `undefined` khi neo không phải DOCX hoặc chuỗi sai dạng */
export const blockIndexOf = (anchor: SegmentAnchor | undefined): number | undefined => {
  if (anchor === undefined || anchor.kind !== 'docx') return undefined;

  const match = /^p:(\d+)$/.exec(anchor.nodePath);
  if (match === null) return undefined;

  const index = Number(match[1]);
  return Number.isSafeInteger(index) ? index : undefined;
};

/**
 * Tra phần tử khối theo chỉ số.
 *
 * Dùng `data-block` chứ không đếm `children`: HTML đã sanitize có thể còn văn
 * bản trần xen giữa các khối (thẻ bị bỏ nhưng ruột giữ lại), đếm con sẽ lệch.
 */
export const findBlockElement = (root: HTMLElement, index: number): HTMLElement | null =>
  root.querySelector<HTMLElement>(`[data-block="${index}"]`);
