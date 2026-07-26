import type { BookLang, VoiceDownloadProgress, VoiceQuality } from '@ln/shared';
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

/** Một voice trong catalog, kèm cờ đã cài chưa. Khớp `CatalogVoice` bên pydantic. */
export type SidecarCatalogVoice = {
  id: string;
  lang: BookLang;
  name: string;
  quality: VoiceQuality;
  sampleRate: number;
  license: string;
  totalBytes: number;
  installed: boolean;
};

export type SidecarInstalledVoice = {
  id: string;
  lang: BookLang;
  name: string;
  quality: VoiceQuality;
  sampleRate: number;
  sizeBytes: number;
};

export type SidecarClient = {
  health: (timeoutMs?: number) => Promise<SidecarHealth>;
  normalize: (input: { text: string; lang: string }) => Promise<string>;
  listCatalog: () => Promise<SidecarCatalogVoice[]>;
  listInstalled: () => Promise<SidecarInstalledVoice[]>;
  /**
   * Tải voice. Tiến độ đẩy qua `onProgress` theo từng khung SSE.
   *
   * **Không có timeout tổng**: tải 63 MB trên mạng chậm có thể mất rất lâu, mà
   * cắt giữa chừng thì mất hết công tải. Thay vào đó nơi gọi huỷ bằng `signal`.
   */
  downloadVoice: (input: {
    voiceId: string;
    onProgress: (progress: VoiceDownloadProgress) => void;
    signal?: AbortSignal;
  }) => Promise<void>;
  deleteVoice: (voiceId: string) => Promise<boolean>;
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
  /**
   * Thân response dạng dòng chảy, dùng cho SSE. `null`/thiếu với bản `fetch`
   * giả trong test không quan tâm tới streaming.
   */
  body?: ReadableStream<Uint8Array> | null;
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

/**
 * Tách khung SSE ra khỏi bộ đệm.
 *
 * Hàm **thuần**: nhận bộ đệm, trả các khung đã trọn vẹn + phần còn dở. Tách ra
 * vì đây là chỗ dễ sai nhất của SSE — một khung có thể bị cắt làm đôi giữa hai
 * lần đọc mạng, và ghép sai thì `JSON.parse` ném ở giữa lúc tải mà không nói
 * được vì sao. Có hàm riêng thì test khoá được đúng ca đó.
 */
export const parseSseFrames = (
  buffer: string,
): { frames: string[]; rest: string } => {
  const frames: string[] = [];
  // Khung SSE kết thúc bằng dòng trống. Chuẩn hoá CRLF trước khi tách vì một
  // số proxy trên Windows đổi hết xuống dòng.
  const normalized = buffer.replace(/\r\n/g, '\n');
  const parts = normalized.split('\n\n');
  // Phần cuối luôn là phần dở dang (hoặc chuỗi rỗng nếu vừa hết đúng khung).
  const rest = parts.pop() ?? '';

  for (const part of parts) {
    for (const line of part.split('\n')) {
      if (line.startsWith('data:')) frames.push(line.slice('data:'.length).trim());
    }
  }

  return { frames, rest };
};

/** Đọc một khung SSE thành `VoiceDownloadProgress`, bỏ qua khung không hiểu được */
const parseProgressFrame = (frame: string): VoiceDownloadProgress | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(frame);
  } catch {
    // Khung hỏng thì bỏ qua chứ không làm hỏng cả lượt tải: mất một mốc tiến
    // độ không sao, còn ném ở đây thì huỷ luôn 63 MB đang tải dở.
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;

  const body = parsed as Record<string, unknown>;
  const { voiceId, state, receivedBytes, totalBytes, message } = body;

  if (typeof voiceId !== 'string') return undefined;
  if (
    state !== 'downloading' &&
    state !== 'verifying' &&
    state !== 'done' &&
    state !== 'error'
  ) {
    return undefined;
  }

  return {
    voiceId,
    state,
    receivedBytes: typeof receivedBytes === 'number' ? receivedBytes : 0,
    totalBytes: typeof totalBytes === 'number' ? totalBytes : 0,
    ...(typeof message === 'string' ? { message } : {}),
  };
};

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

    listCatalog: async (): Promise<SidecarCatalogVoice[]> => {
      const raw = await request('/voices/catalog', {
        method: 'GET',
        timeoutMs: DEFAULT_TIMEOUT_MS,
      });
      const body = parseJson(raw, '/voices/catalog');
      const { voices } = body;
      if (!Array.isArray(voices)) throw new Error('Phản hồi /voices/catalog thiếu "voices"');
      return voices as SidecarCatalogVoice[];
    },

    listInstalled: async (): Promise<SidecarInstalledVoice[]> => {
      const raw = await request('/voices', { method: 'GET', timeoutMs: DEFAULT_TIMEOUT_MS });
      const body = parseJson(raw, '/voices');
      const { voices } = body;
      if (!Array.isArray(voices)) throw new Error('Phản hồi /voices thiếu "voices"');
      return voices as SidecarInstalledVoice[];
    },

    downloadVoice: async (input): Promise<void> => {
      const { voiceId, onProgress, signal } = input;

      const response = await fetchImpl(
        `${baseUrl}/voices/${encodeURIComponent(voiceId)}/download`,
        {
          method: 'POST',
          headers: { [TOKEN_HEADER]: token },
          ...(signal === undefined ? {} : { signal }),
        },
      );

      if (!response.ok) {
        throw new SidecarHttpError(
          response.status,
          `Sidecar trả ${response.status} khi tải voice ${voiceId}`,
        );
      }

      // Không có thân dòng chảy (bản fetch giả, hoặc runtime cũ) thì đọc trọn
      // rồi tách một lượt. Kết quả cuối vẫn đúng, chỉ mất tính "theo thời gian
      // thực" của thanh tiến trình.
      const stream = response.body;
      if (stream === undefined || stream === null) {
        const { frames } = parseSseFrames(await response.text());
        emitFrames(frames, onProgress);
        return;
      }

      const decoder = new TextDecoder();
      const reader = stream.getReader();
      let buffer = '';

      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          // `stream: true` bắt buộc: khối đọc về có thể cắt đúng giữa một ký
          // tự UTF-8 nhiều byte (tên voice tiếng Việt), giải mã từng khối rời
          // sẽ ra ký tự thay thế.
          buffer += decoder.decode(value, { stream: true });

          const { frames, rest } = parseSseFrames(buffer);
          buffer = rest;
          emitFrames(frames, onProgress);
        }
      } finally {
        // Nhả khoá đọc kể cả khi bị huỷ giữa chừng, nếu không kết nối treo lại.
        reader.releaseLock();
      }
    },

    deleteVoice: async (voiceId: string): Promise<boolean> => {
      const raw = await request(`/voices/${encodeURIComponent(voiceId)}`, {
        method: 'DELETE',
        timeoutMs: DEFAULT_TIMEOUT_MS,
      });
      const body = parseJson(raw, '/voices/{id}');
      return body['removed'] === true;
    },
  };
};

/** Đẩy các khung đã tách được lên `onProgress`, bỏ qua khung không đọc được */
const emitFrames = (
  frames: string[],
  onProgress: (progress: VoiceDownloadProgress) => void,
): void => {
  for (const frame of frames) {
    const progress = parseProgressFrame(frame);
    if (progress !== undefined) onProgress(progress);
  }
};
