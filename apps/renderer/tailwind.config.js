import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Dev server chạy từ root workspace nên cwd khác thư mục này —
// dùng đường dẫn tuyệt đối để Tailwind luôn quét đúng file.
const here = dirname(fileURLToPath(import.meta.url));

/** @type {import('tailwindcss').Config} */
export default {
  content: [join(here, 'index.html'), join(here, 'src/**/*.{ts,tsx}')],
  darkMode: 'class',
  theme: {
    extend: {
      // Màu lấy từ CSS variable — component không hardcode hex.
      // Biến lưu kênh RGB rời nên phải bọc `rgb(... / <alpha-value>)`:
      // đó là cách duy nhất để `bg-accent/30` ra đúng màu mờ 30%.
      colors: {
        bg: 'rgb(var(--bg) / <alpha-value>)',
        'bg-elevated': 'rgb(var(--bg-elevated) / <alpha-value>)',
        'bg-subtle': 'rgb(var(--bg-subtle) / <alpha-value>)',
        fg: 'rgb(var(--fg) / <alpha-value>)',
        'fg-muted': 'rgb(var(--fg-muted) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',
        'accent-fg': 'rgb(var(--accent-fg) / <alpha-value>)',
        border: 'rgb(var(--border) / <alpha-value>)',
        danger: 'rgb(var(--danger) / <alpha-value>)',
      },
    },
  },
  plugins: [],
};
