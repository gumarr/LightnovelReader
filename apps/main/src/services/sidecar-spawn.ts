import { spawn as nodeSpawn } from 'node:child_process';
import { createLineSplitter, type SpawnSidecar } from './sidecar-process.js';

/**
 * Nối `child_process` thật vào interface `SpawnedProcess`.
 *
 * Đây là chỗ **duy nhất** trong nhánh sidecar chạm `node:child_process` — mọi
 * phần khác nhận `SpawnSidecar` qua tham số nên test được bằng tiến trình giả,
 * không phải spawn Python thật.
 */

export const nodeSpawnSidecar: SpawnSidecar = ({ command, args, cwd, env }) => {
  const child = nodeSpawn(command, args, {
    cwd,
    env,
    // `shell: false` (mặc định) là BẮT BUỘC: đường dẫn Windows có khoảng trắng
    // ("C:\Program Files\...") sẽ bị shell tách thành nhiều tham số. Ngoài ra
    // shell sinh thêm một tiến trình trung gian, và `kill()` chỉ giết cái vỏ đó
    // — Python bên trong sống sót, giữ nguyên cổng.
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');

  return {
    pid: child.pid,

    onStdoutLine: (listener) => {
      const feed = createLineSplitter(listener);
      child.stdout.on('data', feed);
      return () => child.stdout.off('data', feed);
    },

    onStderr: (listener) => {
      child.stderr.on('data', listener);
      return () => child.stderr.off('data', listener);
    },

    onExit: (listener) => {
      // `close` chứ không phải `exit`: `exit` bắn khi tiến trình chết nhưng
      // stdio có thể còn dữ liệu chưa đọc hết — dòng stderr giải thích nguyên
      // nhân chết thường nằm đúng ở phần đuôi đó.
      const handler = (code: number | null): void => listener(code);
      child.on('close', handler);
      // Spawn hỏng (không tìm thấy file, thiếu quyền) chỉ bắn `error`, không
      // bao giờ bắn `close` — không bắt thì supervisor chờ tới lúc timeout rồi
      // báo sai nguyên nhân.
      child.on('error', () => listener(null));
      return () => {
        child.off('close', handler);
      };
    },

    kill: () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill();
    },
  };
};
