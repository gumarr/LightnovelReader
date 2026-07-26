/**
 * CHẠY THẬT — không phải test sản phẩm. Xem probe/README.md.
 *
 * Spawn sidecar Python **thật** qua supervisor **thật**. Unit test dùng tiến
 * trình giả nên không bao giờ lộ được: bắt tay có thật sự khớp giữa hai ngôn
 * ngữ không, `kill()` có giết nổi Python trên Windows không, và token main
 * sinh ra có được sidecar chấp nhận không.
 *
 * Đây đúng là loại lỗi mà PROGRESS mục 4.19 và 4.25 nói tới: mọi unit test
 * xanh mà đường nối hai đầu vẫn hỏng.
 */
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createSidecarSupervisor } from '../src/services/sidecar-supervisor.js';
import { nodeSpawnSidecar } from '../src/services/sidecar-spawn.js';
import { VENV_PYTHON_RELATIVE } from '../src/services/sidecar-paths.js';

const REPO_ROOT = resolve(__dirname, '../../..');
const VENV = resolve(REPO_ROOT, 'sidecar', VENV_PYTHON_RELATIVE);
const hasVenv = existsSync(VENV);

const logger = {
  info: (m: string, d?: string) => console.log(`  [info] ${m}${d === undefined ? '' : ` — ${d}`}`),
  warn: (m: string, d?: string) => console.log(`  [warn] ${m}${d === undefined ? '' : ` — ${d}`}`),
  error: (m: string, d?: string) => console.log(`  [ERR ] ${m}${d === undefined ? '' : ` — ${d}`}`),
};

const makeSupervisor = (overrides: Record<string, unknown> = {}) =>
  createSidecarSupervisor({
    repoRoot: REPO_ROOT,
    modelsDir: resolve(REPO_ROOT, 'sidecar', '.probe-models'),
    spawn: nodeSpawnSidecar,
    exists: existsSync,
    logger,
    baseEnv: process.env as Record<string, string>,
    ...overrides,
  });

const waitFor = async (check: () => boolean, timeoutMs: number, label: string): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Chờ quá lâu: ${label}`);
};

describe.skipIf(!hasVenv)('sidecar thật + supervisor thật', () => {
  it('khởi động, bắt tay, gọi được /health và /normalize', async () => {
    const supervisor = makeSupervisor();
    try {
      await supervisor.start();

      const status = supervisor.getStatus();
      console.log(`  Trạng thái: ${status.state}, cổng ${String(status.port)}`);
      expect(status.state).toBe('ready');
      expect(status.port).toBeGreaterThan(0);

      const client = supervisor.getClient();
      expect(client).toBeDefined();
      if (client === undefined) return;

      const health = await client.health();
      console.log(`  /health → ${JSON.stringify(health)}`);
      expect(health.status).toBe('ok');
      // Chưa có engine TTS cho tới P2.4 — supervisor phải coi đây là bình thường
      expect(health.engineReady).toBe(false);

      // Gọi thật một route CẦN token: chứng minh token main sinh ra khớp
      const normalized = await client.normalize({ text: 'Chương 12 ngày 5/6.', lang: 'vi' });
      console.log(`  /normalize → ${normalized}`);
      expect(normalized).toContain('mười hai');
    } finally {
      await supervisor.stop();
    }
  });

  it('giết tiến trình thật thì supervisor tự dựng lại', async () => {
    const supervisor = makeSupervisor({ restartDelayMs: 300 });
    try {
      await supervisor.start();
      const firstPort = supervisor.getStatus().port;
      console.log(`  Cổng lần 1: ${String(firstPort)}`);

      // Giết bằng tay như khi antivirus/OOM giết sidecar
      const client = supervisor.getClient();
      expect(client).toBeDefined();
      const pid = (await client!.health()).pid;
      console.log(`  Giết PID ${String(pid)}`);
      process.kill(pid);

      // Phải chờ supervisor NHẬN RA cái chết trước đã. Chờ thẳng `ready` thì
      // điều kiện đúng ngay từ đầu (trạng thái cũ chưa kịp đổi) và vòng chờ
      // thoát tức thì mà chẳng kiểm được gì.
      await waitFor(
        () => supervisor.getStatus().state !== 'ready',
        20_000,
        'supervisor nhận ra sidecar chết',
      );
      console.log(`  Đã nhận ra: ${supervisor.getStatus().state}`);

      await waitFor(() => supervisor.getStatus().state === 'ready', 40_000, 'dựng lại xong');

      const secondPort = supervisor.getStatus().port;
      console.log(`  Cổng lần 2: ${String(secondPort)} · restarts=${String(supervisor.getStatus().restarts)}`);

      expect(supervisor.getStatus().state).toBe('ready');
      expect(supervisor.getStatus().restarts).toBe(1);
      // Cổng 0 nên OS cấp cổng khác — chứng minh đây là tiến trình MỚI thật
      expect(secondPort).not.toBe(firstPort);

      // Sidecar mới phải phục vụ được với token MỚI
      const health = await supervisor.getClient()!.health();
      expect(health.status).toBe('ok');
      expect(health.pid).not.toBe(pid);
    } finally {
      await supervisor.stop();
    }
  });

  it('stop() giết thật tiến trình Python, không để lại mồ côi', async () => {
    const supervisor = makeSupervisor();
    await supervisor.start();

    const client = supervisor.getClient();
    const pid = (await client!.health()).pid;
    const port = supervisor.getStatus().port;

    await supervisor.stop();
    await new Promise((r) => setTimeout(r, 1_500));

    // `process.kill(pid, 0)` chỉ dò xem tiến trình còn sống, không giết
    let alive = true;
    try {
      process.kill(pid, 0);
    } catch {
      alive = false;
    }
    console.log(`  PID ${String(pid)} còn sống sau stop()? ${String(alive)}`);
    expect(alive).toBe(false);

    // Cổng phải được nhả: còn giữ thì lần mở app sau bind trượt
    const stillServing = await fetch(`http://127.0.0.1:${String(port)}/health`)
      .then(() => true)
      .catch(() => false);
    console.log(`  Cổng ${String(port)} còn phục vụ? ${String(stillServing)}`);
    expect(stillServing).toBe(false);
  });

  it('sai token thì sidecar thật từ chối — token KHÔNG phải hình thức', async () => {
    const supervisor = makeSupervisor();
    try {
      await supervisor.start();
      const port = supervisor.getStatus().port;

      const wrong = await fetch(`http://127.0.0.1:${String(port)}/normalize`, {
        method: 'POST',
        // Token phải ASCII: header HTTP là ByteString, ký tự tiếng Việt ném
        // ngay ở phía client chứ không tới được sidecar.
        headers: { 'Content-Type': 'application/json', 'X-Session-Token': 'token-gia-mao' },
        body: JSON.stringify({ text: 'xin chào', lang: 'vi' }),
      });
      console.log(`  /normalize với token bịa → ${String(wrong.status)}`);
      expect(wrong.status).toBe(401);

      const none = await fetch(`http://127.0.0.1:${String(port)}/normalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'xin chào', lang: 'vi' }),
      });
      expect(none.status).toBe(401);
    } finally {
      await supervisor.stop();
    }
  });

  it('hỏng cố định: hết lượt thử lại thì FAILED, không quay vòng vô tận', async () => {
    // Trỏ vào lệnh chạy được nhưng thoát ngay — mô phỏng sidecar chết liên tục
    const supervisor = createSidecarSupervisor({
      repoRoot: REPO_ROOT,
      modelsDir: 'C:/models',
      spawn: nodeSpawnSidecar,
      exists: existsSync,
      logger,
      baseEnv: process.env as Record<string, string>,
      maxRestarts: 2,
      restartDelayMs: 200,
      startupTimeoutMs: 8_000,
    });

    try {
      // Ép sidecar chết ngay bằng cách bỏ models dir → config.py thoát mã 2
      const broken = createSidecarSupervisor({
        repoRoot: REPO_ROOT,
        modelsDir: '',
        spawn: nodeSpawnSidecar,
        exists: existsSync,
        logger,
        baseEnv: process.env as Record<string, string>,
        maxRestarts: 2,
        restartDelayMs: 200,
        startupTimeoutMs: 8_000,
      });

      await broken.start();
      await waitFor(() => broken.getStatus().state === 'failed', 40_000, 'chuyển failed');

      const status = broken.getStatus();
      console.log(`  Kết cục: ${status.state} · ${status.message ?? ''}`);
      expect(status.state).toBe('failed');
      expect(status.message).toBeDefined();

      await broken.stop();
    } finally {
      await supervisor.stop();
    }
  });
});
