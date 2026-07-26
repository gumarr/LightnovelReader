import { describe, expect, it, vi } from 'vitest';
import type { SidecarStatus } from '@ln/shared';
import { createSidecarSupervisor, type SupervisorDeps } from './sidecar-supervisor.js';
import { READY_PREFIX, type SpawnedProcess } from './sidecar-process.js';
import type { FetchLike } from './sidecar-client.js';
import { VENV_PYTHON_RELATIVE } from './sidecar-paths.js';
import { join } from 'node:path';

/**
 * Test chính sách restart bằng đồng hồ giả và tiến trình giả.
 *
 * Không spawn Python thật ở đây: cần kiểm được cả những tình huống rất khó dựng
 * thật (chết đúng 4 lần liên tiếp, sống ổn 2 phút rồi mới chết). Phần nối với
 * sidecar thật kiểm riêng bằng bản chạy thật — xem PROGRESS.
 */

const devPython = join('D:/repo', 'sidecar', VENV_PYTHON_RELATIVE);

type FakeProcess = SpawnedProcess & {
  emitStdout: (line: string) => void;
  emitExit: (code: number | null) => void;
  killed: () => boolean;
};

const createFakeProcess = (): FakeProcess => {
  const stdout: ((line: string) => void)[] = [];
  const stderr: ((chunk: string) => void)[] = [];
  const exit: ((code: number | null) => void)[] = [];
  let killed = false;

  const add = <T>(list: T[], listener: T): (() => void) => {
    list.push(listener);
    return () => {
      const i = list.indexOf(listener);
      if (i !== -1) list.splice(i, 1);
    };
  };

  return {
    pid: 1,
    onStdoutLine: (l) => add(stdout, l),
    onStderr: (l) => add(stderr, l),
    onExit: (l) => add(exit, l),
    kill: () => {
      killed = true;
    },
    emitStdout: (line) => {
      for (const l of [...stdout]) l(line);
    },
    emitExit: (code) => {
      for (const l of [...exit]) l(code);
    },
    killed: () => killed,
  };
};

/** Đồng hồ giả: chạy timer theo lệnh, không chờ thật */
const createFakeClock = () => {
  let time = 0;
  const timers = new Map<number, { fn: () => void; at: number }>();
  let nextId = 1;

  return {
    now: () => time,
    setTimer: (fn: () => void, ms: number): NodeJS.Timeout => {
      const id = nextId++;
      timers.set(id, { fn, at: time + ms });
      return id as unknown as NodeJS.Timeout;
    },
    clearTimer: (timer: NodeJS.Timeout): void => {
      timers.delete(timer as unknown as number);
    },
    /** Nhảy thời gian tới, chạy mọi timer đã tới hạn */
    advance: (ms: number): void => {
      time += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.at <= time) {
          timers.delete(id);
          timer.fn();
        }
      }
    },
    pending: () => timers.size,
  };
};

const healthOk: FetchLike = async () => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify({ status: 'ok', version: '0.1.0', pid: 1, engine_ready: false }),
});

const healthFails: FetchLike = () => Promise.reject(new Error('ECONNREFUSED'));

const silentLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

/**
 * Dựng supervisor kèm hàng đợi tiến trình giả. Mỗi lần spawn lấy một tiến
 * trình mới, để test dựng được kịch bản "chết rồi sống lại nhiều lần".
 */
const setup = (overrides: Partial<SupervisorDeps> = {}) => {
  const clock = createFakeClock();
  const processes: FakeProcess[] = [];
  const statuses: SidecarStatus[] = [];

  const supervisor = createSidecarSupervisor({
    repoRoot: 'D:/repo',
    modelsDir: 'C:/models',
    exists: (path) => path === devPython,
    spawn: () => {
      const proc = createFakeProcess();
      processes.push(proc);
      return proc;
    },
    logger: { ...silentLogger },
    onStatusChanged: (status) => statuses.push({ ...status }),
    fetchImpl: healthOk,
    healthIntervalMs: 5_000,
    restartDelayMs: 1_000,
    startupTimeoutMs: 30_000,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    ...overrides,
  });

  /** Bắt tay cho tiến trình mới nhất */
  const handshake = (port = 50000): void => {
    const proc = processes[processes.length - 1];
    proc?.emitStdout(`${READY_PREFIX}{"host":"127.0.0.1","port":${String(port)},"pid":9}`);
  };

  return { supervisor, clock, processes, statuses, handshake };
};

describe('createSidecarSupervisor — khởi động', () => {
  it('bắt tay xong thì trạng thái ready kèm cổng', async () => {
    const { supervisor, handshake } = setup();

    const started = supervisor.start();
    handshake(50123);
    await started;

    expect(supervisor.getStatus()).toMatchObject({
      state: 'ready',
      port: 50123,
      restarts: 0,
      engineReady: false,
    });
  });

  it('client chỉ có sau khi sẵn sàng', async () => {
    const { supervisor, handshake } = setup();
    expect(supervisor.getClient()).toBeUndefined();

    const started = supervisor.start();
    handshake();
    await started;

    expect(supervisor.getClient()?.baseUrl).toBe('http://127.0.0.1:50000');
  });

  it('không tìm thấy sidecar thì FAILED ngay, không đốt lượt restart', async () => {
    // Thiếu file là hỏng cố định — thử lại ba lần cũng vô ích, chỉ tổ chậm.
    const { supervisor, processes } = setup({ exists: () => false });

    await supervisor.start();

    expect(supervisor.getStatus().state).toBe('failed');
    expect(supervisor.getStatus().restarts).toBe(0);
    expect(processes).toHaveLength(0);
  });

  it('thông báo lúc dev chỉ rõ cách dựng venv', async () => {
    const { supervisor } = setup({ exists: () => false });
    await supervisor.start();
    expect(supervisor.getStatus().message).toContain('venv');
  });

  it('engine chưa nạp KHÔNG phải lỗi — /health trả engine_ready=false tới tận P2.4', async () => {
    const { supervisor, handshake } = setup();
    const started = supervisor.start();
    handshake();
    await started;

    await supervisor.checkHealthNow();

    expect(supervisor.getStatus().state).toBe('ready');
    expect(supervisor.getStatus().engineReady).toBe(false);
  });
});

describe('createSidecarSupervisor — restart', () => {
  it('tiến trình chết thì chuyển restarting rồi spawn lại sau khi hết delay', async () => {
    const { supervisor, clock, processes, handshake } = setup();

    const started = supervisor.start();
    handshake();
    await started;

    processes[0]?.emitExit(1);
    expect(supervisor.getStatus()).toMatchObject({ state: 'restarting', restarts: 1 });
    expect(processes).toHaveLength(1);

    clock.advance(1_000);
    expect(processes).toHaveLength(2);

    handshake(50999);
    await Promise.resolve();
    await Promise.resolve();
    expect(supervisor.getStatus()).toMatchObject({ state: 'ready', port: 50999 });
  });

  it('chết quá số lượt cho phép thì FAILED và ngừng spawn', async () => {
    const { supervisor, clock, processes, handshake } = setup({ maxRestarts: 3 });

    const started = supervisor.start();
    handshake();
    await started;

    // Chết lần 1, 2, 3 → mỗi lần đều thử lại
    for (let i = 0; i < 3; i++) {
      processes[processes.length - 1]?.emitExit(1);
      expect(supervisor.getStatus().state).toBe('restarting');
      clock.advance(1_000);
      handshake();
      await Promise.resolve();
      await Promise.resolve();
    }

    expect(processes).toHaveLength(4);

    // Lần chết thứ 4 vượt trần → bó tay
    processes[processes.length - 1]?.emitExit(1);
    expect(supervisor.getStatus().state).toBe('failed');

    clock.advance(10_000);
    expect(processes).toHaveLength(4);
  });

  it('chết LIÊN TIẾP ngay lúc khởi động vẫn đếm đủ lượt rồi mới bó tay', async () => {
    // Lỗi thật tìm được khi chạy với sidecar Python chết ngay (thiếu env):
    // khử trùng lặp theo trạng thái khiến lần chết thứ hai trở đi bị nuốt —
    // supervisor đứng im ở `restarting` vĩnh viễn, không bao giờ tới `failed`.
    // Tiến trình giả bắt tay bình thường nên chỉ kịch bản này mới lộ ra.
    const { supervisor, clock, processes } = setup({ maxRestarts: 2 });

    const started = supervisor.start();
    processes[0]?.emitExit(2);
    await started;
    expect(supervisor.getStatus()).toMatchObject({ state: 'restarting', restarts: 1 });

    clock.advance(1_000);
    await Promise.resolve();
    await Promise.resolve();
    expect(processes).toHaveLength(2);
    processes[1]?.emitExit(2);
    // `launch()` của lần thử lại chạy ngoài `await` nên `catch` của nó cần một
    // vòng microtask mới tới lượt.
    await Promise.resolve();
    await Promise.resolve();
    expect(supervisor.getStatus()).toMatchObject({ state: 'restarting', restarts: 2 });

    clock.advance(1_000);
    await Promise.resolve();
    await Promise.resolve();
    processes[2]?.emitExit(2);
    await Promise.resolve();
    await Promise.resolve();

    expect(supervisor.getStatus().state).toBe('failed');
    expect(processes).toHaveLength(3);
  });

  it('health check trả về muộn KHÔNG giết oan tiến trình đã dựng lại', async () => {
    // Request /health kéo dài vài giây; trong lúc đó sidecar chết và được dựng
    // lại. Báo hỏng theo kết quả cũ sẽ giết nhầm tiến trình mới hoàn toàn khoẻ.
    let release: ((value: never) => void) | undefined;
    const hanging: FetchLike = () =>
      new Promise((_resolve, rejectFn) => {
        release = rejectFn as (value: never) => void;
      });

    const { supervisor, clock, processes, handshake } = setup({ fetchImpl: hanging });

    const started = supervisor.start();
    handshake();
    await started;

    const pending = supervisor.checkHealthNow();

    // Sidecar chết và được dựng lại trong lúc health check còn treo
    processes[0]?.emitExit(1);
    clock.advance(1_000);
    handshake(50777);
    await Promise.resolve();
    await Promise.resolve();
    expect(supervisor.getStatus()).toMatchObject({ state: 'ready', restarts: 1 });

    // Giờ health check của lần chạy CŨ mới hỏng
    release?.(new Error('ECONNREFUSED') as never);
    await pending;

    expect(supervisor.getStatus()).toMatchObject({ state: 'ready', restarts: 1 });
  });

  it('trạng thái failed nói rõ phải làm gì', async () => {
    const { supervisor, clock, processes, handshake } = setup({ maxRestarts: 1 });

    const started = supervisor.start();
    handshake();
    await started;

    processes[0]?.emitExit(1);
    clock.advance(1_000);
    handshake();
    await Promise.resolve();
    await Promise.resolve();
    processes[processes.length - 1]?.emitExit(1);

    expect(supervisor.getStatus().message).toMatch(/Khởi động lại ứng dụng/);
  });

  it('sống ổn định đủ lâu thì bộ đếm restart về lại 1', async () => {
    // Chết 2 lần cách nhau nhiều giờ khác hẳn chết 2 lần trong 10 giây —
    // cái đầu đã tự phục hồi, không được cộng dồn để rồi bó tay oan.
    const { supervisor, clock, processes, handshake } = setup({ stableMs: 60_000 });

    const started = supervisor.start();
    handshake();
    await started;

    processes[0]?.emitExit(1);
    expect(supervisor.getStatus().restarts).toBe(1);

    clock.advance(1_000);
    handshake();
    await Promise.resolve();
    await Promise.resolve();

    // Sống yên 5 phút rồi mới chết
    clock.advance(300_000);
    processes[processes.length - 1]?.emitExit(1);

    expect(supervisor.getStatus().restarts).toBe(1);
  });

  it('chết liên tiếp trong thời gian ngắn thì bộ đếm CỘNG DỒN', async () => {
    const { supervisor, clock, processes, handshake } = setup({ stableMs: 60_000 });

    const started = supervisor.start();
    handshake();
    await started;

    processes[0]?.emitExit(1);
    clock.advance(1_000);
    handshake();
    await Promise.resolve();
    await Promise.resolve();

    // Chỉ sống 2 giây — chưa đủ coi là ổn định
    clock.advance(2_000);
    processes[processes.length - 1]?.emitExit(1);

    expect(supervisor.getStatus().restarts).toBe(2);
  });

  it('exit và health check hỏng cùng lúc chỉ tính MỘT lượt', async () => {
    const { supervisor, processes, handshake } = setup({ fetchImpl: healthFails });

    const started = supervisor.start();
    handshake();
    await started;

    processes[0]?.emitExit(1);
    await supervisor.checkHealthNow();

    expect(supervisor.getStatus().restarts).toBe(1);
  });

  it('health check thất bại cũng kích hoạt restart', async () => {
    // Sidecar còn sống nhưng không trả lời — `exit` không bao giờ bắn, chỉ
    // health check bắt được.
    const { supervisor, handshake } = setup({ fetchImpl: healthFails });

    const started = supervisor.start();
    handshake();
    await started;

    await supervisor.checkHealthNow();

    expect(supervisor.getStatus().state).toBe('restarting');
  });

  it('health check chạy lại theo chu kỳ khi vẫn khoẻ', async () => {
    const calls: string[] = [];
    const counting: FetchLike = async (url) => {
      calls.push(url);
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ status: 'ok', version: '1', pid: 1, engine_ready: false }),
      };
    };

    const { supervisor, clock, handshake } = setup({ fetchImpl: counting, healthIntervalMs: 5_000 });
    const started = supervisor.start();
    handshake();
    await started;

    clock.advance(5_000);
    await Promise.resolve();
    await Promise.resolve();

    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(calls[0]).toContain('/health');
  });
});

describe('createSidecarSupervisor — dừng', () => {
  it('stop() giết tiến trình và chuyển stopped', async () => {
    const { supervisor, processes, handshake } = setup();

    const started = supervisor.start();
    handshake();
    await started;
    await supervisor.stop();

    expect(processes[0]?.killed()).toBe(true);
    expect(supervisor.getStatus().state).toBe('stopped');
  });

  it('sau stop() thì tiến trình chết KHÔNG kích hoạt restart', async () => {
    // App đang thoát: dựng lại sidecar lúc này để lại tiến trình mồ côi.
    const { supervisor, clock, processes, handshake } = setup();

    const started = supervisor.start();
    handshake();
    await started;
    await supervisor.stop();

    processes[0]?.emitExit(null);
    clock.advance(10_000);

    expect(processes).toHaveLength(1);
    expect(supervisor.getStatus().state).toBe('stopped');
  });

  it('stop() lúc đang chờ restart thì huỷ luôn lần thử đó', async () => {
    const { supervisor, clock, processes, handshake } = setup();

    const started = supervisor.start();
    handshake();
    await started;

    processes[0]?.emitExit(1);
    expect(supervisor.getStatus().state).toBe('restarting');

    await supervisor.stop();
    clock.advance(10_000);

    expect(processes).toHaveLength(1);
  });

  it('stop() không để lại timer nào treo', async () => {
    const { supervisor, clock, handshake } = setup();

    const started = supervisor.start();
    handshake();
    await started;
    await supervisor.stop();

    expect(clock.pending()).toBe(0);
  });

  it('stopped KHÔNG mang message lỗi — dừng chủ động không phải sự cố', async () => {
    const { supervisor, handshake } = setup();
    const started = supervisor.start();
    handshake();
    await started;
    await supervisor.stop();

    expect(supervisor.getStatus().message).toBeUndefined();
  });
});

describe('createSidecarSupervisor — trạng thái đẩy lên UI', () => {
  it('mỗi lần đổi đều bắn sự kiện', async () => {
    const { supervisor, statuses, handshake } = setup();

    const started = supervisor.start();
    handshake();
    await started;

    expect(statuses.map((s) => s.state)).toContain('ready');
  });

  it('rời ready thì XOÁ port — cổng chết còn sót lại sẽ đánh lừa UI', async () => {
    const { supervisor, processes, handshake } = setup();

    const started = supervisor.start();
    handshake(50123);
    await started;
    expect(supervisor.getStatus().port).toBe(50123);

    processes[0]?.emitExit(1);

    expect(supervisor.getStatus().port).toBeUndefined();
    expect(supervisor.getStatus().engineReady).toBe(false);
  });

  it('client biến mất khi sidecar chết — nơi gọi không được dùng cổng cũ', async () => {
    const { supervisor, processes, handshake } = setup();

    const started = supervisor.start();
    handshake();
    await started;
    expect(supervisor.getClient()).toBeDefined();

    processes[0]?.emitExit(1);

    expect(supervisor.getClient()).toBeUndefined();
  });
});

describe('createSidecarSupervisor — thư mục audio', () => {
  it('đọc lại thư mục audio ở MỖI lần spawn', async () => {
    // `audioDir` do user đổi trong Settings. Chốt giá trị lúc dựng supervisor
    // thì đổi thư mục xong sidecar vẫn ghi vào chỗ cũ tới khi khởi động lại app.
    const seen: string[] = [];
    let current = 'D:/audio-cũ';

    const envs: Record<string, string>[] = [];
    const { supervisor, processes, handshake, clock } = setup({
      audioDir: () => {
        seen.push(current);
        return current;
      },
      spawn: (options) => {
        envs.push(options.env);
        const proc = createFakeProcess();
        processes.push(proc);
        return proc;
      },
    });

    const started = supervisor.start();
    handshake(50000);
    await started;
    expect(envs[0]?.['LN_SIDECAR_AUDIO_DIR']).toBe('D:/audio-cũ');

    // User đổi thư mục, rồi sidecar chết và được dựng lại.
    current = 'E:/audio-mới';
    processes[0]?.emitExit(1);
    clock.advance(1_000);
    handshake(50001);
    await Promise.resolve();
    await Promise.resolve();

    expect(seen).toContain('E:/audio-mới');
    expect(envs[1]?.['LN_SIDECAR_AUDIO_DIR']).toBe('E:/audio-mới');

    await supervisor.stop();
  });
});
