import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { findWorkerSrc, WORKER_FILE_NAME } from './node-parsers.js';

/**
 * Khoá lại cách tìm `pdf.worker.mjs`.
 *
 * Đây là lỗi đã xảy ra thật và **chỉ lộ ra khi chạy trong Electron đã bundle**
 * (xem PROGRESS.md mục 4.19): bản đóng gói không mang `node_modules`, nên nếu
 * chỉ phân giải qua `require.resolve` thì mọi lần mở PDF đều chết.
 */

const PACKAGE_JSON = 'D:\\app\\node_modules\\pdfjs-dist\\package.json';

describe('findWorkerSrc', () => {
  it('ưu tiên worker nằm cạnh bundle — bản đóng gói không có node_modules', () => {
    const result = findWorkerSrc({
      selfDir: 'D:\\app\\resources\\app.asar\\apps\\main\\dist',
      fileExists: (path) => path.endsWith(WORKER_FILE_NAME),
      resolvePackageJson: () => {
        throw new Error('Không được đụng tới node_modules khi đã có file cạnh bundle');
      },
    });

    expect(fileURLToPath(result)).toBe(
      'D:\\app\\resources\\app.asar\\apps\\main\\dist\\pdf.worker.mjs',
    );
  });

  it('rơi về node_modules khi chưa chép worker (lúc dev / chạy test)', () => {
    const result = findWorkerSrc({
      selfDir: 'D:\\repo\\packages\\parsers\\src\\parser',
      fileExists: () => false,
      resolvePackageJson: () => PACKAGE_JSON,
    });

    expect(fileURLToPath(result)).toBe(
      'D:\\app\\node_modules\\pdfjs-dist\\legacy\\build\\pdf.worker.mjs',
    );
  });

  it('luôn trả file:// URL — pdfjs import() giá trị này', () => {
    const result = findWorkerSrc({
      selfDir: 'D:\\app\\dist',
      fileExists: () => true,
      resolvePackageJson: () => PACKAGE_JSON,
    });

    // Đường dẫn Windows thô (`D:\...`) sẽ bị hiểu thành URL scheme `d:`
    expect(result.startsWith('file:///')).toBe(true);
    expect(result).not.toMatch(/^[A-Za-z]:\\/);
  });

  it('dùng bản legacy, không phải bản mặc định', () => {
    const result = findWorkerSrc({
      selfDir: 'D:\\repo\\src',
      fileExists: () => false,
      resolvePackageJson: () => PACKAGE_JSON,
    });

    // Bản mặc định cần DOMMatrix/Path2D thật — Electron main không có
    expect(result).toContain('/legacy/build/');
  });
});
