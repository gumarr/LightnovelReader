import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'node',
    // Renderer có config riêng (jsdom) — xem vitest.workspace.ts
    include: ['packages/**/*.test.ts', 'apps/main/**/*.test.ts', 'apps/preload/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/release/**'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: ['**/node_modules/**', '**/dist/**', '**/*.test.ts', '**/*.config.*'],
    },
  },
});
