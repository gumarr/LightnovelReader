import { describe, expect, it } from 'vitest';
import { isTableOfContents, looksLikeTocEntry } from './toc.js';
import type { Page, TextLine } from '../../cleaner/types.js';

const line = (text: string, y: number): TextLine => ({
  text,
  x: 45,
  y,
  width: 342,
  height: 12,
});

const page = (texts: string[]): Page => ({
  pageNumber: 2,
  width: 432,
  height: 648,
  lines: texts.map((t, i) => line(t, 98 + i * 21)),
});

describe('looksLikeTocEntry', () => {
  it('nhận dòng mục lục có số dính liền (dạng gặp trong file mẫu)', () => {
    expect(looksLikeTocEntry('Chương Hai: Đá văng ảo tưởng77')).toBe(true);
    expect(looksLikeTocEntry('Bản quyền11')).toBe(true);
    expect(looksLikeTocEntry('Lời tác giả14')).toBe(true);
  });

  it('nhận dòng mục lục có dấu dẫn', () => {
    expect(looksLikeTocEntry('Chương Một . . . . . . 17')).toBe(true);
    expect(looksLikeTocEntry('Prologue    4')).toBe(true);
  });

  it('dòng chỉ toàn số không phải mục lục', () => {
    // Đây là số trang ở footer
    expect(looksLikeTocEntry('12')).toBe(false);
    expect(looksLikeTocEntry('  247  ')).toBe(false);
  });

  it('dòng không kết thúc bằng số thì không phải', () => {
    expect(looksLikeTocEntry('Chương Một: Trời mưa')).toBe(false);
    expect(looksLikeTocEntry('Hắn rút kiếm ra khỏi vỏ.')).toBe(false);
  });

  it('chuỗi rỗng trả false', () => {
    expect(looksLikeTocEntry('')).toBe(false);
    expect(looksLikeTocEntry('   ')).toBe(false);
  });
});

describe('isTableOfContents', () => {
  it('nhận trang mục lục thật của file mẫu VI', () => {
    const toc = page([
      'Mục lục',
      'Bản quyền11',
      'Lời tác giả14',
      'Mở đầu: Vầng trăng ngày ấy15',
      'Chương Một: Trời mưa, có khả năng xuất hiện ước mơ17',
      'Chương Hai: Đá văng ảo tưởng77',
      'Chương Ba: Đêm xanh nơi bầu trời xa xôi mà một ngày nào đó ta sẽ',
      'nhớ133',
      'Chương Bốn: Ngọn gió ngày mai203',
      'Kết: Vầng trăng hôm nay241',
      'Lời bạt243',
      'Truyện ngắn: Nhà vua và sinh nhật245',
    ]);
    expect(isTableOfContents(toc)).toBe(true);
  });

  it('trang thân bài bình thường không phải mục lục', () => {
    const body = page([
      'Hắn rút thanh kiếm ra khỏi vỏ.',
      'Ánh thép lạnh lẽo phản chiếu ánh trăng.',
      'Nàng ngẩng đầu nhìn bầu trời đêm.',
      'Không ai trả lời câu hỏi đó.',
      'Tiếng bước chân vọng lại từ xa.',
    ]);
    expect(isTableOfContents(body)).toBe(false);
  });

  it('trang có vài con số rải rác không bị nhận nhầm', () => {
    const body = page([
      'Năm đó tôi mười bảy.',
      'Chuyến tàu khởi hành lúc 7',
      'Hắn quay đi không nói gì.',
      'Ngọn nến cuối cùng vụt tắt.',
      'Trời bắt đầu đổ mưa rất to.',
      'Cơn gió lạnh thổi qua khe cửa.',
    ]);
    expect(isTableOfContents(body)).toBe(false);
  });

  it('trang quá ít dòng không suy luận', () => {
    expect(isTableOfContents(page(['Chương Một17', 'Chương Hai77']))).toBe(false);
  });

  it('trang rỗng trả false', () => {
    expect(isTableOfContents(page([]))).toBe(false);
  });

  it('ngưỡng tuỳ chỉnh được', () => {
    const mixed = page(['Chương Một17', 'Chương Hai77', 'Văn xuôi thường.', 'Văn xuôi nữa.']);
    expect(isTableOfContents(mixed, { minEntryRatio: 0.5 })).toBe(true);
    expect(isTableOfContents(mixed, { minEntryRatio: 0.9 })).toBe(false);
  });
});
