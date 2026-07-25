import type { Rect, SegmentAnchor } from '@ln/shared';
import type { CleanedPage } from '../cleaner/cleaner.js';
import type { Page, TextLine } from '../cleaner/types.js';
import { segmentText, type RawSegment, type SegmenterOptions } from './segmenter.js';

/**
 * Dựng segment cho một chương, kèm neo về vị trí trong tài liệu gốc.
 *
 * Chạy segmenter **theo từng trang** thay vì ghép cả chương thành một chuỗi.
 * Lý do là neo: ghép cả chương thì offset của segment trỏ vào chuỗi ghép, và
 * để biết segment nằm ở trang nào phải dò ngược qua bảng offset — thêm một
 * chỗ sai. Chạy theo trang thì `page` đúng theo cấu trúc, không phải suy luận.
 *
 * Đánh đổi: một câu bị PDF ngắt qua hai trang sẽ thành hai segment. Chấp nhận
 * được — segment là đơn vị ~10s audio, không phải đơn vị ngữ nghĩa, và ranh
 * giới trang gần như luôn trùng ranh giới câu trong sách thật.
 */

export type ChapterSegment = {
  /** Thứ tự trong chương, bắt đầu từ 0 */
  index: number;
  text: string;
  anchor: SegmentAnchor;
};

export type BuildSegmentsInput = {
  /** Text đã làm sạch, theo trang */
  cleaned: readonly CleanedPage[];
  /**
   * Trang gốc kèm toạ độ. Chỉ cần với PDF — dùng để dựng `rects`.
   * DOCX không có toạ độ thật nên bỏ qua.
   */
  pages?: readonly Page[];
  /** Trang đầu và cuối của chương, tính cả hai đầu */
  pageStart: number;
  pageEnd: number;
  format: 'pdf' | 'docx';
  segmenter?: SegmenterOptions;
};

/**
 * Chuẩn hoá text để so khớp giữa segment (đã qua cleaner) và dòng gốc.
 *
 * Cleaner có nối dòng và gộp khoảng trắng nên hai chuỗi không bao giờ khớp
 * tuyệt đối. Bỏ hết khoảng trắng và hạ chữ thường là đủ để tìm ra dòng nào
 * đóng góp vào segment nào.
 */
const normalize = (text: string): string => text.replace(/\s+/g, '').toLowerCase();

/** Hình chữ nhật bao quanh một dòng, trong không gian trang PDF */
const rectOf = (line: TextLine): Rect => ({
  x: line.x,
  y: line.y,
  width: line.width,
  height: line.height,
});

/**
 * Tìm các dòng gốc đóng góp vào một segment.
 *
 * Không cố khớp chính xác từng ký tự — cleaner đã đổi chuỗi quá nhiều. Chỉ
 * cần biết segment phủ những dòng nào để viewer highlight đúng vùng.
 *
 * Trả mảng rỗng khi không khớp được dòng nào; khi đó neo chỉ còn số trang,
 * và viewer vẫn cuộn đúng trang — mất highlight chứ không mất chức năng.
 */
export const findLineRects = (segmentText: string, lines: readonly TextLine[]): Rect[] => {
  const needle = normalize(segmentText);
  if (needle.length === 0) return [];

  // Dựng chuỗi toàn trang cùng bảng tra ngược ký tự → dòng.
  //
  // Không dò theo từng dòng riêng lẻ: cleaner nối nhiều dòng thành một khối
  // rồi segmenter cắt lại theo ranh giới **câu**, nên phần lớn segment bắt
  // đầu ở giữa một dòng. Dò theo dòng chỉ bắt được segment trùng đúng đầu
  // dòng — đo trên sách thật là 226/4817 segment không khớp được, toàn những
  // câu nằm giữa đoạn.
  let haystack = '';
  const ownerLine: number[] = [];

  for (const [index, line] of lines.entries()) {
    const piece = normalize(line.text);
    haystack += piece;
    for (let i = 0; i < piece.length; i += 1) ownerLine.push(index);
  }

  const at = haystack.indexOf(needle);
  if (at < 0) return [];

  // Mọi dòng bị đoạn [at, at+needle.length) chạm vào
  const touched = new Set<number>();
  for (let i = at; i < at + needle.length; i += 1) {
    const owner = ownerLine[i];
    if (owner !== undefined) touched.add(owner);
  }

  return [...touched]
    .sort((a, b) => a - b)
    .map((index) => lines[index])
    .filter((line): line is TextLine => line !== undefined)
    .map(rectOf);
};

/**
 * Dựng segment cho một chương.
 *
 * Trang mục lục bị bỏ qua (cleaner đã đánh dấu `isTableOfContents`) — nội dung
 * đó không phải truyện, đọc lên thành "Bản quyền mười một, Lời tác giả mười bốn".
 */
export const buildChapterSegments = (input: BuildSegmentsInput): ChapterSegment[] => {
  const byPageNumber = new Map<number, Page>();
  for (const page of input.pages ?? []) byPageNumber.set(page.pageNumber, page);

  const segments: ChapterSegment[] = [];

  for (const cleaned of input.cleaned) {
    if (cleaned.pageNumber < input.pageStart) continue;
    if (cleaned.pageNumber > input.pageEnd) break;
    if (cleaned.isTableOfContents === true) continue;

    const text = cleaned.text.trim();
    if (text.length === 0) continue;

    const raw = segmentText(cleaned.text, input.segmenter);
    const sourceLines = byPageNumber.get(cleaned.pageNumber)?.lines ?? [];

    for (const segment of raw) {
      segments.push({
        index: segments.length,
        text: segment.text,
        anchor: anchorFor(input.format, cleaned.pageNumber, segment, sourceLines),
      });
    }
  }

  return segments;
};

/**
 * Neo của một segment.
 *
 * DOCX: `pageNumber` chính là chỉ số paragraph (xem `parser/docx.ts`), nên
 * dùng thẳng làm `nodePath` — viewer render mỗi paragraph một node theo đúng
 * thứ tự đó. `offset` là vị trí trong text đã sạch của paragraph.
 */
const anchorFor = (
  format: 'pdf' | 'docx',
  pageNumber: number,
  segment: RawSegment,
  sourceLines: readonly TextLine[],
): SegmentAnchor => {
  if (format === 'docx') {
    return { kind: 'docx', nodePath: `p:${pageNumber}`, offset: segment.start };
  }

  return { kind: 'pdf', page: pageNumber, rects: findLineRects(segment.text, sourceLines) };
};
