import { defineConfig } from 'vitest/config';

/**
 * Config riêng cho script khảo sát — config gốc loại `**\/probe/**` khỏi
 * `pnpm test`, nên muốn chạy phải trỏ thẳng vào file này:
 *
 *   npx vitest run -c packages/parsers/probe/vitest.config.ts
 */
export default defineConfig({
  test: {
    name: 'probe',
    include: ['packages/parsers/probe/*.test.ts'],
    exclude: ['**/node_modules/**'],
    environment: 'node',
    testTimeout: 300_000,
    // Báo cáo in bằng console.log là output chính, không phải nhiễu
    silent: false,
  },
});
