import {
  SIDECAR_HEALTH_INTERVAL_MS,
  SIDECAR_MAX_RESTARTS,
  SIDECAR_RESTART_DELAY_MS,
  SIDECAR_STABLE_MS,
  SIDECAR_STARTUP_TIMEOUT_MS,
  type SidecarStatus,
} from '@ln/shared';
import { errorMessage } from '@ln/shared';
import {
  createSessionToken,
  startSidecar,
  type SidecarInstance,
  type SpawnSidecar,
} from './sidecar-process.js';
import { createSidecarClient, type FetchLike, type SidecarClient } from './sidecar-client.js';
import { resolveSidecarCommand, sidecarNotFoundMessage, type PathExists } from './sidecar-paths.js';

/**
 * Giám sát sidecar: khởi động, health check định kỳ, tự restart khi chết.
 *
 * **Vì sao không để chết là thôi.** Sidecar là tiến trình ngoài, có thể bị
 * antivirus giết, bị OOM khi nạp model, hoặc chết vì lỗi Python chưa lường
 * trước. Không tự dựng lại thì user phải khởi động lại cả app mới generate
 * tiếp được — trong khi hàng đợi job vẫn còn nguyên trong SQLite.
 *
 * **Vì sao có trần 3 lần.** Restart vô hạn khi nguyên nhân là cố định (thiếu
 * DLL, sai kiến trúc CPU) sẽ quay vòng mãi, đốt CPU và rác log, mà user không
 * bao giờ thấy thông báo nào. Hết lượt thì chuyển `failed` và báo lên UI.
 *
 * Bộ đếm restart **không cộng dồn vĩnh viễn**: sống ổn quá `SIDECAR_STABLE_MS`
 * thì về 0 (xem lý do ở constants).
 */

export type SupervisorLogger = {
  info: (message: string, detail?: string) => void;
  warn: (message: string, detail?: string) => void;
  error: (message: string, detail?: string) => void;
};

export type SidecarSupervisor = {
  /** Khởi động lần đầu. Không ném — hỏng thì chuyển `failed` và báo qua status. */
  start: () => Promise<void>;
  /** Dừng hẳn, không restart nữa. Gọi lúc app thoát. */
  stop: () => Promise<void>;
  getStatus: () => SidecarStatus;
  /**
   * Client để gọi API. `undefined` khi sidecar chưa sẵn sàng — nơi gọi phải
   * xử lý nhánh này chứ không được giả định luôn có.
   */
  getClient: () => SidecarClient | undefined;
  /** Buộc chạy một vòng health check ngay. Dùng cho test và chẩn đoán. */
  checkHealthNow: () => Promise<void>;
};

export type SupervisorDeps = {
  /** `process.resourcesPath` — chỉ có ở bản đóng gói */
  resourcesPath?: string | undefined;
  /** Gốc repo lúc dev */
  repoRoot?: string | undefined;
  modelsDir: string;
  spawn: SpawnSidecar;
  exists: PathExists;
  logger: SupervisorLogger;
  /** Đẩy trạng thái lên UI mỗi lần đổi */
  onStatusChanged?: (status: SidecarStatus) => void;
  fetchImpl?: FetchLike;
  baseEnv?: Record<string, string>;
  /** Ghi đè để test không phải chờ thật */
  healthIntervalMs?: number;
  restartDelayMs?: number;
  startupTimeoutMs?: number;
  maxRestarts?: number;
  stableMs?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => NodeJS.Timeout;
  clearTimer?: (timer: NodeJS.Timeout) => void;
};

export const createSidecarSupervisor = (deps: SupervisorDeps): SidecarSupervisor => {
  const {
    resourcesPath,
    repoRoot,
    modelsDir,
    spawn,
    exists,
    logger,
    onStatusChanged,
    fetchImpl,
    baseEnv,
    healthIntervalMs = SIDECAR_HEALTH_INTERVAL_MS,
    restartDelayMs = SIDECAR_RESTART_DELAY_MS,
    startupTimeoutMs = SIDECAR_STARTUP_TIMEOUT_MS,
    maxRestarts = SIDECAR_MAX_RESTARTS,
    stableMs = SIDECAR_STABLE_MS,
    now = Date.now,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  } = deps;

  let status: SidecarStatus = { state: 'starting', restarts: 0, engineReady: false };
  let instance: SidecarInstance | undefined;
  let client: SidecarClient | undefined;
  let healthTimer: NodeJS.Timeout | undefined;
  let restartTimer: NodeJS.Timeout | undefined;
  /** `true` sau khi `stop()` — chặn mọi lần restart về sau */
  let stopping = false;
  /** Thời điểm lần bắt tay gần nhất, để biết sidecar có sống ổn định không */
  let readySince: number | undefined;
  /** Chặn hai vòng health check chồng lên nhau khi một vòng chạy lâu */
  let checking = false;
  /**
   * Số hiệu lần chạy hiện tại, tăng mỗi lần spawn.
   *
   * Dùng để khử trùng lặp báo hỏng: `exit` của tiến trình và health check thất
   * bại thường bắn gần như cùng lúc cho **cùng một** cái chết, không được tính
   * hai lượt. Khử theo trạng thái (`state === 'restarting'` thì bỏ qua) là SAI:
   * lần chết kế tiếp cũng rơi vào đúng trạng thái đó và bị nuốt luôn, khiến
   * vòng thử lại đứng im mãi ở `restarting` — lỗi này chỉ lộ ra khi chạy thật
   * với sidecar chết liên tục, unit test tiến trình giả không thấy.
   */
  let generation = 0;
  /** Số hiệu lần chạy đã báo hỏng rồi — mỗi lần chỉ được tính một lượt */
  let failedGeneration = -1;

  const setStatus = (next: Partial<SidecarStatus>): void => {
    const merged: SidecarStatus = { ...status, ...next };

    // Xoá field không còn ý nghĩa thay vì để giá trị cũ: `port` của lần chạy
    // trước mà còn sót lại thì UI sẽ hiện một cổng đã chết như thể đang dùng.
    if (merged.state !== 'ready') {
      delete merged.port;
      merged.engineReady = false;
    }
    if (merged.state !== 'failed') {
      delete merged.message;
    }

    status = merged;
    onStatusChanged?.(status);
  };

  const clearHealthTimer = (): void => {
    if (healthTimer !== undefined) {
      clearTimer(healthTimer);
      healthTimer = undefined;
    }
  };

  const clearRestartTimer = (): void => {
    if (restartTimer !== undefined) {
      clearTimer(restartTimer);
      restartTimer = undefined;
    }
  };

  /** Bỏ tiến trình hiện tại mà không đụng tới chính sách restart */
  const disposeInstance = (): void => {
    clearHealthTimer();
    instance?.stop();
    instance = undefined;
    client = undefined;
    readySince = undefined;
  };

  const scheduleHealthCheck = (): void => {
    clearHealthTimer();
    healthTimer = setTimer(() => {
      void checkHealth();
    }, healthIntervalMs);
  };

  /**
   * Xử lý sidecar chết. Gọi từ hai chỗ: sự kiện `exit` của tiến trình, và
   * health check thất bại.
   */
  const handleFailure = (reason: string, failedGen: number): void => {
    if (stopping) return;
    // Lần chạy này đã báo hỏng rồi thì bỏ qua — nhưng lần chạy MỚI vẫn được
    // tính, khác hẳn cách khử theo trạng thái.
    if (failedGen <= failedGeneration) return;
    failedGeneration = failedGen;

    // Đọc `readySince` TRƯỚC `disposeInstance()` — hàm đó xoá nó đi.
    const uptime = readySince === undefined ? 0 : now() - readySince;
    disposeInstance();

    // Sống ổn định đủ lâu thì coi như đã phục hồi hẳn, đếm lại từ đầu
    const restarts = uptime >= stableMs ? 1 : status.restarts + 1;

    if (restarts > maxRestarts) {
      logger.error(
        `Sidecar hỏng ${String(maxRestarts)} lần liên tiếp, ngừng thử lại`,
        reason,
      );
      setStatus({
        state: 'failed',
        restarts: status.restarts,
        message:
          `Dịch vụ TTS không khởi động được sau ${String(maxRestarts)} lần thử. ` +
          'Khởi động lại ứng dụng để thử lại.',
      });
      return;
    }

    logger.warn(`Sidecar chết, thử lại lần ${String(restarts)}/${String(maxRestarts)}`, reason);
    setStatus({ state: 'restarting', restarts });

    clearRestartTimer();
    restartTimer = setTimer(() => {
      restartTimer = undefined;
      void launch();
    }, restartDelayMs);
  };

  const checkHealth = async (): Promise<void> => {
    if (stopping || client === undefined || checking) return;
    checking = true;
    // Chốt số hiệu TRƯỚC khi gọi: request kéo dài vài giây, trong lúc đó
    // sidecar có thể đã chết và được dựng lại — báo hỏng khi đó sẽ giết oan
    // tiến trình mới.
    const checkedGen = generation;

    try {
      const health = await client.health();
      if (stopping || generation !== checkedGen) return;

      // Engine chưa nạp KHÔNG phải hỏng — tới P2.4 mới có engine (xem
      // SidecarStatus). Coi là hỏng thì supervisor sẽ restart vô cớ suốt P2.2–P2.3.
      setStatus({ state: 'ready', engineReady: health.engineReady });
      scheduleHealthCheck();
    } catch (error) {
      if (stopping) return;
      handleFailure(`Health check thất bại: ${errorMessage(error)}`, checkedGen);
    } finally {
      checking = false;
    }
  };

  const launch = async (): Promise<void> => {
    if (stopping) return;

    const command = resolveSidecarCommand({ resourcesPath, repoRoot, exists });
    if (command === undefined) {
      // Không tìm thấy file thì restart bao nhiêu lần cũng vô ích — hỏng cố
      // định, sang `failed` ngay thay vì đốt hết ba lượt.
      const message = sidecarNotFoundMessage({ resourcesPath, repoRoot });
      logger.error('Không tìm thấy sidecar', message);
      setStatus({ state: 'failed', message });
      return;
    }

    if (status.state !== 'restarting') setStatus({ state: 'starting' });

    generation += 1;
    const currentGen = generation;
    const token = createSessionToken();

    try {
      const started = await startSidecar({
        command: command.command,
        args: command.args,
        cwd: command.cwd,
        modelsDir,
        token,
        spawn,
        startupTimeoutMs,
        setTimer,
        clearTimer,
        ...(baseEnv === undefined ? {} : { baseEnv }),
        onStderr: (chunk) => {
          const text = chunk.trim();
          // stderr của sidecar gồm cả log bình thường của uvicorn, nên ghi mức
          // warn chứ không phải error — nhưng vẫn phải ghi: đây là dấu vết duy
          // nhất khi sidecar chết vì lỗi Python (bài học mục 4.19c).
          if (text !== '') logger.warn('sidecar stderr', text);
        },
      });

      if (stopping) {
        // `stop()` chạy trong lúc đang chờ bắt tay — phải giết ngay, nếu không
        // tiến trình Python sống sót sau khi app đã thoát.
        started.stop();
        return;
      }

      instance = started;
      client = createSidecarClient({
        endpoint: started.endpoint,
        token,
        ...(fetchImpl === undefined ? {} : { fetchImpl }),
      });
      readySince = now();

      started.process.onExit((code) => {
        if (stopping) return;
        handleFailure(
          `Tiến trình thoát với mã ${code === null ? 'null' : String(code)}`,
          currentGen,
        );
      });

      logger.info(
        `Sidecar sẵn sàng ở cổng ${String(started.endpoint.port)}`,
        command.fromSource ? 'chạy từ mã nguồn (venv)' : 'chạy bản đóng gói',
      );
      setStatus({ state: 'ready', port: started.endpoint.port, engineReady: false });
      scheduleHealthCheck();
    } catch (error) {
      if (stopping) return;
      handleFailure(errorMessage(error), currentGen);
    }
  };

  return {
    start: launch,

    stop: async (): Promise<void> => {
      stopping = true;
      clearRestartTimer();
      disposeInstance();
      setStatus({ state: 'stopped' });
      // Trả Promise để nơi gọi `await` được — hiện dừng là đồng bộ, nhưng khi
      // thêm bước "chờ job đang chạy xong" ở P2.5 thì chữ ký không phải đổi.
      await Promise.resolve();
    },

    getStatus: () => status,
    getClient: () => client,
    checkHealthNow: checkHealth,
  };
};
