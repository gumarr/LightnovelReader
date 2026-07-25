import { describe, expect, it } from 'vitest';
import { countBlocks, numberBlocks, prepareDocxHtml, sanitizeDocxHtml } from './docx-html.js';

describe('sanitizeDocxHtml', () => {
  it('giữ thẻ văn bản mammoth sinh ra', () => {
    const html = '<h1>Chương 1</h1><p>Một đoạn <strong>đậm</strong> và <em>nghiêng</em>.</p>';
    expect(sanitizeDocxHtml(html)).toBe(html);
  });

  it('bỏ sạch thuộc tính', () => {
    // HTML này đi thẳng vào dangerouslySetInnerHTML — không thuộc tính nào
    // viewer cần, nên bỏ hết là an toàn nhất
    expect(sanitizeDocxHtml('<p class="a" style="color:red" id="x">nội dung</p>')).toBe(
      '<p>nội dung</p>',
    );
  });

  it('bỏ handler sự kiện', () => {
    expect(sanitizeDocxHtml('<p onclick="alert(1)">x</p>')).toBe('<p>x</p>');
  });

  it('bỏ thẻ script kèm cả ruột', () => {
    expect(sanitizeDocxHtml('<p>trước</p><script>alert(1)</script><p>sau</p>')).toBe(
      '<p>trước</p><p>sau</p>',
    );
  });

  it('bỏ style kèm cả ruột', () => {
    expect(sanitizeDocxHtml('<style>body{display:none}</style><p>còn</p>')).toBe('<p>còn</p>');
  });

  it('bỏ iframe', () => {
    expect(sanitizeDocxHtml('<iframe src="http://x"></iframe><p>còn</p>')).toBe('<p>còn</p>');
  });

  it('bỏ img nhưng giữ văn bản quanh nó', () => {
    // Đo trên file thật: mammoth sinh <img> cho ảnh nhúng. Phase 1 chưa hiện ảnh
    expect(sanitizeDocxHtml('<p>a</p><img src="x.png" onerror="alert(1)"><p>b</p>')).toBe(
      '<p>a</p><p>b</p>',
    );
  });

  it('bỏ link — không cho DOCX mở URL tuỳ ý', () => {
    expect(sanitizeDocxHtml('<p><a href="javascript:alert(1)">bấm</a></p>')).toBe('<p>bấm</p>');
  });

  it('bỏ comment', () => {
    expect(sanitizeDocxHtml('<p>a</p><!-- <script>x</script> --><p>b</p>')).toBe(
      '<p>a</p><p>b</p>',
    );
  });

  it('giữ nguyên thực thể HTML', () => {
    // Không giải mã: chuỗi này vào innerHTML, giải mã sớm là mở đường cho
    // `&lt;script&gt;` thành thẻ thật
    expect(sanitizeDocxHtml('<p>&lt;script&gt; &amp; &quot;x&quot;</p>')).toBe(
      '<p>&lt;script&gt; &amp; &quot;x&quot;</p>',
    );
  });

  it('thẻ viết hoa vẫn nhận ra', () => {
    expect(sanitizeDocxHtml('<P>x</P><SCRIPT>alert(1)</SCRIPT>')).toBe('<p>x</p>');
  });

  it('giữ br và blockquote', () => {
    expect(sanitizeDocxHtml('<blockquote><p>trích<br>dẫn</p></blockquote>')).toBe(
      '<blockquote><p>trích<br>dẫn</p></blockquote>',
    );
  });
});

describe('countBlocks', () => {
  it('đếm p và heading', () => {
    expect(countBlocks('<h1>a</h1><p>b</p><p>c</p>')).toBe(3);
  });

  it('không đếm thẻ inline', () => {
    expect(countBlocks('<p>a <strong>b</strong> <em>c</em></p>')).toBe(1);
  });

  it('HTML rỗng cho 0', () => {
    expect(countBlocks('')).toBe(0);
  });
});

describe('numberBlocks', () => {
  it('đánh số theo thứ tự xuất hiện', () => {
    expect(numberBlocks('<h1>a</h1><p>b</p>')).toBe(
      '<h1 data-block="0">a</h1><p data-block="1">b</p>',
    );
  });

  it('chỉ số khớp với thứ tự parser duyệt khối', () => {
    // `nodePath = "p:<index>"` sinh lúc import đếm theo đúng thứ tự này —
    // lệch một nấc là viewer cuộn sai đoạn
    const numbered = numberBlocks('<p>zero</p><h2>one</h2><p>two</p>');
    expect(numbered).toContain('<p data-block="2">two</p>');
  });
});

describe('prepareDocxHtml', () => {
  it('sanitize trước rồi mới đánh số', () => {
    // Đảo thứ tự thì `data-block` bị chính bước sanitize xoá mất
    const result = prepareDocxHtml('<p class="x">a</p><script>bad()</script><p>b</p>');
    expect(result.html).toBe('<p data-block="0">a</p><p data-block="1">b</p>');
    expect(result.blockCount).toBe(2);
  });

  it('khối bị bỏ không chiếm chỉ số', () => {
    const result = prepareDocxHtml('<p>a</p><div>bỏ</div><p>b</p>');
    expect(result.html).toBe('<p data-block="0">a</p>bỏ<p data-block="1">b</p>');
  });
});
