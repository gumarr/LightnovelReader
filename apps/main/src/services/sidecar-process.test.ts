import { describe, expect, it } from 'vitest';
import {
  READY_PREFIX,
  createLineSplitter,
  createSessionToken,
  parseReadyLine,
  startSidecar,
  type SpawnedProcess,
} from './sidecar-process.js';

/**
 * Tiến trình giả — không spawn Python thật.
 *
 * Test ở đây kiểm **giao thức** (bắt tay, timeout, dọn dẹp). Việc sidecar thật
 * có in đúng dòng đó không thì `sidecar/tests/test_server.py` khoá ở phía
 * Python, và bản chạy thật kiểm nốt phần nối hai đầu.
 */
const createFakeProcess = (): SpawnedProcess & {
  emitStdout: (line: string) => void;
  emitStderr: (chunk: string) => void;
  emitExit: (code: number | null) => void;
  killCount: () => number;
} => {
  const stdoutListeners: ((line: string) => void)[] = [];
  const stderrListeners: ((chunk: string) => void)[] = [];
  const exitListeners: ((code: number | null) => void)[] = [];
  let kills = 0;

  const add = <T>(list: T[], listener: T): (() => void) => {
    list.push(listener);
    return () => {
      const index = list.indexOf(listener);
      if (index !== -1) list.splice(index, 1);
    };
  };

  return {
    pid: 4242,
    onStdoutLine: (listener) => add(stdoutListeners, listener),
    onStderr: (listener) => add(stderrListeners, listener),
    onExit: (listener) => add(exitListeners, listener),
    kill: () => {
      kills += 1;
    },
    emitStdout: (line) => {
      for (const l of [...stdoutListeners]) l(line);
    },
    emitStderr: (chunk) => {
      for (const l of [...stderrListeners]) l(chunk);
    },
    emitExit: (code) => {
      for (const l of [...exitListeners]) l(code);
    },
    killCount: () => kills,
  };
};

/**
 * `spawn` giả có ghi lại tham số. Tự ghi thay vì dùng `vi.fn().mock.calls` —
 * kiểu của mock suy ra rỗng nên phải ép kiểu, mà ép kiểu trong test thì mất
 * luôn khả năng bắt lỗi khi hợp đồng đổi.
 */
const recordingSpawn = (fake: SpawnedProcess) => {
  const calls: { args: string[]; env: Record<string, string> }[] = [];
  return {
    spawn: (options: { args: string[]; env: Record<string, string> }): SpawnedProcess => {
      calls.push({ args: options.args, env: options.env });
      return fake;
    },
    lastCall: () => calls[calls.length - 1],
  };
};

const readyLine = (port = 54757): string =>
  `${READY_PREFIX}{"host":"127.0.0.1","port":${String(port)},"pid":16204}`;

describe('parseReadyLine', () => {
  it('đọc được dòng bắt tay đúng định dạng của sidecar', () => {
    expect(parseReadyLine(readyLine())).toEqual({ host: '127.0.0.1', port: 54757, pid: 16204 });
  });

  it('dòng không phải bắt tay thì trả undefined — sidecar in thứ khác là chuyện thường', () => {
    expect(parseReadyLine('INFO: Started server process')).toBeUndefined();
    expect(parseReadyLine('')).toBeUndefined();
  });

  it('có tiền tố đúng nhưng JSON hỏng thì NÉM, không im lặng bỏ qua', () => {
    // Im lặng thì main chờ tới timeout rồi báo "sidecar không phản hồi" —
    // sai hoàn toàn nguyên nhân, mà đây lại là loại lỗi khó đoán nhất.
    expect(() => parseReadyLine(`${READY_PREFIX}{không phải json}`)).toThrow(/JSON/);
  });

  it('thiếu hoặc sai từng field đều bị bắt', () => {
    expect(() => parseReadyLine(`${READY_PREFIX}{"port":1,"pid":2}`)).toThrow(/host/);
    expect(() => parseReadyLine(`${READY_PREFIX}{"host":"h","pid":2}`)).toThrow(/port/);
    expect(() => parseReadyLine(`${READY_PREFIX}{"host":"h","port":1}`)).toThrow(/pid/);
  });

  it('cổng ngoài khoảng hợp lệ bị từ chối', () => {
    expect(() => parseReadyLine(`${READY_PREFIX}{"host":"h","port":0,"pid":2}`)).toThrow(/port/);
    expect(() => parseReadyLine(`${READY_PREFIX}{"host":"h","port":70000,"pid":2}`)).toThrow(/port/);
  });

  it('JSON hợp lệ nhưng không phải object thì bị từ chối', () => {
    expect(() => parseReadyLine(`${READY_PREFIX}"chuỗi"`)).toThrow();
    expect(() => parseReadyLine(`${READY_PREFIX}null`)).toThrow();
  });
});

describe('createLineSplitter', () => {
  it('gom chunk bị cắt giữa chừng thành dòng trọn vẹn', () => {
    const lines: string[] = [];
    const feed = createLineSplitter((line) => lines.push(line));

    // stdout của pipe cắt ở đâu là chuyện của OS — dòng bắt tay hoàn toàn có
    // thể tới làm hai mảnh.
    feed('LN_SIDECAR_RE');
    expect(lines).toEqual([]);
    feed('ADY {"host":"127.0.0.1"}\n');

    expect(lines).toEqual(['LN_SIDECAR_READY {"host":"127.0.0.1"}']);
  });

  it('bỏ \\r của CRLF — Windows in xuống dòng kiểu này', () => {
    const lines: string[] = [];
    createLineSplitter((line) => lines.push(line))('một\r\nhai\r\n');
    expect(lines).toEqual(['một', 'hai']);
  });

  it('nhiều dòng trong một chunk đều được phát', () => {
    const lines: string[] = [];
    createLineSplitter((line) => lines.push(line))('a\nb\nc\n');
    expect(lines).toEqual(['a', 'b', 'c']);
  });

  it('bỏ qua dòng rỗng', () => {
    const lines: string[] = [];
    createLineSplitter((line) => lines.push(line))('a\n\n\nb\n');
    expect(lines).toEqual(['a', 'b']);
  });
});

describe('createSessionToken', () => {
  it('sinh token đủ dài và mỗi lần một khác', () => {
    const a = createSessionToken();
    const b = createSessionToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(32);
  });

  it('chỉ dùng ký tự base64url — an toàn khi đặt vào header HTTP', () => {
    expect(createSessionToken()).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('startSidecar', () => {
  const baseOptions = (fake: SpawnedProcess) => ({
    command: 'python.exe',
    args: ['-m', 'app.server'],
    cwd: 'D:/repo/sidecar',
    modelsDir: 'C:/models',
    token: 'token-abc',
    spawn: () => fake,
    startupTimeoutMs: 5_000,
  });

  it('trả về endpoint sau khi nhận dòng bắt tay', async () => {
    const fake = createFakeProcess();
    const promise = startSidecar(baseOptions(fake));

    fake.emitStdout(readyLine(50001));
    const instance = await promise;

    expect(instance.endpoint).toEqual({ host: '127.0.0.1', port: 50001, pid: 16204 });
    expect(instance.token).toBe('token-abc');
  });

  it('truyền token và models dir qua ENV, không qua args', async () => {
    const fake = createFakeProcess();
    const { spawn, lastCall } = recordingSpawn(fake);

    const promise = startSidecar({ ...baseOptions(fake), spawn });
    fake.emitStdout(readyLine());
    await promise;

    const call = lastCall();
    expect(call?.env['LN_SIDECAR_TOKEN']).toBe('token-abc');
    expect(call?.env['LN_SIDECAR_MODELS_DIR']).toBe('C:/models');
    expect(call?.args.join(' ')).not.toContain('token-abc');
  });

  it('truyền thư mục audio qua ENV khi có', async () => {
    const fake = createFakeProcess();
    const { spawn, lastCall } = recordingSpawn(fake);

    const promise = startSidecar({ ...baseOptions(fake), spawn, audioDir: 'D:/audio' });
    fake.emitStdout(readyLine());
    await promise;

    expect(lastCall()?.env['LN_SIDECAR_AUDIO_DIR']).toBe('D:/audio');
  });

  it('không có thư mục audio thì KHÔNG đặt biến rỗng', async () => {
    // Đặt chuỗi rỗng thì sidecar coi như "đã cấu hình vào thư mục rỗng" và
    // thông báo lỗi mất hết ý nghĩa. Thiếu hẳn biến mới đúng là "chưa cấu hình".
    const fake = createFakeProcess();
    const { spawn, lastCall } = recordingSpawn(fake);

    const promise = startSidecar({ ...baseOptions(fake), spawn, audioDir: '' });
    fake.emitStdout(readyLine());
    await promise;

    expect(lastCall()?.env['LN_SIDECAR_AUDIO_DIR']).toBeUndefined();
  });

  it('giữ lại env nền nhưng KHÔNG cho nó ghi đè token', async () => {
    const fake = createFakeProcess();
    const { spawn, lastCall } = recordingSpawn(fake);

    const promise = startSidecar({
      ...baseOptions(fake),
      spawn,
      baseEnv: { PATH: 'C:/bin', LN_SIDECAR_TOKEN: 'token-cũ-còn-sót' },
    });
    fake.emitStdout(readyLine());
    await promise;

    expect(lastCall()?.env['PATH']).toBe('C:/bin');
    // Env nền có token cũ sót lại vẫn phải bị token phiên mới ghi đè
    expect(lastCall()?.env['LN_SIDECAR_TOKEN']).toBe('token-abc');
  });

  it('quá hạn mà không bắt tay thì ném VÀ giết tiến trình', async () => {
    const fake = createFakeProcess();
    let fire: (() => void) | undefined;

    const promise = startSidecar({
      ...baseOptions(fake),
      startupTimeoutMs: 100,
      setTimer: (fn) => {
        fire = fn;
        return 0 as unknown as NodeJS.Timeout;
      },
      clearTimer: () => undefined,
    });

    fire?.();

    await expect(promise).rejects.toThrow(/không báo sẵn sàng/);
    // Không giết thì còn lại một tiến trình Python mồ côi đang giữ cổng
    expect(fake.killCount()).toBe(1);
  });

  it('tiến trình chết trước khi bắt tay thì ném kèm mã thoát', async () => {
    const fake = createFakeProcess();
    const promise = startSidecar(baseOptions(fake));

    fake.emitExit(1);

    await expect(promise).rejects.toThrow(/thoát với mã 1/);
  });

  it('mã thoát 2 được giải thích rõ là lỗi cấu hình', async () => {
    const fake = createFakeProcess();
    const promise = startSidecar(baseOptions(fake));

    fake.emitExit(2);

    await expect(promise).rejects.toThrow(/biến môi trường/);
  });

  it('dòng bắt tay hỏng thì ném và giết tiến trình', async () => {
    const fake = createFakeProcess();
    const promise = startSidecar(baseOptions(fake));

    fake.emitStdout(`${READY_PREFIX}{hỏng}`);

    await expect(promise).rejects.toThrow(/JSON/);
    expect(fake.killCount()).toBe(1);
  });

  it('bỏ qua dòng stdout lạ, vẫn chờ đúng dòng bắt tay', async () => {
    const fake = createFakeProcess();
    const promise = startSidecar(baseOptions(fake));

    fake.emitStdout('INFO: Started server process [16204]');
    fake.emitStdout('Cái gì đó không liên quan');
    fake.emitStdout(readyLine(50002));

    await expect(promise).resolves.toMatchObject({ endpoint: { port: 50002 } });
  });

  it('chuyển stderr cho nơi gọi ghi log — dấu vết duy nhất khi sidecar chết', async () => {
    const fake = createFakeProcess();
    const chunks: string[] = [];

    const promise = startSidecar({ ...baseOptions(fake), onStderr: (c) => chunks.push(c) });
    fake.emitStderr('Traceback (most recent call last):');
    fake.emitStdout(readyLine());
    await promise;

    expect(chunks).toEqual(['Traceback (most recent call last):']);
  });

  it('dòng bắt tay thứ hai không làm gì thêm — resolve đúng một lần', async () => {
    const fake = createFakeProcess();
    const promise = startSidecar(baseOptions(fake));

    fake.emitStdout(readyLine(50003));
    fake.emitStdout(readyLine(50004));
    const instance = await promise;

    expect(instance.endpoint.port).toBe(50003);
  });

  it('sau khi bắt tay xong, exit KHÔNG còn làm reject promise đã settle', async () => {
    const fake = createFakeProcess();
    const promise = startSidecar(baseOptions(fake));

    fake.emitStdout(readyLine());
    const instance = await promise;
    fake.emitExit(1);

    // Không ném, không unhandled rejection — supervisor mới là nơi lo cái chết này
    expect(instance.endpoint.port).toBe(54757);
  });

  it('stop() gọi nhiều lần chỉ giết một lần', async () => {
    const fake = createFakeProcess();
    const promise = startSidecar(baseOptions(fake));

    fake.emitStdout(readyLine());
    const instance = await promise;

    instance.stop();
    instance.stop();
    instance.stop();

    expect(fake.killCount()).toBe(1);
  });
});
