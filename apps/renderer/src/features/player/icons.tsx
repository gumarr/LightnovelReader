/**
 * Icon của thanh player, vẽ bằng SVG inline.
 *
 * **Vì sao không dùng emoji `⏮ ▶ ⏸ ⏭` như bản P3.2:** chúng là ký tự, nên hình
 * dạng do *font* quyết định chứ không do mình. Trên Windows chúng rơi vào Segoe
 * UI Emoji và ra hình khối màu đặc, to nhỏ không đều nhau, không ăn theo màu chữ
 * của nút — nút "phát" thì đen sì trên nền accent. Đổi theme cũng không đổi được
 * chúng vì `currentColor` không với tới ký tự emoji.
 *
 * **Vì sao không thêm thư viện icon:** CLAUDE.md cấm tự thêm dependency. Bốn
 * hình này là bốn đường `path`, không đáng một gói npm.
 *
 * Tất cả dùng `fill="currentColor"` nên tự ăn theo màu chữ của nút, đúng luật
 * "mọi màu lấy từ CSS variable" — không hardcode hex ở đây.
 */

type IconProps = {
  /** Cạnh vuông theo px. Mặc định 16 — cỡ chữ `text-sm` của thanh player */
  size?: number;
};

/**
 * `aria-hidden` trên mọi icon: nút bọc ngoài đã có `aria-label` tiếng Việt, để
 * screen reader đọc thêm hình vẽ là đọc trùng.
 */
const svgProps = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 16 16',
  fill: 'currentColor',
  'aria-hidden': true,
  focusable: false,
} as const);

/** Tam giác phải — phát */
export const PlayIcon = ({ size = 16 }: IconProps): JSX.Element => (
  <svg {...svgProps(size)}>
    <path d="M4.5 2.6c0-.5.5-.8 1-.6l8 5.4c.4.3.4.9 0 1.2l-8 5.4c-.5.3-1 0-1-.6V2.6Z" />
  </svg>
);

/** Hai thanh dọc — tạm dừng */
export const PauseIcon = ({ size = 16 }: IconProps): JSX.Element => (
  <svg {...svgProps(size)}>
    <path d="M4 2.5h2.5v11H4v-11Zm5.5 0H12v11H9.5v-11Z" />
  </svg>
);

/** Tam giác trái + vạch — đoạn trước */
export const PreviousIcon = ({ size = 16 }: IconProps): JSX.Element => (
  <svg {...svgProps(size)}>
    <path d="M3.5 3a.75.75 0 0 1 1.5 0v10a.75.75 0 0 1-1.5 0V3Zm9 .1c0-.5-.5-.8-1-.5L6.4 7.4a.75.75 0 0 0 0 1.2l5.1 4.8c.5.3 1 0 1-.5V3.1Z" />
  </svg>
);

/** Tam giác phải + vạch — đoạn sau */
export const NextIcon = ({ size = 16 }: IconProps): JSX.Element => (
  <svg {...svgProps(size)}>
    <path d="M12.5 3a.75.75 0 0 0-1.5 0v10a.75.75 0 0 0 1.5 0V3ZM3.5 3.1c0-.5.5-.8 1-.5l5.1 4.8a.75.75 0 0 1 0 1.2l-5.1 4.8c-.5.3-1 0-1-.5V3.1Z" />
  </svg>
);

/** Mũi tên xuống nhỏ — nút mở menu tốc độ */
export const ChevronDownIcon = ({ size = 12 }: IconProps): JSX.Element => (
  <svg {...svgProps(size)}>
    <path d="M3.8 6.2a.75.75 0 0 1 1.06 0L8 9.34l3.14-3.14a.75.75 0 1 1 1.06 1.06l-3.67 3.67a.75.75 0 0 1-1.06 0L3.8 7.26a.75.75 0 0 1 0-1.06Z" />
  </svg>
);
