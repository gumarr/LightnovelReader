import { describe, expect, it } from 'vitest';
import { createRegistry, ParseError, type DocumentParser, type Page } from '@ln/parsers';
import type { CleanedPage } from '@ln/parsers';
import {
  createImportSessionStore,
  previewOfRange,
  suggestTitle,
  toDrafts,
} from './import-session.js';

/**
 * Parser giả — service này chỉ điều phối, không nên phụ thuộc pdfjs để test.
 * Đường đi thật với file thật đã có ở `packages/parsers/probe/`.
 */
const fakeParser = (options: {
  pages: Page[];
  totalPages?: number;
  hasRealPages?: boolean;
  outline?: { title: string; pageNumber?: number }[];
  throws?: ParseError;
}): DocumentParser => ({
  format: 'pdf',
  extensions: ['.pdf'],
  parse: async () => {
    if (options.throws !== undefined) throw options.throws;
    return {
      format: 'pdf' as const,
      pages: options.pages,
      outline: options.outline ?? [],
      totalPages: options.totalPages ?? options.pages.length,
      hasRealPages: options.hasRealPages ?? true,
    };
  },
});

/** Trang có một tiêu đề chữ to + vài dòng thân bài */
const chapterPage = (pageNumber: number, title: string): Page => ({
  pageNumber,
  width: 612,
  height: 792,
  lines: [
    { text: title, x: 72, y: 90, width: 300, height: 24, fontSize: 20 },
    { text: `Câu mở đầu của ${title}.`, x: 72, y: 160, width: 400, height: 13, fontSize: 10 },
    { text: 'Một câu thân bài nữa cho đủ dài.', x: 72, y: 180, width: 400, height: 13, fontSize: 10 },
  ],
});

const bodyPage = (pageNumber: number): Page => ({
  pageNumber,
  width: 612,
  height: 792,
  lines: [
    { text: `Thân bài trang ${pageNumber}, câu thứ nhất.`, x: 72, y: 160, width: 400, height: 13, fontSize: 10 },
  ],
});

const cleaned = (pages: { pageNumber: number; text: string; toc?: boolean }[]): CleanedPage[] =>
  pages.map((p) =>
    p.toc === true
      ? { pageNumber: p.pageNumber, text: p.text, isTableOfContents: true }
      : { pageNumber: p.pageNumber, text: p.text },
  );

describe('suggestTitle', () => {
  it('bỏ đuôi file và thư mục', () => {
    expect(suggestTitle('D:\\sach\\Kiem Vuc Than De.pdf')).toBe('Kiem Vuc Than De');
  });

  it('đổi gạch dưới thành khoảng trắng', () => {
    expect(suggestTitle('/home/a/kiem_vuc_than_de.docx')).toBe('kiem vuc than de');
  });

  it('gộp khoảng trắng thừa', () => {
    expect(suggestTitle('/a/b/ten   sach  .pdf')).toBe('ten sach');
  });
});

describe('toDrafts', () => {
  it('sinh ID tuần tự và giữ confidence từ detector', () => {
    const drafts = toDrafts([
      { index: 0, title: 'Chương 1', pageStart: 1, pageEnd: 10, confidence: 5.2 },
      { index: 1, title: 'Chương 2', pageStart: 11, pageEnd: 20, confidence: 1.5 },
    ]);

    expect(drafts.map((d) => d.id)).toEqual(['c1', 'c2']);
    expect(drafts[0]?.confidence).toBe(5.2);
    expect(drafts.every((d) => !d.excluded)).toBe(true);
  });

  it('cắt khoảng trắng thừa quanh tên chương', () => {
    const drafts = toDrafts([
      { index: 0, title: '  Chương 1  ', pageStart: 1, pageEnd: 5, confidence: 3 },
    ]);
    expect(drafts[0]?.title).toBe('Chương 1');
  });
});

describe('previewOfRange', () => {
  const pages = cleaned([
    { pageNumber: 1, text: 'Trang một.' },
    { pageNumber: 2, text: 'Trang hai.' },
    { pageNumber: 3, text: 'Trang ba.' },
  ]);

  it('chỉ lấy trang trong khoảng', () => {
    expect(previewOfRange(pages, 2, 3)).toBe('Trang hai. Trang ba.');
  });

  it('gộp nhiều trang thành một dòng chảy', () => {
    const multiline = cleaned([{ pageNumber: 1, text: 'Dòng một.\nDòng hai.' }]);
    expect(previewOfRange(multiline, 1, 1)).toBe('Dòng một. Dòng hai.');
  });

  it('bỏ qua trang mục lục — preview không được là danh sách chương', () => {
    const withToc = cleaned([
      { pageNumber: 1, text: '', toc: true },
      { pageNumber: 2, text: 'Nội dung thật.' },
    ]);
    expect(previewOfRange(withToc, 1, 2)).toBe('Nội dung thật.');
  });

  it('bỏ qua trang rỗng để chương mở đầu bằng trang bìa vẫn có preview', () => {
    const withBlank = cleaned([
      { pageNumber: 1, text: '   ' },
      { pageNumber: 2, text: 'Nội dung thật.' },
    ]);
    expect(previewOfRange(withBlank, 1, 2)).toBe('Nội dung thật.');
  });

  it('vùng trang không có text trả chuỗi rỗng, không ném lỗi', () => {
    expect(previewOfRange(cleaned([{ pageNumber: 1, text: '' }]), 1, 1)).toBe('');
  });

  it('cắt ở ranh giới từ và thêm dấu …', () => {
    const long = cleaned([{ pageNumber: 1, text: 'alpha bravo charlie delta echo foxtrot' }]);
    const result = previewOfRange(long, 1, 1, 20);

    expect(result.endsWith('…')).toBe(true);
    expect(result.length).toBeLessThanOrEqual(21);
    // Không đứt giữa chữ
    expect(result.slice(0, -1).trimEnd().split(' ').at(-1)).not.toBe('cha');
  });

  it('không thêm … khi text vừa đủ ngắn', () => {
    expect(previewOfRange(pages, 1, 1)).toBe('Trang một.');
  });

  it('dừng đọc sớm khi đã đủ ký tự, không quét hết chương 200 trang', () => {
    const many = cleaned(
      Array.from({ length: 200 }, (_, i) => ({
        pageNumber: i + 1,
        text: `Trang ${i + 1} có nội dung khá dài để nhanh đầy hạn mức preview.`,
      })),
    );
    const result = previewOfRange(many, 1, 200, 100);
    expect(result.length).toBeLessThanOrEqual(101);
  });
});

describe('createImportSessionStore', () => {
  const registryOf = (parser: DocumentParser): ReturnType<typeof createRegistry> =>
    createRegistry([parser]);

  it('parse rồi trả preview đủ thông tin dựng màn xác nhận', async () => {
    const store = createImportSessionStore({
      registry: registryOf(
        fakeParser({
          pages: [chapterPage(1, 'Chương 1: Mở đầu'), bodyPage(2), chapterPage(3, 'Chương 2: Tiếp')],
        }),
      ),
    });

    const { preview } = await store.create('D:\\sach\\Test Book.pdf');

    expect(preview.suggestedTitle).toBe('Test Book');
    expect(preview.format).toBe('pdf');
    expect(preview.totalPages).toBe(3);
    expect(preview.hasRealPages).toBe(true);
    expect(preview.hasOutline).toBe(false);
    expect(preview.chapters.length).toBeGreaterThan(0);
  });

  it('hasOutline đúng khi PDF có bookmark', async () => {
    const store = createImportSessionStore({
      registry: registryOf(
        fakeParser({
          pages: [chapterPage(1, 'Chương 1'), bodyPage(2)],
          outline: [{ title: 'Chương 1', pageNumber: 1 }],
        }),
      ),
    });

    const { preview } = await store.create('a.pdf');
    expect(preview.hasOutline).toBe(true);
  });

  it('hasRealPages=false truyền nguyên vẹn cho DOCX', async () => {
    const store = createImportSessionStore({
      registry: registryOf(
        fakeParser({ pages: [chapterPage(1, 'Chương 1'), bodyPage(2)], hasRealPages: false }),
      ),
    });

    const { preview } = await store.create('a.pdf');
    expect(preview.hasRealPages).toBe(false);
  });

  it('giữ lại phiên để tra cứu bằng importId', async () => {
    const store = createImportSessionStore({
      registry: registryOf(fakeParser({ pages: [chapterPage(1, 'Chương 1')] })),
    });

    const { preview } = await store.create('a.pdf');
    const session = store.get(preview.importId);

    expect(session?.filePath).toBe('a.pdf');
    expect(session?.cleaned.length).toBe(1);
  });

  it('mỗi phiên có ID riêng', async () => {
    const store = createImportSessionStore({
      registry: registryOf(fakeParser({ pages: [chapterPage(1, 'A')] })),
    });

    const first = await store.create('a.pdf');
    const second = await store.create('b.pdf');
    expect(first.preview.importId).not.toBe(second.preview.importId);
  });

  it('discard giải phóng phiên', async () => {
    const store = createImportSessionStore({
      registry: registryOf(fakeParser({ pages: [chapterPage(1, 'A')] })),
    });

    const { preview } = await store.create('a.pdf');
    expect(store.discard(preview.importId)).toBe(true);
    expect(store.get(preview.importId)).toBeUndefined();
    expect(store.size()).toBe(0);
  });

  it('discard phiên không tồn tại trả false, không ném', () => {
    const store = createImportSessionStore({
      registry: registryOf(fakeParser({ pages: [chapterPage(1, 'A')] })),
    });
    expect(store.discard('không-có')).toBe(false);
  });

  it('bỏ phiên cũ nhất khi vượt trần — renderer quên cancel không được rò bộ nhớ', async () => {
    const store = createImportSessionStore({
      registry: registryOf(fakeParser({ pages: [chapterPage(1, 'A')] })),
      maxSessions: 2,
    });

    const first = await store.create('a.pdf');
    await store.create('b.pdf');
    const third = await store.create('c.pdf');

    expect(store.size()).toBe(2);
    expect(store.get(first.preview.importId)).toBeUndefined();
    expect(store.get(third.preview.importId)).toBeDefined();
  });

  it('ném ParseError khi đuôi file không hỗ trợ', async () => {
    const store = createImportSessionStore({
      registry: registryOf(fakeParser({ pages: [chapterPage(1, 'A')] })),
    });

    await expect(store.create('a.epub')).rejects.toBeInstanceOf(ParseError);
  });

  it('để ParseError của parser lọt ra ngoài nguyên vẹn', async () => {
    const scanned = new ParseError('scanned-pdf', 'PDF này là bản scan, không có text.');
    const store = createImportSessionStore({
      registry: registryOf(fakeParser({ pages: [], throws: scanned })),
    });

    await expect(store.create('a.pdf')).rejects.toMatchObject({ kind: 'scanned-pdf' });
  });
});
