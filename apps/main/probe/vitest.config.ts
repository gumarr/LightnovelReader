import { defineConfig } from 'vitest/config';

/**
 * Config riêng cho script chạy thật của main — config gốc loại `**\/probe/**`
 * khỏi `pnpm test`, nên muốn chạy phải trỏ thẳng vào file này:
 *
 *   npx vitest run -c apps/main/probe/vitest.config.ts
 */
export default defineConfig({
  test: {
    name: 'probe-main',
    include: ['apps/main/probe/*.test.ts'],
    exclude: ['**/node_modules/**'],
    environment: 'node',
    testTimeout: 300_000,
    // Báo cáo in bằng console.log là output chính, không phải nhiễu
    silent: false,
  },
});
