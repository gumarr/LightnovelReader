import { describe, expect, it } from 'vitest';
import { findRepeatedKeys, normalizeForMatch, stripHeadersFooters } from './header-footer.js';
import type { Page, TextLine } from './types.js';

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;

const line = (text: string, y: number, x = 60, width = 400): TextLine => ({
  text,
  x,
  y,
  width,
  height: 12,
});

/** Sinh sách nhiều trang: mỗi trang có header, thân, footer theo hàm truyền vào */
const makeBook = (
  count: number,
  build: (pageNumber: number) => TextLine[],
  height = PAGE_HEIGHT,
): Page[] =>
  Array.from({ length: count }, (_, i) => ({
    pageNumber: i + 1,
    width: PAGE_WIDTH,
    height,
    lines: build(i + 1),
  }));

const textsOf = (page: Page | undefined): string[] => (page?.lines ?? []).map((l) => l.text);

describe('normalizeForMatch', () => {
  it('thay cụm số bằng # để số trang khác nhau vẫn cùng mẫu', () => {
    expect(normalizeForMatch('Trang 12')).toBe(normalizeForMatch('Trang 137'));
  });

  it('gộp khoảng trắng và bỏ phân biệt hoa thường', () => {
    expect(normalizeForMatch('  Kiếm   Vực  ')).toBe(normalizeForMatch('kiếm vực'));
  });

  it('không gộp hai tiêu đề khác nội dung', () => {
    expect(normalizeForMatch('Chương 1')).not.toBe(normalizeForMatch('Phần 1'));
  });
});

describe('phát hiện header/footer lặp', () => {
  it('loại tên sách chạy đầu trang xuất hiện trên mọi trang', () => {
    const pages = makeBook(10, (n) => [
      line('Kiếm Vực Thần Đế', 20),
      line(`Nội dung thân trang ${n}.`, 400),
      line(`${n}`, 810, 290, 20),
    ]);

    const cleaned = stripHeadersFooters(pages);

    expect(textsOf(cleaned[0])).toEqual(['Nội dung thân trang 1.']);
    expect(textsOf(cleaned[9])).toEqual(['Nội dung thân trang 10.']);
  });

  it('loại số trang dù mỗi trang một con số khác nhau', () => {
    const pages = makeBook(8, (n) => [line(`Trang ${n}`, 815, 280, 60), line('Thân bài.', 400)]);

    for (const page of stripHeadersFooters(pages)) {
      expect(textsOf(page)).toEqual(['Thân bài.']);
    }
  });

  it('giữ lại dòng chỉ xuất hiện trên ít trang', () => {
    // 10 trang, chỉ 3 trang có dòng ghi chú ở footer → dưới ngưỡng 60%
    const pages = makeBook(10, (n) =>
      n <= 3 ? [line('Ghi chú của người dịch', 815), line('Thân bài.', 400)] : [line('Thân bài.', 400)],
    );

    expect(textsOf(stripHeadersFooters(pages)[0])).toEqual([
      'Ghi chú của người dịch',
      'Thân bài.',
    ]);
  });

  it('không đụng vào dòng nằm giữa trang dù lặp lại', () => {
    // Câu thoại lặp ở giữa trang: đúng vùng body → không phải header/footer
    const pages = makeBook(10, () => [line('Header sách', 20), line('Ta sẽ trở lại.', 400)]);

    for (const page of stripHeadersFooters(pages)) {
      expect(textsOf(page)).toEqual(['Ta sẽ trở lại.']);
    }
  });

  it('cùng nội dung nhưng khác vùng dọc thì không gộp thành một mẫu', () => {
    // Nửa số trang đặt ở header, nửa ở footer → mỗi bên chỉ 50% < 60%
    const pages = makeBook(10, (n) =>
      n % 2 === 0 ? [line('Kiếm Vực', 20), line('Thân.', 400)] : [line('Kiếm Vực', 815), line('Thân.', 400)],
    );

    expect(textsOf(stripHeadersFooters(pages)[0])).toContain('Kiếm Vực');
  });

  it('sách quá ít trang thì không suy luận thống kê', () => {
    const pages = makeBook(3, () => [line('Kiếm Vực', 20), line('Thân.', 400)]);

    for (const page of stripHeadersFooters(pages)) {
      expect(textsOf(page)).toEqual(['Kiếm Vực', 'Thân.']);
    }
  });

  it('một trang lặp cùng dòng hai lần chỉ tính một phiếu', () => {
    // 4 trang: chỉ trang 1 có dòng đó, nhưng lặp 8 lần trong trang
    const pages = makeBook(4, (n) =>
      n === 1
        ? [
            ...Array.from({ length: 8 }, () => line('Quảng cáo', 20)),
            line('Thân.', 400),
          ]
        : [line('Thân.', 400)],
    );

    expect(textsOf(stripHeadersFooters(pages)[0]).filter((t) => t === 'Quảng cáo')).toHaveLength(8);
  });

  it('không xoá dòng thân bài lọt vào vùng lề', () => {
    // Trang tràn chữ: dòng đầu thân bài nằm sát mép trên. Nội dung mỗi trang
    // mỗi khác nên không được coi là mẫu lặp.
    const bodies = [
      'Hắn rút kiếm ra khỏi vỏ.',
      'Cơn gió lạnh thổi qua khe cửa.',
      'Nàng ngẩng đầu nhìn bầu trời.',
      'Tiếng bước chân vọng lại từ xa.',
      'Ngọn nến cuối cùng vụt tắt.',
      'Không ai trả lời câu hỏi đó.',
      'Bóng tối nuốt chửng con hẻm.',
      'Trời bắt đầu đổ mưa rất to.',
    ];
    const pages = makeBook(8, (n) => [
      line(bodies[n - 1] ?? '', 60, 20, 470),
      line('Thân.', 400),
    ]);

    expect(textsOf(stripHeadersFooters(pages)[0])).toEqual([bodies[0], 'Thân.']);
  });

  it('dòng dài quá maxLength không bị coi là header dù lặp y hệt', () => {
    // Chặn theo độ dài là lưới an toàn cuối: running head thật luôn ngắn.
    const long =
      'Kiếm Vực Thần Đế — Quyển Một — Bản dịch của nhóm dịch giả nào đó, dài quá ngưỡng mặc định tám mươi ký tự';
    const pages = makeBook(8, () => [line(long, 60, 20, 470), line('Thân.', 400)]);

    expect(textsOf(stripHeadersFooters(pages)[0])).toEqual([long, 'Thân.']);
    expect(textsOf(stripHeadersFooters(pages, { maxLength: 200 })[0])).toEqual(['Thân.']);
  });

  it('ngưỡng minRatio tuỳ chỉnh được', () => {
    const pages = makeBook(10, (n) => (n <= 4 ? [line('Nhãn', 20)] : [line('Thân.', 400)]));

    expect(findRepeatedKeys(pages, { minRatio: 0.4 }).size).toBe(1);
    expect(findRepeatedKeys(pages, { minRatio: 0.5 }).size).toBe(0);
  });
});

describe('tính thuần khiết', () => {
  it('không sửa mảng trang đầu vào', () => {
    const pages = makeBook(10, () => [line('Header sách', 20), line('Thân.', 400)]);
    const before = pages.map((p) => p.lines.length);

    stripHeadersFooters(pages);

    expect(pages.map((p) => p.lines.length)).toEqual(before);
  });

  it('trả về mảng mới ngay cả khi không có gì để loại', () => {
    const pages = makeBook(10, () => [line('Thân.', 400)]);
    const cleaned = stripHeadersFooters(pages);

    expect(cleaned[0]).not.toBe(pages[0]);
    expect(textsOf(cleaned[0])).toEqual(['Thân.']);
  });
});
