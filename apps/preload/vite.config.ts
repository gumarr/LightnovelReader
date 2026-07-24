import { defineConfig } from 'vite';
import { builtinModules } from 'node:module';

/**
 * Build preload. Với `sandbox: true`, preload phải là CommonJS đơn file —
 * không được để lại import ngoài. `@ln/shared` vì thế được bundle vào.
 */
export default defineConfig({
  build: {
    outDir: '../main/dist/preload',
    emptyOutDir: true,
    ssr: true,
    target: 'node20',
    sourcemap: true,
    lib: {
      entry: 'src/index.ts',
      formats: ['cjs'],
      fileName: () => 'index.cjs',
    },
    rollupOptions: {
      external: ['electron', ...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
    },
  },
});
