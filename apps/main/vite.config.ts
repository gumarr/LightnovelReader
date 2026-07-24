import { defineConfig } from 'vite';
import { builtinModules } from 'node:module';

/**
 * Build main process. Electron nạp file này bằng CommonJS nên output là `.cjs`.
 * Module Node và `electron` để external — không bundle vào.
 */
export default defineConfig({
  ssr: {
    // Bundle TẤT CẢ dependency vào một file. Build SSR mặc định external hoá
    // mọi package trong node_modules, nhưng bản đóng gói asar không có
    // node_modules đầy đủ → app crash với "Cannot find module".
    // `better-sqlite3` là ngoại lệ duy nhất (native, khai báo ở external).
    noExternal: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    ssr: true,
    target: 'node20',
    sourcemap: true,
    lib: {
      entry: 'src/index.ts',
      formats: ['cjs'],
      fileName: () => 'index.cjs',
    },
    rollupOptions: {
      // `electron-store` là ESM-only nên phải bundle vào — để external thì
      // require() từ bundle CJS sẽ lỗi ERR_REQUIRE_ESM.
      // `better-sqlite3` là native module, bắt buộc external.
      external: [
        'electron',
        'better-sqlite3',
        ...builtinModules,
        ...builtinModules.map((m) => `node:${m}`),
      ],
    },
  },
});
