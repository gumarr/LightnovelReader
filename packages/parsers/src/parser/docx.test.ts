import { describe, expect, it, vi } from 'vitest';
import { blocksToPages, createDocxParser, extractBlocks, stripHtml } from './docx.js';

describe('stripHtml', () => {
  it('gỡ thẻ, giữ nội dung', () => {
    expect(stripHtml('<em>Xin</em> chào <strong>bạn</strong>')).toBe('Xin chào bạn');
  });

  it('giải mã entity thường gặp', () => {
    expect(stripHtml('A &amp; B &lt;C&gt; &quot;D&quot; &#39;E&#39;')).toBe(`A & B <C> "D" 'E'`);
  });

  it('đổi <br> thành khoảng trắng', () => {
    expect(stripHtml('dòng một<br>dòng hai')).toBe('dòng một dòng hai');
  });

  it('gộp khoảng trắng thừa', () => {
    expect(stripHtml('  nhiều   khoảng    trắng  ')).toBe('nhiều khoảng trắng');
  });

  it('giữ nguyên dấu tiếng Việt', () => {
    expect(stripHtml('<p>Chương Một: Trời mưa</p>')).toBe('Chương Một: Trời mưa');
  });
});

describe('extractBlocks', () => {
  it('nhận heading kèm mức', () => {
    const blocks = extractBlocks('<h1>Chương 3 - Tâm trạng và sự thèm ăn</h1>');
    expect(blocks).toEqual([
      { text: 'Chương 3 - Tâm trạng và sự thèm ăn', headingLevel: 1, bold: false },
    ]);
  });

  it('nhận đủ h1–h6', () => {
    const html = [1, 2, 3, 4, 5, 6].map((n) => `<h${n}>Mức ${n}</h${n}>`).join('');
    expect(extractBlocks(html).map((b) => b.headingLevel)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('paragraph thường không có headingLevel', () => {
    const blocks = extractBlocks('<p>Một câu văn xuôi.</p>');
    expect(blocks[0]?.headingLevel).toBeUndefined();
    expect(blocks[0]?.text).toBe('Một câu văn xuôi.');
  });

  it('giữ đúng thứ tự xuất hiện', () => {
    const html = '<p>trước</p><h1>Tiêu đề</h1><p>sau</p>';
    expect(extractBlocks(html).map((b) => b.text)).toEqual(['trước', 'Tiêu đề', 'sau']);
  });

  it('đánh dấu bold khi cả khối in đậm', () => {
    const blocks = extractBlocks('<p><strong>Chương 4</strong></p>');
    expect(blocks[0]?.bold).toBe(true);
  });

  it('in đậm một phần thì không tính là bold', () => {
    const blocks = extractBlocks('<p>Hắn <strong>hét</strong> lên.</p>');
    expect(blocks[0]?.bold).toBe(false);
  });

  it('bỏ khối rỗng', () => {
    expect(extractBlocks('<p></p><p>  </p><p>thật</p>')).toHaveLength(1);
  });

  it('bỏ qua thẻ không phải văn bản', () => {
    // Đo trên file thật: mammoth sinh cả <img>
    const blocks = extractBlocks('<p>text</p><img src="x.png"><table><tr><td>ô</td></tr></table>');
    expect(blocks.map((b) => b.text)).toEqual(['text']);
  });

  it('xử lý thuộc tính trong thẻ', () => {
    expect(extractBlocks('<p class="a" id="b">nội dung</p>')[0]?.text).toBe('nội dung');
  });

  it('xử lý khối nhiều dòng', () => {
    expect(extractBlocks('<p>\n  nhiều\n  dòng\n</p>')[0]?.text).toBe('nhiều dòng');
  });

  it('HTML rỗng trả mảng rỗng', () => {
    expect(extractBlocks('')).toEqual([]);
  });
});

describe('blocksToPages', () => {
  it('mỗi khối thành một trang một dòng', () => {
    const pages = blocksToPages([
      { text: 'A', bold: false },
      { text: 'B', bold: false },
    ]);

    expect(pages).toHaveLength(2);
    expect(pages[0]?.pageNumber).toBe(1);
    expect(pages[1]?.pageNumber).toBe(2);
    expect(pages[0]?.lines).toHaveLength(1);
  });

  it('heading nhận cỡ chữ lớn hơn thân bài', () => {
    const pages = blocksToPages([
      { text: 'Tiêu đề', headingLevel: 1, bold: false },
      { text: 'thân bài', bold: false },
    ]);

    const heading = pages[0]?.lines[0]?.fontSize ?? 0;
    const body = pages[1]?.lines[0]?.fontSize ?? 0;
    expect(heading).toBeGreaterThan(body);
  });

  it('heading mức nhỏ hơn thì cỡ chữ nhỏ hơn', () => {
    const pages = blocksToPages([
      { text: 'h1', headingLevel: 1, bold: false },
      { text: 'h3', headingLevel: 3, bold: false },
    ]);

    expect(pages[0]?.lines[0]?.fontSize ?? 0).toBeGreaterThan(pages[1]?.lines[0]?.fontSize ?? 0);
  });

  it('khối in đậm được nâng cỡ chữ nhẹ so với thân bài', () => {
    const pages = blocksToPages([
      { text: 'đậm', bold: true },
      { text: 'thường', bold: false },
    ]);

    expect(pages[0]?.lines[0]?.fontSize ?? 0).toBeGreaterThan(pages[1]?.lines[0]?.fontSize ?? 0);
  });

  it('heading mức lạ không làm vỡ, rơi về cỡ thân bài', () => {
    const pages = blocksToPages([{ text: 'x', headingLevel: 99, bold: false }]);
    expect(pages[0]?.lines[0]?.fontSize).toBe(10);
  });

  it('mảng rỗng trả mảng rỗng', () => {
    expect(blocksToPages([])).toEqual([]);
  });
});

describe('createDocxParser', () => {
  const parserWith = (html: string) => createDocxParser(() => Promise.resolve({ html }));

  it('trả tài liệu với hasRealPages = false', async () => {
    // DOCX không có trang giấy — UI phải biết để đừng hiện "trang X–Y"
    const doc = await parserWith('<h1>Chương 1</h1><p>Nội dung.</p>').parse('a.docx');

    expect(doc.format).toBe('docx');
    expect(doc.hasRealPages).toBe(false);
    expect(doc.pages).toHaveLength(2);
    expect(doc.totalPages).toBe(2);
  });

  it('outline luôn rỗng — mammoth không đọc bookmark', async () => {
    const doc = await parserWith('<p>x</p>').parse('a.docx');
    expect(doc.outline).toEqual([]);
  });

  it('file hỏng báo corrupt-file', async () => {
    const parser = createDocxParser(() => Promise.reject(new Error('zip hỏng')));
    await expect(parser.parse('hong.docx')).rejects.toMatchObject({ kind: 'corrupt-file' });
  });

  it('tài liệu không có văn bản báo empty-document', async () => {
    await expect(parserWith('<img src="x.png">').parse('rong.docx')).rejects.toMatchObject({
      kind: 'empty-document',
    });
  });

  it('maxPages giới hạn khối đọc nhưng totalPages vẫn là thật', async () => {
    const html = Array.from({ length: 50 }, (_, i) => `<p>Đoạn ${i}</p>`).join('');
    const doc = await parserWith(html).parse('a.docx', { maxPages: 10 });

    expect(doc.pages).toHaveLength(10);
    expect(doc.totalPages).toBe(50);
  });

  it('gọi onProgress khi xong', async () => {
    const onProgress = vi.fn();
    await parserWith('<p>a</p><p>b</p>').parse('a.docx', { onProgress });
    expect(onProgress).toHaveBeenCalledWith(2, 2);
  });

  it('khai báo đúng format và đuôi file', () => {
    const parser = parserWith('');
    expect(parser.format).toBe('docx');
    expect(parser.extensions).toEqual(['.docx']);
  });
});
