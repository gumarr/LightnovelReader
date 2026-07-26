import { randomBytes } from 'node:crypto';

/**
 * Vòng đời một tiến trình sidecar: spawn → đọc dòng bắt tay → sẵn sàng → kill.
 *
 * Chỉ lo **một** tiến trình. Chính sách thử lại và health check nằm ở
 * `sidecar-supervisor.ts` — tách ra vì hai thứ hỏng theo cách khác nhau, và
 * gộp lại thì không test được cái nào mà không dựng cái kia.
 *
 * Hợp đồng bắt tay do `sidecar/app/server.py` định nghĩa (PROGRESS mục 4.26):
 * sidecar bind cổng 0 rồi in **đúng một dòng** ra stdout:
 *
 * ```
 * LN_SIDECAR_READY {"host":"127.0.0.1","port":54757,"pid":16204}
 * ```
 *
 * Đổi định dạng dòng này mà quên sửa một trong hai phía thì app treo ở "đang
 * khởi động sidecar" — `sidecar/tests/test_server.py` và test ở đây cùng khoá.
 */

export const READY_PREFIX = 'LN_SIDECAR_READY ';

export type SidecarEndpoint = {
  host: string;
  port: number;
  /** PID sidecar tự báo — dùng để đối chiếu log, không dùng để kill */
  pid: number;
};

/**
 * Tiến trình con đã spawn. Chỉ khai đúng phần supervisor dùng tới, thay vì
 * `ChildProcess` đầy đủ — nhờ vậy test dựng được tiến trình giả.
 */
export type SpawnedProcess = {
  pid: number | undefined;
  /** Đăng ký nhận từng dòng stdout. Trả hàm huỷ đăng ký. */
  onStdoutLine: (listener: (line: string) => void) => () => void;
  /** Đăng ký nhận stderr thô — để ghi log chẩn đoán */
  onStderr: (listener: (chunk: string) => void) => () => void;
  /** Tiến trình đã thoát, kèm mã thoát (`null` khi bị tín hiệu giết) */
  onExit: (listener: (code: number | null) => void) => () => void;
  kill: () => void;
};

export type SpawnSidecar = (options: {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}) => SpawnedProcess;

/**
 * Sinh token phiên. 32 byte ngẫu nhiên mã hoá base64url — cùng độ dài với
 * `secrets.token_urlsafe(32)` phía Python.
 */
export const createSessionToken = (): string => randomBytes(32).toString('base64url');

/**
 * Đọc dòng bắt tay. Trả `undefined` nếu dòng không phải dòng bắt tay — gọi
 * là chuyện bình thường, vì sidecar có thể in thứ khác trước đó.
 *
 * Ném khi dòng **có** tiền tố đúng nhưng phần JSON hỏng: đó là sidecar sai
 * phiên bản, im lặng bỏ qua thì main sẽ chờ tới lúc timeout rồi báo một lỗi
 * hoàn toàn không liên quan.
 */
export const parseReadyLine = (line: string): SidecarEndpoint | undefined => {
  if (!line.startsWith(READY_PREFIX)) return undefined;

  const raw = line.slice(READY_PREFIX.length).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Dòng bắt tay của sidecar không phải JSON hợp lệ: ${raw}`,
      error instanceof Error ? { cause: error } : undefined,
    );
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`Dòng bắt tay của sidecar không phải object: ${raw}`);
  }

  const record = parsed as Record<string, unknown>;
  const { host, port, pid } = record;

  if (typeof host !== 'string' || host === '') {
    throw new Error(`Dòng bắt tay thiếu "host": ${raw}`);
  }
  if (typeof port !== 'number' || !Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Dòng bắt tay có "port" không hợp lệ: ${raw}`);
  }
  if (typeof pid !== 'number' || !Number.isInteger(pid)) {
    throw new Error(`Dòng bắt tay có "pid" không hợp lệ: ${raw}`);
  }

  return { host, port, pid };
};

/** Cắt chunk stdout thành từng dòng, giữ lại phần dở dang giữa hai lần gọi */
export const createLineSplitter = (onLine: (line: string) => void): ((chunk: string) => void) => {
  let buffer = '';
  return (chunk: string) => {
    buffer += chunk;
    let index = buffer.indexOf('\n');
    while (index !== -1) {
      // `\r` còn sót của CRLF phải bỏ, nếu không JSON.parse nhận chuỗi thừa ký tự
      const line = buffer.slice(0, index).replace(/\r$/, '');
      buffer = buffer.slice(index + 1);
      if (line !== '') onLine(line);
      index = buffer.indexOf('\n');
    }
  };
};

export type SidecarInstance = {
  endpoint: SidecarEndpoint;
  token: string;
  process: SpawnedProcess;
  /** Giết tiến trình. Gọi nhiều lần vô hại. */
  stop: () => void;
};

export type StartSidecarOptions = {
  command: string;
  args: string[];
  cwd: string;
  /** Thư mục model, bắt buộc — sidecar thoát mã 2 nếu thiếu */
  modelsDir: string;
  token: string;
  spawn: SpawnSidecar;
  startupTimeoutMs: number;
  /** Hẹn giờ, tách ra để test không phải chờ thật */
  setTimer?: (fn: () => void, ms: number) => NodeJS.Timeout;
  clearTimer?: (timer: NodeJS.Timeout) => void;
  onStderr?: (chunk: string) => void;
  /** Biến môi trường nền. Mặc định lấy từ `process.env` ở nơi gọi. */
  baseEnv?: Record<string, string>;
};

/**
 * Spawn sidecar rồi chờ dòng bắt tay.
 *
 * Ném khi: không bắt tay kịp `startupTimeoutMs`, tiến trình chết trước khi bắt
 * tay, hoặc dòng bắt tay hỏng. Mọi nhánh ném đều **giết tiến trình trước** —
 * bỏ lại một tiến trình Python mồ côi đang giữ cổng là thứ user không thấy
 * nhưng sẽ làm lần khởi động sau hỏng theo kiểu rất khó hiểu.
 */
export const startSidecar = async (options: StartSidecarOptions): Promise<SidecarInstance> => {
  const {
    command,
    args,
    cwd,
    modelsDir,
    token,
    spawn,
    startupTimeoutMs,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    onStderr,
    baseEnv = {},
  } = options;

  const child = spawn({
    command,
    args,
    cwd,
    env: {
      ...baseEnv,
      // Token đi qua env, KHÔNG qua args: trên Windows mọi tiến trình đều đọc
      // được command line của tiến trình khác (PROGRESS mục 4.26d).
      LN_SIDECAR_TOKEN: token,
      LN_SIDECAR_MODELS_DIR: modelsDir,
      // Python đệm stdout theo khối khi nối vào pipe. Sidecar đã tự `flush()`
      // sau dòng bắt tay, nhưng đặt thêm ở đây để log về sau cũng ra ngay.
      PYTHONUNBUFFERED: '1',
      PYTHONIOENCODING: 'utf-8',
    },
  });

  return await new Promise<SidecarInstance>((resolve, reject) => {
    let settled = false;
    const unsubscribers: (() => void)[] = [];

    const cleanup = (): void => {
      for (const off of unsubscribers) off();
      unsubscribers.length = 0;
    };

    const timer = setTimer(() => {
      if (settled) return;
      settled = true;
      cleanup();
      child.kill();
      reject(
        new Error(
          `Sidecar không báo sẵn sàng trong ${startupTimeoutMs}ms. ` +
            'Tiến trình đã bị dừng để không giữ cổng.',
        ),
      );
    }, startupTimeoutMs);

    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      clearTimer(timer);
      cleanup();
      child.kill();
      reject(error);
    };

    unsubscribers.push(
      child.onStdoutLine((line) => {
        if (settled) return;
        let endpoint: SidecarEndpoint | undefined;
        try {
          endpoint = parseReadyLine(line);
        } catch (error) {
          fail(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        if (endpoint === undefined) return;

        settled = true;
        clearTimer(timer);
        cleanup();

        let stopped = false;
        resolve({
          endpoint,
          token,
          process: child,
          stop: () => {
            if (stopped) return;
            stopped = true;
            child.kill();
          },
        });
      }),
    );

    if (onStderr !== undefined) {
      unsubscribers.push(child.onStderr(onStderr));
    }

    unsubscribers.push(
      child.onExit((code) => {
        fail(
          new Error(
            `Sidecar thoát với mã ${code === null ? 'null (bị tín hiệu giết)' : code} ` +
              'trước khi báo sẵn sàng.' +
              // Mã 2 là ConfigError bên `config.py` — nói thẳng ra vì đây là
              // lỗi lập trình phía main, không phải lỗi môi trường của user.
              (code === 2 ? ' Mã 2 = thiếu hoặc sai biến môi trường cấu hình.' : ''),
          ),
        );
      }),
    );
  });
};
