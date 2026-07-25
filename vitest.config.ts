import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'node',
    // Renderer có config riêng (jsdom) — xem vitest.workspace.ts
    include: ['packages/**/*.test.ts', 'apps/main/**/*.test.ts', 'apps/preload/**/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/release/**',
      // Script khảo sát chạy trên file trong samples/ (không commit) và in
      // báo cáo dài — chỉ chạy khi gọi tên tường minh, xem probe/README.md
      '**/probe/**',
    ],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: ['**/node_modules/**', '**/dist/**', '**/*.test.ts', '**/*.config.*'],
    },
  },
});
