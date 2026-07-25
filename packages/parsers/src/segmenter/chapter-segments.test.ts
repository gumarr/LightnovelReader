import { describe, expect, it } from 'vitest';
import type { CleanedPage } from '../cleaner/cleaner.js';
import type { Page, TextLine } from '../cleaner/types.js';
import { buildChapterSegments, findLineRects } from './chapter-segments.js';

const line = (text: string, y: number, x = 72, width = 400, height = 13): TextLine => ({
  text,
  x,
  y,
  width,
  height,
});

const page = (pageNumber: number, lines: TextLine[]): Page => ({
  pageNumber,
  width: 612,
  height: 792,
  lines,
});

const cleaned = (pageNumber: number, text: string, toc = false): CleanedPage =>
  toc ? { pageNumber, text, isTableOfContents: true } : { pageNumber, text };

describe('findLineRects', () => {
  it('khớp một dòng trọn vẹn', () => {
    const lines = [line('Câu văn thứ nhất.', 100), line('Câu văn thứ hai.', 120)];
    const rects = findLineRects('Câu văn thứ nhất.', lines);

    expect(rects).toEqual([{ x: 72, y: 100, width: 400, height: 13 }]);
  });

  it('gom nhiều dòng khi segment trải qua chúng — cleaner đã nối lại', () => {
    const lines = [line('Nửa đầu của câu', 100), line('và nửa sau của nó.', 120)];
    // Sau mergeLines hai dòng thành một chuỗi có khoảng trắng ở giữa
    const rects = findLineRects('Nửa đầu của câu và nửa sau của nó.', lines);

    expect(rects).toHaveLength(2);
    expect(rects.map((r) => r.y)).toEqual([100, 120]);
  });

  it('bỏ qua khác biệt khoảng trắng do cleaner gộp', () => {
    const lines = [line('Câu   có    nhiều   khoảng trắng.', 100)];
    expect(findLineRects('Câu có nhiều khoảng trắng.', lines)).toHaveLength(1);
  });

  it('không phân biệt hoa thường', () => {
    const lines = [line('CÂU VIẾT HOA.', 100)];
    expect(findLineRects('câu viết hoa.', lines)).toHaveLength(1);
  });

  it('segment kết thúc giữa dòng vẫn lấy được dòng đó', () => {
    const lines = [line('Phần đầu rồi phần sau.', 100)];
    expect(findLineRects('Phần đầu', lines)).toHaveLength(1);
  });

  it('không khớp được thì trả rỗng, không ném', () => {
    const lines = [line('Nội dung hoàn toàn khác.', 100)];
    expect(findLineRects('Chuỗi không có trên trang.', lines)).toEqual([]);
  });

  it('segment rỗng trả rỗng', () => {
    expect(findLineRects('   ', [line('Có chữ.', 100)])).toEqual([]);
  });

  it('không gom nhầm dòng cuối trang vào segment đầu trang', () => {
    // Dòng 3 tình cờ giống phần tiếp theo, nhưng cách xa dòng đã khớp
    const lines = [
      line('Đoạn mở đầu.', 100),
      line('Một đoạn ở giữa hoàn toàn khác.', 120),
      line('Đoạn mở đầu.', 700),
    ];
    const rects = findLineRects('Đoạn mở đầu.', lines);

    expect(rects).toHaveLength(1);
    expect(rects[0]?.y).toBe(100);
  });

  it('bỏ qua dòng trống khi dò', () => {
    const lines = [line('   ', 90), line('Câu thật.', 100)];
    expect(findLineRects('Câu thật.', lines)[0]?.y).toBe(100);
  });

  /**
   * Phần lớn segment KHÔNG bắt đầu ở đầu dòng: cleaner nối nhiều dòng thành
   * một khối, segmenter cắt lại theo ranh giới **câu**. Đo trên sách thật:
   * cách dò theo từng dòng bỏ sót 226/4817 segment, toàn câu giữa đoạn.
   */
  it('khớp segment bắt đầu GIỮA một dòng', () => {
    const lines = [
      line('Câu thứ nhất. Câu thứ hai bắt', 100),
      line('đầu ở dòng trên rồi kết ở đây.', 120),
    ];
    const rects = findLineRects('Câu thứ hai bắt đầu ở dòng trên rồi kết ở đây.', lines);

    expect(rects.map((r) => r.y)).toEqual([100, 120]);
  });

  it('khớp segment nằm trọn giữa một dòng', () => {
    const lines = [line('Câu một. Câu hai. Câu ba.', 100)];
    expect(findLineRects('Câu hai.', lines)).toEqual([
      { x: 72, y: 100, width: 400, height: 13 },
    ]);
  });

  it('câu hội thoại chỉ có dấu đóng vẫn khớp — dạng gặp nhiều trong LN', () => {
    const lines = [
      line('Tôi hét lên: “Chitose trở về Trái', 100),
      line('Đất đi!!!”', 120),
    ];
    expect(findLineRects('Chitose trở về Trái Đất đi!!!”', lines)).toHaveLength(2);
  });
});

describe('buildChapterSegments — neo PDF', () => {
  it('mỗi segment mang đúng số trang của nó', () => {
    const segments = buildChapterSegments({
      cleaned: [cleaned(5, 'Câu ở trang năm.'), cleaned(6, 'Câu ở trang sáu.')],
      pages: [page(5, [line('Câu ở trang năm.', 100)]), page(6, [line('Câu ở trang sáu.', 100)])],
      pageStart: 5,
      pageEnd: 6,
      format: 'pdf',
    });

    expect(segments).toHaveLength(2);
    expect(segments[0]?.anchor).toMatchObject({ kind: 'pdf', page: 5 });
    expect(segments[1]?.anchor).toMatchObject({ kind: 'pdf', page: 6 });
  });

  it('index chạy liên tục qua các trang', () => {
    const segments = buildChapterSegments({
      cleaned: [cleaned(1, 'Một. Hai. Ba.'), cleaned(2, 'Bốn. Năm.')],
      pages: [page(1, []), page(2, [])],
      pageStart: 1,
      pageEnd: 2,
      format: 'pdf',
    });

    expect(segments.map((s) => s.index)).toEqual(segments.map((_, i) => i));
  });

  it('chỉ lấy trang trong khoảng chương', () => {
    const segments = buildChapterSegments({
      cleaned: [cleaned(1, 'Ngoài chương.'), cleaned(2, 'Trong chương.'), cleaned(3, 'Ngoài nữa.')],
      pageStart: 2,
      pageEnd: 2,
      format: 'pdf',
    });

    expect(segments).toHaveLength(1);
    expect(segments[0]?.text).toBe('Trong chương.');
  });

  it('bỏ trang mục lục — TTS không được đọc danh sách chương', () => {
    const segments = buildChapterSegments({
      cleaned: [cleaned(1, 'Chương Một11 Chương Hai22', true), cleaned(2, 'Nội dung thật.')],
      pageStart: 1,
      pageEnd: 2,
      format: 'pdf',
    });

    expect(segments).toHaveLength(1);
    expect(segments[0]?.text).toBe('Nội dung thật.');
  });

  it('bỏ trang rỗng, không sinh segment rỗng', () => {
    const segments = buildChapterSegments({
      cleaned: [cleaned(1, '   '), cleaned(2, 'Có chữ.')],
      pageStart: 1,
      pageEnd: 2,
      format: 'pdf',
    });

    expect(segments).toHaveLength(1);
  });

  it('dựng được rects khi có trang gốc', () => {
    const segments = buildChapterSegments({
      cleaned: [cleaned(1, 'Câu có toạ độ.')],
      pages: [page(1, [line('Câu có toạ độ.', 150)])],
      pageStart: 1,
      pageEnd: 1,
      format: 'pdf',
    });

    const anchor = segments[0]?.anchor;
    expect(anchor?.kind).toBe('pdf');
    if (anchor?.kind === 'pdf') {
      expect(anchor.rects).toEqual([{ x: 72, y: 150, width: 400, height: 13 }]);
    }
  });

  it('không có trang gốc thì rects rỗng nhưng page vẫn đúng — viewer còn cuộn được', () => {
    const segments = buildChapterSegments({
      cleaned: [cleaned(7, 'Không có toạ độ.')],
      pageStart: 7,
      pageEnd: 7,
      format: 'pdf',
    });

    const anchor = segments[0]?.anchor;
    if (anchor?.kind === 'pdf') {
      expect(anchor.page).toBe(7);
      expect(anchor.rects).toEqual([]);
    }
  });

  it('tôn trọng giới hạn độ dài segment', () => {
    const long = `${'Câu dài lặp lại nhiều lần. '.repeat(60)}`;
    const segments = buildChapterSegments({
      cleaned: [cleaned(1, long)],
      pageStart: 1,
      pageEnd: 1,
      format: 'pdf',
      segmenter: { maxChars: 100 },
    });

    expect(segments.length).toBeGreaterThan(1);
    for (const segment of segments) expect(segment.text.length).toBeLessThanOrEqual(100);
  });

  it('không có segment nào chứa xuống dòng', () => {
    const segments = buildChapterSegments({
      cleaned: [cleaned(1, 'Tiêu đề chương\nCâu thân bài thứ nhất. Câu thứ hai.')],
      pageStart: 1,
      pageEnd: 1,
      format: 'pdf',
    });

    for (const segment of segments) expect(segment.text).not.toContain('\n');
  });
});

describe('buildChapterSegments — neo DOCX', () => {
  it('dùng chỉ số paragraph làm nodePath', () => {
    const segments = buildChapterSegments({
      cleaned: [cleaned(12, 'Đoạn văn thứ mười hai.')],
      pageStart: 12,
      pageEnd: 12,
      format: 'docx',
    });

    expect(segments[0]?.anchor).toEqual({ kind: 'docx', nodePath: 'p:12', offset: 0 });
  });

  it('offset trỏ vào vị trí trong đoạn', () => {
    const segments = buildChapterSegments({
      cleaned: [cleaned(1, 'Câu đầu. Câu sau.')],
      pageStart: 1,
      pageEnd: 1,
      format: 'docx',
      segmenter: { maxChars: 10, minChars: 0 },
    });

    expect(segments.length).toBeGreaterThan(1);
    const second = segments[1]?.anchor;
    if (second?.kind === 'docx') expect(second.offset).toBeGreaterThan(0);
  });

  it('không dựng rects cho DOCX — không có toạ độ thật', () => {
    const segments = buildChapterSegments({
      cleaned: [cleaned(1, 'Đoạn văn.')],
      pages: [page(1, [line('Đoạn văn.', 0)])],
      pageStart: 1,
      pageEnd: 1,
      format: 'docx',
    });

    expect(segments[0]?.anchor.kind).toBe('docx');
  });
});
