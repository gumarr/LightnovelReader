/**
 * Chuẩn bị HTML của sách DOCX cho viewer.
 *
 * DOCX **không** lưu HTML trong DB — main convert lại từ bản copy trong
 * `libraryDir` mỗi lần mở sách rồi cache trong bộ nhớ. Đổi lại là không phải
 * migrate schema và file `.db` không phình theo nội dung sách.
 *
 * HTML này đi thẳng vào `dangerouslySetInnerHTML` ở renderer nên **bắt buộc**
 * sanitize tại đây. Renderer không được tin HTML từ main hơn mức cần thiết,
 * nhưng đây là biên duy nhất biết đủ ngữ cảnh để lọc.
 */

/**
 * Thẻ được giữ lại. Đúng bằng tập `extractBlocks` của parser nhận diện, cộng
 * mấy thẻ inline mammoth sinh ra trong đoạn văn.
 *
 * Danh sách trắng chứ không phải danh sách đen: thẻ lạ nào cũng bị bỏ, nên
 * mammoth có sinh thêm gì về sau cũng không lọt qua thành lỗ hổng.
 */
const ALLOWED_TAGS = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'strong',
  'b',
  'em',
  'i',
  'u',
  'sup',
  'sub',
  'br',
  'blockquote',
]);

/** Thẻ và toàn bộ ruột của nó bị bỏ — không chỉ bỏ thẻ mà giữ nội dung */
const DROP_WITH_CONTENT = /<(script|style|iframe|object|embed)\b[\s\S]*?<\/\1\s*>/gi;

/** Thẻ khối để đếm và đánh số — khớp với `extractBlocks` bên parser */
const BLOCK_TAG_RE = /<(h[1-6]|p)\b[^>]*>/gi;

/**
 * Lọc HTML của mammoth về tập thẻ an toàn.
 *
 * Bỏ **mọi** thuộc tính: mammoth chỉ sinh `<p>`, `<h1..6>` và vài thẻ inline
 * cho văn bản thuần, không có thuộc tính nào viewer cần. Bỏ sạch thì không
 * phải nghĩ tới `onerror=`, `href="javascript:"` hay `style` chứa `url()`.
 */
export const sanitizeDocxHtml = (html: string): string =>
  html
    .replace(DROP_WITH_CONTENT, '')
    // Bỏ comment: `<!-- -->` có thể chứa `<![if]>` mà trình duyệt vẫn diễn giải
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g, (tag, rawName: string) => {
      const name = rawName.toLowerCase();
      if (!ALLOWED_TAGS.has(name)) return '';
      // Dựng lại thẻ từ tên đã kiểm, vứt toàn bộ thuộc tính
      return tag.startsWith('</') ? `</${name}>` : `<${name}>`;
    });

/**
 * Đếm khối `<p>`/`<h1..6>` — `SegmentAnchor.nodePath = "p:<index>"` trỏ vào
 * chỉ số này, nên viewer cần biết tổng để phát hiện neo trỏ ra ngoài.
 */
export const countBlocks = (html: string): number => {
  const matches = html.match(BLOCK_TAG_RE);
  return matches === null ? 0 : matches.length;
};

/**
 * Gắn `data-block` vào từng khối để viewer tra ra phần tử theo `nodePath`.
 *
 * Đánh số **sau khi** sanitize, theo đúng thứ tự thẻ mở xuất hiện — trùng với
 * thứ tự `extractBlocks` bên parser duyệt, nên `p:3` ở đây và `p:3` lúc import
 * là cùng một đoạn văn.
 */
export const numberBlocks = (html: string): string => {
  let index = 0;
  return html.replace(BLOCK_TAG_RE, (_tag, rawName: string) => {
    const name = rawName.toLowerCase();
    const numbered = `<${name} data-block="${index}">`;
    index += 1;
    return numbered;
  });
};

/** Sanitize rồi đánh số — thứ tự này quan trọng, đảo lại là mất `data-block` */
export const prepareDocxHtml = (raw: string): { html: string; blockCount: number } => {
  const clean = sanitizeDocxHtml(raw);
  return { html: numberBlocks(clean), blockCount: countBlocks(clean) };
};
