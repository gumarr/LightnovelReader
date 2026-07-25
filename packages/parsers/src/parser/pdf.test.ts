import { describe, expect, it, vi } from 'vitest';
import { createPdfParser, groupItemsIntoLines, hasTextLayer, readOutline } from './pdf.js';
import { ParseError } from './types.js';

/**
 * Item giả lập pdfjs. `transform` là ma trận 6 phần tử, phần tử 4 = x,
 * phần tử 5 = y tính từ đáy trang.
 */
const item = (str: string, x: number, yFromBottom: number, width = 50, height = 10) => ({
  str,
  width,
  height,
  transform: [height, 0, 0, height, x, yFromBottom],
});

const PAGE_HEIGHT = 792;

/** Tài liệu pdfjs giả lập, đủ để parser chạy */
const fakeDoc = (config: {
  pages: { items: unknown[]; width?: number; height?: number }[];
  outline?: unknown;
  destinations?: Record<string, unknown[]>;
  pageIndexOf?: (ref: unknown) => number;
}) => ({
  numPages: config.pages.length,
  getPage: (n: number) =>
    Promise.resolve({
      getViewport: () => ({
        width: config.pages[n - 1]?.width ?? 612,
        height: config.pages[n - 1]?.height ?? PAGE_HEIGHT,
      }),
      getTextContent: () => Promise.resolve({ items: config.pages[n - 1]?.items ?? [] }),
    }),
  getOutline: () => Promise.resolve((config.outline ?? null) as never),
  getDestination: (id: string) => Promise.resolve((config.destinations?.[id] ?? null) as never),
  getPageIndex: (ref: unknown) => Promise.resolve(config.pageIndexOf?.(ref) ?? 0),
});

describe('groupItemsIntoLines', () => {
  it('gom item cùng hàng thành một dòng, sắp theo x', () => {
    const lines = groupItemsIntoLines(
      [item('thế', 150, 700), item('Xin ', 72, 700), item('chào', 100, 700)],
      PAGE_HEIGHT,
    );

    expect(lines).toHaveLength(1);
    expect(lines[0]?.text).toBe('Xin chàothế');
  });

  it('lật trục y về gốc toạ độ góc trên-trái', () => {
    // pdfjs: y=700 tính từ đáy → yTop = 792 - 700 = 92
    const lines = groupItemsIntoLines([item('A', 72, 700)], PAGE_HEIGHT);
    expect(lines[0]?.y).toBe(92);
  });

  it('sắp dòng từ trên xuống dưới', () => {
    const lines = groupItemsIntoLines(
      [item('dưới', 72, 100), item('trên', 72, 700), item('giữa', 72, 400)],
      PAGE_HEIGHT,
    );
    expect(lines.map((l) => l.text)).toEqual(['trên', 'giữa', 'dưới']);
  });

  it('item lệch nhau vài point vẫn cùng một dòng', () => {
    // Chữ hoa/thường trên cùng dòng hay lệch baseline chút ít
    const lines = groupItemsIntoLines([item('A', 72, 700), item('b', 90, 701)], PAGE_HEIGHT);
    expect(lines).toHaveLength(1);
  });

  it('gom đúng kể cả khi item rơi vào ranh giới lượng tử hoá', () => {
    // Chia bucket cứng theo round(y/3) sẽ tách đôi cặp này: yTop 92 và 91
    // rơi vào hai bucket khác nhau dù chỉ cách 1pt.
    for (let offset = 0; offset <= 2; offset += 1) {
      const lines = groupItemsIntoLines(
        [item('A', 72, 700 + offset), item('B', 120, 700)],
        PAGE_HEIGHT,
      );
      expect(lines, `lệch ${offset}pt phải cùng dòng`).toHaveLength(1);
    }
  });

  it('dòng cách xa nhau vẫn tách riêng', () => {
    const lines = groupItemsIntoLines([item('A', 72, 700), item('B', 72, 680)], PAGE_HEIGHT);
    expect(lines).toHaveLength(2);
  });

  it('tính x, width bao trọn cả dòng', () => {
    const lines = groupItemsIntoLines(
      [item('A', 72, 700, 50), item('B', 200, 700, 40)],
      PAGE_HEIGHT,
    );
    expect(lines[0]?.x).toBe(72);
    expect(lines[0]?.width).toBe(200 + 40 - 72);
  });

  it('fontSize lấy chiều cao lớn nhất trong dòng', () => {
    const lines = groupItemsIntoLines(
      [item('nhỏ', 72, 700, 50, 10), item('TO', 130, 700, 50, 18)],
      PAGE_HEIGHT,
    );
    expect(lines[0]?.fontSize).toBe(18);
  });

  it('bỏ item rỗng và dòng chỉ có khoảng trắng', () => {
    expect(groupItemsIntoLines([item('   ', 72, 700), item('', 100, 700)], PAGE_HEIGHT)).toEqual([]);
  });

  it('bỏ qua item không đúng hình dạng, không ném lỗi', () => {
    const lines = groupItemsIntoLines(
      [null, undefined, 42, 'text', { str: 'thiếu transform' }, item('OK', 72, 700)],
      PAGE_HEIGHT,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]?.text).toBe('OK');
  });

  it('mảng rỗng trả mảng rỗng', () => {
    expect(groupItemsIntoLines([], PAGE_HEIGHT)).toEqual([]);
  });
});

describe('readOutline', () => {
  it('phân giải đích dạng chuỗi thành số trang', async () => {
    const ref = { num: 5, gen: 0 };
    const doc = fakeDoc({
      pages: [{ items: [] }],
      outline: [{ title: 'Chương Một', dest: 'ch1' }],
      destinations: { ch1: [ref] },
      pageIndexOf: () => 16,
    });

    expect(await readOutline(doc as never)).toEqual([{ title: 'Chương Một', pageNumber: 17 }]);
  });

  it('phân giải đích dạng mảng sẵn', async () => {
    const doc = fakeDoc({
      pages: [{ items: [] }],
      outline: [{ title: 'Chương Hai', dest: [{ num: 9 }] }],
      pageIndexOf: () => 76,
    });

    expect(await readOutline(doc as never)).toEqual([{ title: 'Chương Hai', pageNumber: 77 }]);
  });

  it('lấy cả mục con lồng nhau', async () => {
    const doc = fakeDoc({
      pages: [{ items: [] }],
      outline: [
        { title: 'Quyển Một', dest: [{ num: 1 }], items: [{ title: 'Chương Một', dest: [{ num: 2 }] }] },
      ],
      pageIndexOf: () => 0,
    });

    expect((await readOutline(doc as never)).map((e) => e.title)).toEqual([
      'Quyển Một',
      'Chương Một',
    ]);
  });

  it('mục có đích hỏng vẫn giữ tiêu đề, không làm hỏng cả outline', async () => {
    const doc = fakeDoc({
      pages: [{ items: [] }],
      outline: [
        { title: 'Hỏng', dest: 'khong-ton-tai' },
        { title: 'Tốt', dest: [{ num: 3 }] },
      ],
      pageIndexOf: () => 41,
    });

    const entries = await readOutline(doc as never);
    expect(entries[0]).toEqual({ title: 'Hỏng' });
    expect(entries[1]).toEqual({ title: 'Tốt', pageNumber: 42 });
  });

  it('getPageIndex ném lỗi thì bỏ qua mục đó, không vỡ', async () => {
    const doc = {
      ...fakeDoc({ pages: [{ items: [] }], outline: [{ title: 'X', dest: [{ num: 1 }] }] }),
      getPageIndex: () => Promise.reject(new Error('ref hỏng')),
    };

    expect(await readOutline(doc as never)).toEqual([{ title: 'X' }]);
  });

  it('không có outline trả mảng rỗng', async () => {
    expect(await readOutline(fakeDoc({ pages: [{ items: [] }] }) as never)).toEqual([]);
  });
});

describe('hasTextLayer', () => {
  it('sách có text ở mọi trang', async () => {
    const doc = fakeDoc({ pages: Array.from({ length: 10 }, () => ({ items: [item('chữ', 72, 700)] })) });
    expect(await hasTextLayer(doc as never)).toBe(true);
  });

  it('PDF scan — không trang nào có text', async () => {
    const doc = fakeDoc({ pages: Array.from({ length: 10 }, () => ({ items: [] })) });
    expect(await hasTextLayer(doc as never)).toBe(false);
  });

  it('sách có vài trang ảnh vẫn được chấp nhận', async () => {
    // Bìa + minh hoạ không có text là chuyện bình thường
    const pages = [
      ...Array.from({ length: 3 }, () => ({ items: [] })),
      ...Array.from({ length: 7 }, () => ({ items: [item('chữ', 72, 700)] })),
    ];
    expect(await hasTextLayer(fakeDoc({ pages }) as never)).toBe(true);
  });

  it('trang chỉ có khoảng trắng không tính là có text', async () => {
    const doc = fakeDoc({ pages: Array.from({ length: 10 }, () => ({ items: [item('   ', 72, 700)] })) });
    expect(await hasTextLayer(doc as never)).toBe(false);
  });

  it('chỉ đọc số trang lấy mẫu, không đọc cả sách', async () => {
    const getPage = vi.fn((n: number) =>
      Promise.resolve({
        getViewport: () => ({ width: 612, height: PAGE_HEIGHT }),
        getTextContent: () => Promise.resolve({ items: [item(`t${n}`, 72, 700)] }),
      }),
    );
    const doc = { numPages: 500, getPage } as never;

    await hasTextLayer(doc, 20);
    expect(getPage).toHaveBeenCalledTimes(20);
  });

  it('sách không trang trả false', async () => {
    expect(await hasTextLayer(fakeDoc({ pages: [] }) as never)).toBe(false);
  });
});

describe('createPdfParser', () => {
  const textPages = (count: number) =>
    Array.from({ length: count }, (_, i) => ({ items: [item(`Trang ${i + 1}`, 72, 700)] }));

  it('trả tài liệu đã trích với hasRealPages = true', async () => {
    const parser = createPdfParser(() => Promise.resolve(fakeDoc({ pages: textPages(5) }) as never));
    const doc = await parser.parse('sach.pdf');

    expect(doc.format).toBe('pdf');
    expect(doc.pages).toHaveLength(5);
    expect(doc.totalPages).toBe(5);
    expect(doc.hasRealPages).toBe(true);
    expect(doc.pages[0]?.lines[0]?.text).toBe('Trang 1');
  });

  it('PDF scan báo lỗi rõ ràng, không trả tài liệu rỗng', async () => {
    const parser = createPdfParser(() =>
      Promise.resolve(fakeDoc({ pages: Array.from({ length: 30 }, () => ({ items: [] })) }) as never),
    );

    await expect(parser.parse('scan.pdf')).rejects.toMatchObject({
      kind: 'scanned-pdf',
      name: 'ParseError',
    });
  });

  it('thông điệp lỗi scan hướng dẫn được user', async () => {
    const parser = createPdfParser(() =>
      Promise.resolve(fakeDoc({ pages: Array.from({ length: 30 }, () => ({ items: [] })) }) as never),
    );

    await expect(parser.parse('scan.pdf')).rejects.toThrow(/OCR/);
  });

  it('file hỏng báo corrupt-file', async () => {
    const parser = createPdfParser(() => Promise.reject(new Error('xxx')));
    await expect(parser.parse('hong.pdf')).rejects.toMatchObject({ kind: 'corrupt-file' });
  });

  it('giữ nguyên lỗi gốc ở cause để debug được', async () => {
    const cause = new Error('lỗi gốc pdfjs');
    const parser = createPdfParser(() => Promise.reject(cause));

    await expect(parser.parse('hong.pdf')).rejects.toSatisfy(
      (e: unknown) => e instanceof ParseError && e.cause === cause,
    );
  });

  it('PDF không trang báo empty-document', async () => {
    const parser = createPdfParser(() => Promise.resolve(fakeDoc({ pages: [] }) as never));
    await expect(parser.parse('rong.pdf')).rejects.toMatchObject({ kind: 'empty-document' });
  });

  it('maxPages giới hạn số trang đọc nhưng totalPages vẫn là thật', async () => {
    const parser = createPdfParser(() => Promise.resolve(fakeDoc({ pages: textPages(100) }) as never));
    const doc = await parser.parse('sach.pdf', { maxPages: 10 });

    expect(doc.pages).toHaveLength(10);
    expect(doc.totalPages).toBe(100);
  });

  it('gọi onProgress theo từng trang', async () => {
    const onProgress = vi.fn();
    const parser = createPdfParser(() => Promise.resolve(fakeDoc({ pages: textPages(3) }) as never));

    await parser.parse('sach.pdf', { onProgress });

    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(onProgress).toHaveBeenLastCalledWith(3, 3);
  });

  it('khai báo đúng format và đuôi file', () => {
    const parser = createPdfParser(() => Promise.reject(new Error('không dùng')));
    expect(parser.format).toBe('pdf');
    expect(parser.extensions).toEqual(['.pdf']);
  });
});
