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
      // Màu lấy từ CSS variable — component không hardcode hex
      colors: {
        bg: 'var(--bg)',
        'bg-elevated': 'var(--bg-elevated)',
        'bg-subtle': 'var(--bg-subtle)',
        fg: 'var(--fg)',
        'fg-muted': 'var(--fg-muted)',
        accent: 'var(--accent)',
        'accent-fg': 'var(--accent-fg)',
        border: 'var(--border)',
        danger: 'var(--danger)',
      },
    },
  },
  plugins: [],
};
