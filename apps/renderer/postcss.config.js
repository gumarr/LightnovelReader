import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

export default {
  plugins: {
    // Trỏ tường minh vào config của package này — dev server chạy từ root
    tailwindcss: { config: join(here, 'tailwind.config.js') },
    autoprefixer: {},
  },
};
