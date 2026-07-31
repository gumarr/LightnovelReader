#!/usr/bin/env node
/**
 * Sinh `resources/icon.ico` từ mã nguồn, không cần thư viện ảnh.
 *
 * **Vì sao tự vẽ thay vì thêm dependency:** CLAUDE.md cấm thêm dependency khi
 * chưa hỏi, mà `sharp`/`jimp`/`to-ico` đều là bản cài lớn (sharp kéo theo binary
 * native theo nền tảng) chỉ để tạo **một file duy nhất, đổi vài năm một lần**.
 * Pillow có trong Python hệ thống nhưng **không** có trong `sidecar/.venv`, nên
 * dựa vào nó là dựng một cái bẫy: máy khác chạy sẽ hỏng.
 *
 * `.ico` thật ra rất đơn giản: một header 6 byte, mỗi ảnh một mục 16 byte, rồi
 * dữ liệu ảnh nối đuôi. Windows Vista trở lên đọc được PNG nhúng thẳng, nên chỉ
 * cần encode PNG — mà PNG chỉ là vài chunk bọc quanh `zlib.deflate`, có sẵn
 * trong `node:zlib`.
 *
 * Chạy: `pnpm build:icon` (đã tự gọi trong `build:win`).
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Kích thước Windows thật sự dùng. 256 cho màn hình lớn/Explorer cỡ "extra
 * large", 16 cho titlebar và taskbar ở DPI 100%. Thiếu cỡ nhỏ thì Windows tự
 * thu từ bản lớn và chữ bị nhoè.
 */
const SIZES = [16, 24, 32, 48, 64, 128, 256];

/* ------------------------------------------------------------------ PNG */

const crcTable = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = (crcTable[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/** Một chunk PNG: [độ dài][kiểu][dữ liệu][crc của kiểu+dữ liệu] */
const chunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
};

/**
 * RGBA thô → PNG.
 *
 * Dùng filter 0 (None) cho mọi hàng: ảnh nhỏ, và filter chỉ giúp nén tốt hơn
 * chứ không đổi kết quả hiển thị. Đơn giản hơn = ít chỗ sai hơn.
 */
const encodePng = (width, height, rgba) => {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8 bit mỗi kênh
  ihdr[9] = 6; // truecolour + alpha
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

/* ----------------------------------------------------------------- vẽ */

/** Màu `--accent` của theme sáng (`theme.css`) — icon phải cùng nhận diện với app */
const ACCENT = [79, 70, 229];
const ACCENT_LIGHT = [129, 140, 248];
const PAGE = [255, 255, 255];

const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Độ phủ của một hình, lấy mẫu 3×3 trong mỗi pixel để bớt răng cưa.
 *
 * Không có anti-alias thì icon 16 px trông như bậc thang. Lấy mẫu siêu phân
 * giải là cách ít mã nhất đạt được điều đó — không cần thư viện vẽ.
 */
const coverage = (x, y, inside) => {
  let hits = 0;
  for (let sy = 0; sy < 3; sy += 1) {
    for (let sx = 0; sx < 3; sx += 1) {
      if (inside(x + (sx + 0.5) / 3, y + (sy + 0.5) / 3)) hits += 1;
    }
  }
  return hits / 9;
};

/**
 * Vẽ icon: một cuốn sách mở, với "sóng âm" xếp trên trang phải.
 *
 * Ý đồ: sách = đọc light novel, sóng âm = TTS đọc thành tiếng — đúng hai thứ
 * app này làm. Vẽ theo toạ độ 0..1 rồi nhân theo `size` nên mọi cỡ đều cân.
 */
const drawIcon = (size) => {
  const rgba = Buffer.alloc(size * size * 4);
  const u = (v) => v * size;

  // Nền bo tròn kiểu icon Windows 11
  const radius = u(0.18);
  const insideBg = (px, py) => {
    const x = px;
    const y = py;
    const min = u(0.045);
    const max = size - u(0.045);
    const cx = Math.min(Math.max(x, min + radius), max - radius);
    const cy = Math.min(Math.max(y, min + radius), max - radius);
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2 + 1e-9;
  };

  /**
   * Rãnh giữa hai trang.
   *
   * **Phải là khoảng HỞ thật, không phải một vạch mảnh.** Bản vẽ đầu dùng vạch
   * `0.022` và kết quả là hai trang dính thành một khối trắng phẳng — nhìn ra
   * tờ giấy chứ không ra cuốn sách. Rãnh rộng để nền accent xuyên qua giữa mới
   * tách được hai trang bằng mắt.
   */
  const gutterHalf = size >= 32 ? u(0.035) : u(0.055);
  const mid = size / 2;

  const bookTop = u(0.26);
  const bookBottom = u(0.75);
  const bookLeft = u(0.14);
  const bookRight = size - u(0.14);

  /**
   * Mép trên của trang, cong xuống ở phía ngoài.
   *
   * Ở gáy thì trang cao nhất, ra mép ngoài thì thấp dần — đúng dáng cuốn sách
   * mở nhìn hơi chếch. Biên độ `0.1` (bản đầu `0.05` gần như không thấy).
   */
  const pageTopAt = (x) => {
    const half = mid - bookLeft;
    const t = Math.min(Math.abs(x - mid) / half, 1);
    return bookTop + u(0.1) * t * t;
  };

  /** Mép dưới cũng cong nhẹ ngược lại, cho khối trang dày dặn hơn */
  const pageBottomAt = (x) => {
    const half = mid - bookLeft;
    const t = Math.min(Math.abs(x - mid) / half, 1);
    return bookBottom - u(0.035) * t * t;
  };

  const insidePage = (x, y) =>
    x >= bookLeft &&
    x <= bookRight &&
    Math.abs(x - mid) >= gutterHalf &&
    y >= pageTopAt(x) &&
    y <= pageBottomAt(x);

  /**
   * Ba vạch sóng âm trên trang phải — TTS đọc thành tiếng.
   *
   * Bỏ hẳn ở cỡ < 32 px: vạch chỉ còn ~1 px, vẽ ra thành vệt xám làm bẩn icon.
   * Cỡ nhỏ ưu tiên đọc được hình khối lớn (sách mở).
   */
  const bars = size >= 32 ? [0.12, 0.2, 0.15] : [];
  const insideBar = (x, y) => {
    if (bars.length === 0) return false;
    const barWidth = u(0.028);
    const gap = u(0.028);
    const total = bars.length * barWidth + (bars.length - 1) * gap;
    // Canh giữa trang phải để không dính gáy cũng không tràn mép
    const startX = (mid + gutterHalf + bookRight) / 2 - total / 2;
    const centerY = u(0.52);
    for (let i = 0; i < bars.length; i += 1) {
      const bx = startX + i * (barWidth + gap);
      const halfHeight = u(bars[i] ?? 0) / 2;
      if (x >= bx && x <= bx + barWidth && Math.abs(y - centerY) <= halfHeight) return true;
    }
    return false;
  };

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4;

      const bg = coverage(x, y, insideBg);
      if (bg === 0) continue;

      // Nền chuyển màu chéo cho đỡ phẳng
      const t = (x / size) * 0.5 + (y / size) * 0.5;
      let r = lerp(ACCENT[0], ACCENT_LIGHT[0], t);
      let g = lerp(ACCENT[1], ACCENT_LIGHT[1], t);
      let b = lerp(ACCENT[2], ACCENT_LIGHT[2], t);
      let a = 255 * bg;

      // Trang giấy đè lên nền
      const page = coverage(x, y, insidePage);
      if (page > 0) {
        r = lerp(r, PAGE[0], page);
        g = lerp(g, PAGE[1], page);
        b = lerp(b, PAGE[2], page);
        a = Math.max(a, 255 * page * bg);
      }

      // Sóng âm dùng lại màu accent để "khoét" ngược lên trang trắng
      const ink = coverage(x, y, insideBar);
      if (ink > 0) {
        r = lerp(r, ACCENT[0], ink);
        g = lerp(g, ACCENT[1], ink);
        b = lerp(b, ACCENT[2], ink);
      }

      rgba[i] = Math.round(r);
      rgba[i + 1] = Math.round(g);
      rgba[i + 2] = Math.round(b);
      rgba[i + 3] = Math.round(a);
    }
  }

  return rgba;
};

/* ----------------------------------------------------------------- ICO */

/**
 * Đóng gói nhiều PNG thành `.ico`.
 *
 * Cấu trúc: ICONDIR 6 byte, rồi mỗi ảnh một ICONDIRENTRY 16 byte, rồi dữ liệu.
 * Trường `width`/`height` là 1 byte, nên **256 phải ghi là 0** — đó là quy ước
 * của định dạng, ghi 256 sẽ tràn thành 0 một cách tình cờ chứ không phải cố ý.
 */
const buildIco = (images) => {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(images.length, 4);

  const entries = [];
  let offset = 6 + images.length * 16;

  for (const { size, data } of images) {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry[2] = 0; // số màu bảng màu — 0 vì dùng truecolour
    entry[3] = 0; // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bit mỗi pixel
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += data.length;
  }

  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
};

/* ---------------------------------------------------------------- chạy */

const images = SIZES.map((size) => ({
  size,
  data: encodePng(size, size, drawIcon(size)),
}));

const ico = buildIco(images);

mkdirSync(join(ROOT, 'resources'), { recursive: true });
writeFileSync(join(ROOT, 'resources', 'icon.ico'), ico);

// PNG 256 riêng: Linux/macOS build và README dùng được, không phải giải nén .ico
writeFileSync(join(ROOT, 'resources', 'icon.png'), images.at(-1).data);

console.log(
  `[icon] resources/icon.ico — ${SIZES.length} cỡ (${SIZES.join(', ')}), ${(ico.length / 1024).toFixed(1)} KB`,
);
console.log(`[icon] resources/icon.png — 256×256`);
