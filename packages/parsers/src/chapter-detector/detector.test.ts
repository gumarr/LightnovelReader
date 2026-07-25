import { describe, expect, it } from 'vitest';
import { detectChapters, fallbackByPage, scoreCandidates } from './detector.js';
import type { DetectSource, OutlineEntry } from './types.js';
import type { Page, TextLine } from '../cleaner/types.js';

const line = (text: string, y: number, fontSize = 10): TextLine => ({
  text,
  x: 72,
  y,
  width: 400,
  height: 12,
  fontSize,
});

const bodyPage = (pageNumber: number, rows = 30): Page => ({
  pageNumber,
  width: 432,
  height: 648,
  lines: Array.from({ length: rows }, (_, i) => line(`Câu văn thân bài thứ ${i}.`, 84 + i * 17)),
});

/** Trang mở chương: tiêu đề chữ to + ít dòng, giống file mẫu VI */
const chapterPage = (pageNumber: number, title: string, titleSize = 18): Page => ({
  pageNumber,
  width: 432,
  height: 648,
  lines: [
    line(title, 100, titleSize),
    ...Array.from({ length: 4 }, (_, i) => line(`Mở đầu chương ${i}.`, 200 + i * 17)),
  ],
});

const source = (pages: Page[], outline?: OutlineEntry[]): DetectSource => ({
  pages,
  ...(outline === undefined ? {} : { outline }),
  totalPages: pages.length,
});

describe('outline là tín hiệu áp đảo', () => {
  it('dùng outline khi có, kể cả trang trông như thân bài', () => {
    const pages = [bodyPage(1), bodyPage(2), bodyPage(3), bodyPage(4)];
    const outline: OutlineEntry[] = [
      { title: 'Chương Một', pageNumber: 1 },
      { title: 'Chương Hai', pageNumber: 3 },
    ];

    const chapters = detectChapters(source(pages, outline));

    expect(chapters).toHaveLength(2);
    expect(chapters[0]?.pageStart).toBe(1);
    expect(chapters[1]?.pageStart).toBe(3);
  });

  it('giữ nguyên mục outline không phải chương', () => {
    // "Bản quyền", "Lời bạt" phải còn — user tự loại ở màn xác nhận (P1.5)
    const pages = Array.from({ length: 6 }, (_, i) => bodyPage(i + 1));
    const outline: OutlineEntry[] = [
      { title: 'Bản quyền', pageNumber: 1 },
      { title: 'Chương Một', pageNumber: 3 },
      { title: 'Lời bạt', pageNumber: 5 },
    ];

    const titles = detectChapters(source(pages, outline)).map((c) => c.title);
    expect(titles).toContain('Bản quyền');
    expect(titles).toContain('Lời bạt');
  });

  it('tên chương lấy từ outline, không lấy dòng thân bài trên trang', () => {
    // Trang chỉ có văn xuôi; nếu lấy tên theo text sẽ ra "Câu văn thân bài…"
    const pages = [bodyPage(1), bodyPage(2), bodyPage(3)];
    const outline: OutlineEntry[] = [{ title: 'Chương Một: Trời mưa', pageNumber: 2 }];

    const chapters = detectChapters(source(pages, outline));
    expect(chapters[0]?.title).toBe('Chương Một: Trời mưa');
  });
});

describe('không có outline — dựa font size + regex', () => {
  it('nhận tiêu đề chữ to (giống file mẫu VI)', () => {
    const pages = [
      chapterPage(1, 'Chương Một: Trời mưa', 18),
      bodyPage(2),
      bodyPage(3),
      chapterPage(4, 'Chương Hai: Đá văng ảo tưởng', 18),
      bodyPage(5),
    ];

    const chapters = detectChapters(source(pages));

    expect(chapters).toHaveLength(2);
    expect(chapters[0]?.title).toContain('Chương Một');
    expect(chapters[1]?.pageStart).toBe(4);
  });

  it('nhận tiêu đề CÙNG cỡ chữ thân bài nhờ regex (giống file mẫu EN)', () => {
    // Đây là ca mà font-size heuristic bó tay hoàn toàn
    const pages: Page[] = [
      {
        pageNumber: 1,
        width: 612,
        height: 792,
        lines: [line('Chapter 1 :', 84, 13), ...Array.from({ length: 20 }, (_, i) => line(`Body line ${i}.`, 101 + i * 17, 13))],
      },
      bodyPage(2),
      {
        pageNumber: 3,
        width: 612,
        height: 792,
        lines: [line('Chapter 2 : Our Blue', 84, 13), ...Array.from({ length: 20 }, (_, i) => line(`Body line ${i}.`, 101 + i * 17, 13))],
      },
    ];

    const chapters = detectChapters(source(pages));

    expect(chapters).toHaveLength(2);
    expect(chapters[0]?.title).toBe('Chapter 1 :');
    expect(chapters[1]?.title).toBe('Chapter 2 : Our Blue');
  });
});

describe('chặn false positive', () => {
  it('dòng đầu trang thân bài bình thường không thành chương', () => {
    // Mọi trang đều có dòng đầu tiên — nếu vị trí đủ sức một mình thì
    // mọi trang đều thành chương
    const pages = Array.from({ length: 10 }, (_, i) => bodyPage(i + 1));
    expect(detectChapters(source(pages))).toEqual(fallbackByPage(source(pages)));
  });

  it('từ khoá nằm giữa câu văn không thành chương', () => {
    const pages: Page[] = [
      {
        pageNumber: 1,
        width: 612,
        height: 792,
        lines: Array.from({ length: 25 }, (_, i) =>
          line(i === 10 ? 'part left, most of the decisions have been made.' : `Body ${i}.`, 84 + i * 17, 13),
        ),
      },
      bodyPage(2),
      bodyPage(3),
    ];

    const chapters = detectChapters(source(pages));
    expect(chapters.every((c) => !c.title.startsWith('part left'))).toBe(true);
  });

  it('tiêu đề bị ngắt nhiều dòng chỉ sinh một chương', () => {
    const pages: Page[] = [
      {
        pageNumber: 1,
        width: 432,
        height: 648,
        lines: [
          line('Chương Ba: Đêm xanh nơi bầu trời xa xôi', 100, 18),
          line('mà một ngày nào đó ta sẽ nhớ', 130, 18),
          ...Array.from({ length: 5 }, (_, i) => line(`Thân ${i}.`, 200 + i * 17)),
        ],
      },
      bodyPage(2),
      bodyPage(3),
    ];

    expect(detectChapters(source(pages))).toHaveLength(1);
  });
});

describe('loại trang mục lục', () => {
  /** Trang mục lục thật của file mẫu VI: tiêu đề 19pt + các mục kèm số trang */
  const tocPage = (pageNumber: number): Page => ({
    pageNumber,
    width: 432,
    height: 648,
    lines: [
      line('Mục lục', 62, 19),
      line('Bản quyền11', 98),
      line('Lời tác giả14', 119),
      line('Mở đầu: Vầng trăng ngày ấy15', 140),
      line('Chương Một: Trời mưa17', 161),
      line('Chương Hai: Đá văng ảo tưởng77', 182),
      line('Lời bạt243', 203),
    ],
  });

  it('không sinh chương từ trang mục lục', () => {
    const pages = [tocPage(1), bodyPage(2), chapterPage(3, 'Chương Một: Trời mưa', 18), bodyPage(4)];
    const titles = detectChapters(source(pages)).map((c) => c.title);

    expect(titles).not.toContain('Mục lục');
    expect(titles.some((t) => t.includes('Chương Một'))).toBe(true);
  });

  it('vẫn giữ nếu outline trỏ đích danh vào trang đó', () => {
    // Outline là chân lý — nó bảo đó là mục thì tôn trọng
    const pages = [tocPage(1), bodyPage(2), bodyPage(3)];
    const outline: OutlineEntry[] = [{ title: 'Mục lục', pageNumber: 1 }];

    expect(detectChapters(source(pages, outline)).map((c) => c.title)).toContain('Mục lục');
  });
});

describe('khoảng trang', () => {
  it('pageEnd lấy từ chương kế tiếp', () => {
    const pages = [chapterPage(1, 'Chương Một', 18), bodyPage(2), bodyPage(3), chapterPage(4, 'Chương Hai', 18), bodyPage(5)];
    const chapters = detectChapters(source(pages));

    expect(chapters[0]?.pageStart).toBe(1);
    expect(chapters[0]?.pageEnd).toBe(3);
  });

  it('chương cuối kéo tới hết sách', () => {
    const pages = [chapterPage(1, 'Chương Một', 18), bodyPage(2), bodyPage(3)];
    const chapters = detectChapters(source(pages));

    expect(chapters.at(-1)?.pageEnd).toBe(3);
  });

  it('khoảng trang không chồng lấn và phủ kín', () => {
    const pages = [
      chapterPage(1, 'Chương Một', 18),
      bodyPage(2),
      chapterPage(3, 'Chương Hai', 18),
      bodyPage(4),
      chapterPage(5, 'Chương Ba', 18),
    ];
    const chapters = detectChapters(source(pages));

    for (let i = 1; i < chapters.length; i += 1) {
      expect(chapters[i]!.pageStart).toBe(chapters[i - 1]!.pageEnd + 1);
    }
  });
});

describe('fallback chia theo trang', () => {
  it('không nhận ra gì thì chia đều', () => {
    const pages = Array.from({ length: 40 }, (_, i) => bodyPage(i + 1));
    const chapters = detectChapters(source(pages));

    expect(chapters.length).toBeGreaterThan(1);
    expect(chapters[0]?.confidence).toBe(0);
  });

  it('luôn trả ít nhất một chương', () => {
    expect(detectChapters(source([bodyPage(1)])).length).toBeGreaterThanOrEqual(1);
    expect(detectChapters({ pages: [], totalPages: 0 }).length).toBeGreaterThanOrEqual(1);
  });

  it('phủ kín mọi trang, không chồng lấn', () => {
    const result = fallbackByPage({ pages: [], totalPages: 47 }, { fallbackPagesPerChapter: 15 });
    expect(result[0]?.pageStart).toBe(1);
    expect(result.at(-1)?.pageEnd).toBe(47);
    for (let i = 1; i < result.length; i += 1) {
      expect(result[i]!.pageStart).toBe(result[i - 1]!.pageEnd + 1);
    }
  });
});

describe('scoreCandidates — phục vụ /detect', () => {
  it('trả điểm từng tín hiệu tách bạch', () => {
    const pages = [chapterPage(1, 'Chương Một: Trời mưa', 18), bodyPage(2), bodyPage(3)];
    const top = scoreCandidates(source(pages))[0];

    expect(top).toBeDefined();
    expect(top?.scores.pattern).toBe(1);
    expect(top?.scores.fontSize).toBeGreaterThan(0);
    expect(top?.total).toBeGreaterThan(0);
  });

  it('sắp theo tổng điểm giảm dần', () => {
    const pages = [chapterPage(1, 'Chương Một', 18), bodyPage(2), chapterPage(3, 'Chương Hai', 18)];
    const scored = scoreCandidates(source(pages));

    for (let i = 1; i < scored.length; i += 1) {
      expect(scored[i - 1]!.total).toBeGreaterThanOrEqual(scored[i]!.total);
    }
  });
});
