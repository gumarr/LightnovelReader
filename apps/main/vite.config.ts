import { defineConfig } from 'vite';
import { builtinModules } from 'node:module';

/**
 * Build main process. Electron nạp file này bằng CommonJS nên output là `.cjs`.
 * Module Node và `electron` để external — không bundle vào.
 */
export default defineConfig({
  ssr: {
    // Mặc định build SSR external hoá mọi package trong node_modules.
    // `electron-store` là ESM-only nên phải bundle vào, nếu không bundle CJS
    // sẽ lỗi ERR_REQUIRE_ESM lúc chạy.
    noExternal: ['electron-store'],
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
