import type { SidecarEndpoint } from './sidecar-process.js';

/**
 * HTTP client gọi sidecar. Chỗ **duy nhất** bên main biết cách nói chuyện với
 * sidecar — handler và service khác đi qua đây, không tự dựng URL.
 *
 * Dùng `fetch` sẵn có của Node 20+, không thêm thư viện HTTP nào.
 */

/** Header token, phải khớp `TOKEN_HEADER` ở `sidecar/app/config.py` */
export const TOKEN_HEADER = 'X-Session-Token';

/** Kết quả `/health`. Khớp `HealthResponse` bên pydantic. */
export type SidecarHealth = {
  status: string;
  version: string;
  pid: number;
  /**
   * `false` cho tới P2.4 (chưa nạp engine TTS). Supervisor phải phân biệt
   * "tiến trình sống" với "engine nạp xong" — đừng coi `false` là hỏng.
   */
  engineReady: boolean;
};

export type SidecarClient = {
  health: (timeoutMs?: number) => Promise<SidecarHealth>;
  normalize: (input: { text: string; lang: string }) => Promise<string>;
  baseUrl: string;
};

/** Kiểu `fetch` tối thiểu, để test đưa vào bản giả mà không cần mạng thật */
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}>;

export class SidecarHttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'SidecarHttpError';
    this.status = status;
  }
}

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Health check phải có timeout **riêng và ngắn**: nếu sidecar treo (còn sống
 * nhưng không trả lời), request không timeout sẽ treo luôn vòng health check,
 * và supervisor không bao giờ phát hiện ra để restart — đúng loại hỏng mà
 * health check sinh ra để bắt.
 */
export const HEALTH_TIMEOUT_MS = 3_000;

export const createSidecarClient = (options: {
  endpoint: SidecarEndpoint;
  token: string;
  fetchImpl?: FetchLike;
}): SidecarClient => {
  const { endpoint, token } = options;
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);

  // Bọc IPv6 trong ngoặc vuông. Hiện sidecar luôn bind 127.0.0.1 nên nhánh này
  // không chạy, nhưng URL sai kiểu này hỏng rất khó đoán nên xử lý luôn.
  const hostPart = endpoint.host.includes(':') ? `[${endpoint.host}]` : endpoint.host;
  const baseUrl = `http://${hostPart}:${String(endpoint.port)}`;

  const request = async (
    path: string,
    init: { method: string; body?: unknown; timeoutMs: number },
  ): Promise<string> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), init.timeoutMs);

    try {
      const headers: Record<string, string> = { [TOKEN_HEADER]: token };
      if (init.body !== undefined) headers['Content-Type'] = 'application/json';

      const response = await fetchImpl(`${baseUrl}${path}`, {
        method: init.method,
        headers,
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        signal: controller.signal,
      });

      const text = await response.text();
      if (!response.ok) {
        throw new SidecarHttpError(response.status, `Sidecar trả ${response.status} cho ${path}`);
      }
      return text;
    } finally {
      // Xoá timer ở `finally`: bỏ sót thì mỗi request giữ event loop sống thêm
      // vài giây, và test chạy xong không thoát được.
      clearTimeout(timer);
    }
  };

  const parseJson = (raw: string, path: string): Record<string, unknown> => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(
        `Sidecar trả về nội dung không phải JSON ở ${path}`,
        error instanceof Error ? { cause: error } : undefined,
      );
    }
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error(`Sidecar trả về JSON không phải object ở ${path}`);
    }
    return parsed as Record<string, unknown>;
  };

  return {
    baseUrl,

    health: async (timeoutMs = HEALTH_TIMEOUT_MS): Promise<SidecarHealth> => {
      const raw = await request('/health', { method: 'GET', timeoutMs });
      const body = parseJson(raw, '/health');

      const { status, version, pid, engine_ready: engineReady } = body;
      if (typeof status !== 'string' || typeof version !== 'string') {
        throw new Error('Phản hồi /health thiếu "status" hoặc "version"');
      }

      return {
        status,
        version,
        pid: typeof pid === 'number' ? pid : 0,
        engineReady: engineReady === true,
      };
    },

    normalize: async (input: { text: string; lang: string }): Promise<string> => {
      const raw = await request('/normalize', {
        method: 'POST',
        body: input,
        timeoutMs: DEFAULT_TIMEOUT_MS,
      });
      const body = parseJson(raw, '/normalize');
      const { text } = body;
      if (typeof text !== 'string') {
        throw new Error('Phản hồi /normalize thiếu "text"');
      }
      return text;
    },
  };
};
