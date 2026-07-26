import { describe, expect, it, vi } from 'vitest';
import {
  HEALTH_TIMEOUT_MS,
  SidecarHttpError,
  TOKEN_HEADER,
  createSidecarClient,
  type FetchLike,
} from './sidecar-client.js';

const endpoint = { host: '127.0.0.1', port: 54757, pid: 1 };

/** `fetch` giả trả sẵn nội dung, đồng thời ghi lại lời gọi để kiểm header */
const fakeFetch = (
  response: { ok?: boolean; status?: number; body: string } | (() => Promise<never>),
): FetchLike & { calls: { url: string; init: Parameters<FetchLike>[1] }[] } => {
  const calls: { url: string; init: Parameters<FetchLike>[1] }[] = [];
  const impl = (async (url, init) => {
    calls.push({ url, init });
    if (typeof response === 'function') return response();
    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      text: async () => response.body,
    };
  }) as FetchLike & { calls: typeof calls };
  impl.calls = calls;
  return impl;
};

const healthBody = JSON.stringify({
  status: 'ok',
  version: '0.1.0',
  pid: 16204,
  engine_ready: false,
});

describe('createSidecarClient', () => {
  it('dựng URL loopback đúng cổng', () => {
    const client = createSidecarClient({ endpoint, token: 't', fetchImpl: fakeFetch({ body: '' }) });
    expect(client.baseUrl).toBe('http://127.0.0.1:54757');
  });

  it('bọc IPv6 trong ngoặc vuông', () => {
    const client = createSidecarClient({
      endpoint: { host: '::1', port: 8080, pid: 1 },
      token: 't',
      fetchImpl: fakeFetch({ body: '' }),
    });
    expect(client.baseUrl).toBe('http://[::1]:8080');
  });

  it('gắn X-Session-Token vào MỌI request', async () => {
    const fetchImpl = fakeFetch({ body: healthBody });
    const client = createSidecarClient({ endpoint, token: 'token-bí-mật', fetchImpl });

    await client.health();

    expect(fetchImpl.calls[0]?.init.headers[TOKEN_HEADER]).toBe('token-bí-mật');
  });

  it('đọc /health và đổi engine_ready sang camelCase', async () => {
    const client = createSidecarClient({
      endpoint,
      token: 't',
      fetchImpl: fakeFetch({ body: healthBody }),
    });

    await expect(client.health()).resolves.toEqual({
      status: 'ok',
      version: '0.1.0',
      pid: 16204,
      engineReady: false,
    });
  });

  it('engine_ready true được nhận đúng — P2.4 sẽ bật cờ này', async () => {
    const client = createSidecarClient({
      endpoint,
      token: 't',
      fetchImpl: fakeFetch({
        body: JSON.stringify({ status: 'ok', version: '1', pid: 1, engine_ready: true }),
      }),
    });

    await expect(client.health()).resolves.toMatchObject({ engineReady: true });
  });

  it('/health thiếu field bắt buộc thì ném', async () => {
    const client = createSidecarClient({
      endpoint,
      token: 't',
      fetchImpl: fakeFetch({ body: JSON.stringify({ pid: 1 }) }),
    });

    await expect(client.health()).rejects.toThrow(/status.*version|version/);
  });

  it('phản hồi không phải JSON thì ném kèm tên route', async () => {
    const client = createSidecarClient({
      endpoint,
      token: 't',
      fetchImpl: fakeFetch({ body: '<html>502 Bad Gateway</html>' }),
    });

    await expect(client.health()).rejects.toThrow(/\/health/);
  });

  it('HTTP 401 thành SidecarHttpError kèm status — token lệch phải phân biệt được', async () => {
    const client = createSidecarClient({
      endpoint,
      token: 'sai',
      fetchImpl: fakeFetch({ ok: false, status: 401, body: '{"code":"UNAUTHORIZED"}' }),
    });

    await expect(client.health()).rejects.toBeInstanceOf(SidecarHttpError);
    await expect(client.health()).rejects.toMatchObject({ status: 401 });
  });

  it('/normalize gửi POST kèm body JSON và Content-Type', async () => {
    const fetchImpl = fakeFetch({ body: JSON.stringify({ text: 'mười hai', lang: 'vi' }) });
    const client = createSidecarClient({ endpoint, token: 't', fetchImpl });

    await expect(client.normalize({ text: '12', lang: 'vi' })).resolves.toBe('mười hai');

    const call = fetchImpl.calls[0];
    expect(call?.init.method).toBe('POST');
    expect(call?.init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(call?.init.body ?? '{}')).toEqual({ text: '12', lang: 'vi' });
  });

  it('GET không gắn Content-Type — không có body thì header đó vô nghĩa', async () => {
    const fetchImpl = fakeFetch({ body: healthBody });
    await createSidecarClient({ endpoint, token: 't', fetchImpl }).health();

    expect(fetchImpl.calls[0]?.init.headers['Content-Type']).toBeUndefined();
  });

  it('health check có timeout riêng và ngắn hơn request thường', () => {
    // Sidecar treo (sống nhưng không trả lời) mà request không timeout thì
    // vòng health check treo theo, và supervisor không bao giờ restart.
    expect(HEALTH_TIMEOUT_MS).toBeLessThan(10_000);
    expect(HEALTH_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it('truyền AbortSignal xuống fetch để timeout cắt được request', async () => {
    const fetchImpl = fakeFetch({ body: healthBody });
    await createSidecarClient({ endpoint, token: 't', fetchImpl }).health();

    expect(fetchImpl.calls[0]?.init.signal).toBeDefined();
  });

  it('request hỏng vẫn dọn timer — không giữ event loop sống', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    const client = createSidecarClient({
      endpoint,
      token: 't',
      fetchImpl: fakeFetch(() => Promise.reject(new Error('ECONNREFUSED'))),
    });

    await expect(client.health()).rejects.toThrow('ECONNREFUSED');
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});
