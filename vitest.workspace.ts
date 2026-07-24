/**
 * Renderer cần jsdom + plugin React; main/preload/shared chạy trên node.
 * Tách project để mỗi bên có environment riêng.
 */
export default ['./vitest.config.ts', './apps/renderer/vitest.config.ts'];
