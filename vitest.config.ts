import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Test nằm cạnh source trong từng package
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts', 'apps/**/*.test.tsx'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/release/**'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: ['**/node_modules/**', '**/dist/**', '**/*.test.ts', '**/*.config.*'],
    },
  },
});
