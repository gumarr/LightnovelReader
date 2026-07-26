import { describe, expect, it, vi } from 'vitest';
import {
  HEALTH_TIMEOUT_MS,
  SYNTHESIZE_TIMEOUT_MS,
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

  describe('synthesize', () => {
    const okBody = JSON.stringify({
      audioPath: 'D:/audio/book1/seg1.ogg',
      durationMs: 2810,
      audioBytes: 9401,
      sampleRate: 24000,
      voiceId: 'vi_VN-vais1000-medium',
      timingSource: 'phoneme',
      timings: [{ w: 'Sau', startMs: 0, endMs: 232, charStart: 0, charEnd: 3 }],
    });

    const input = {
      text: 'Sau giờ học hôm ấy.',
      voiceId: 'vi_VN-vais1000-medium',
      outPath: 'D:/audio/book1/seg1.ogg',
      bitrate: 24,
      lang: 'vi',
    } as const;

    it('đọc đủ trường và giữ nguyên timing', async () => {
      const client = createSidecarClient({
        endpoint,
        token: 't',
        fetchImpl: fakeFetch({ body: okBody }),
      });

      const result = await client.synthesize(input);

      expect(result.durationMs).toBe(2810);
      expect(result.audioBytes).toBe(9401);
      expect(result.sampleRate).toBe(24000);
      expect(result.timingSource).toBe('phoneme');
      expect(result.timings).toEqual([
        { w: 'Sau', startMs: 0, endMs: 232, charStart: 0, charEnd: 3 },
      ]);
    });

    it('gửi POST kèm token và đủ tham số', async () => {
      const fetchImpl = fakeFetch({ body: okBody });
      await createSidecarClient({ endpoint, token: 'bí-mật', fetchImpl }).synthesize(input);

      const call = fetchImpl.calls[0];
      expect(call?.url).toBe('http://127.0.0.1:54757/synthesize');
      expect(call?.init.method).toBe('POST');
      expect(call?.init.headers[TOKEN_HEADER]).toBe('bí-mật');
      expect(JSON.parse(call?.init.body ?? '{}')).toMatchObject({
        voiceId: 'vi_VN-vais1000-medium',
        bitrate: 24,
        lang: 'vi',
      });
    });

    it('timeout dài hơn hẳn request thường', () => {
      // Lần gọi đầu gồm cả nạp model 63 MB (~1.5s) lẫn tổng hợp (~2s). Cắt sớm
      // thì mọi lượt generate đầu tiên đều hỏng.
      expect(SYNTHESIZE_TIMEOUT_MS).toBeGreaterThan(60_000);
    });

    it('giữ nguyên thông báo lỗi thật của sidecar', async () => {
      // Sidecar đã nói rõ phải làm gì; nuốt mất thì UI chỉ thấy "trả 422".
      const client = createSidecarClient({
        endpoint,
        token: 't',
        fetchImpl: fakeFetch({
          ok: false,
          status: 422,
          body: JSON.stringify({ detail: 'Voice chưa được cài. Vào màn Giọng đọc để tải lại.' }),
        }),
      });

      await expect(client.synthesize(input)).rejects.toThrow('Vào màn Giọng đọc');
    });

    it('lỗi không phải JSON vẫn báo được mã trạng thái', async () => {
      const client = createSidecarClient({
        endpoint,
        token: 't',
        fetchImpl: fakeFetch({ ok: false, status: 500, body: '<html>lỗi</html>' }),
      });

      await expect(client.synthesize(input)).rejects.toThrow(SidecarHttpError);
    });

    it('bỏ qua timing hỏng thay vì vứt cả segment', async () => {
      // Mất một mốc từ chỉ làm highlight lệch một chữ; ném ở đây là vứt luôn
      // audio đã tổng hợp xong — đắt hơn nhiều so với cái mất.
      const client = createSidecarClient({
        endpoint,
        token: 't',
        fetchImpl: fakeFetch({
          body: JSON.stringify({
            audioPath: 'x.ogg',
            durationMs: 1000,
            audioBytes: 10,
            sampleRate: 24000,
            voiceId: 'v',
            timingSource: 'estimate',
            timings: [
              { w: 'ok', startMs: 0, endMs: 10, charStart: 0, charEnd: 2 },
              { w: 'thiếu-trường' },
              null,
            ],
          }),
        }),
      });

      const result = await client.synthesize(input);
      expect(result.timings).toHaveLength(1);
    });

    it('thiếu trường bắt buộc thì ném', async () => {
      const client = createSidecarClient({
        endpoint,
        token: 't',
        fetchImpl: fakeFetch({ body: JSON.stringify({ durationMs: 100 }) }),
      });

      await expect(client.synthesize(input)).rejects.toThrow('audioPath');
    });

    it('huỷ từ nơi gọi thì cắt được request đang bay', async () => {
      const controller = new AbortController();
      const fetchImpl = fakeFetch({ body: okBody });
      await createSidecarClient({ endpoint, token: 't', fetchImpl }).synthesize({
        ...input,
        signal: controller.signal,
      });

      const passed = fetchImpl.calls[0]?.init.signal;
      expect(passed).toBeDefined();
      expect(passed?.aborted).toBe(false);
    });
  });

  it('health đọc được voice đang nạp', async () => {
    const client = createSidecarClient({
      endpoint,
      token: 't',
      fetchImpl: fakeFetch({
        body: JSON.stringify({
          status: 'ok',
          version: '0.1.0',
          pid: 1,
          engine_ready: true,
          loaded_voice_id: 'vi_VN-vais1000-medium',
        }),
      }),
    });

    const health = await client.health();
    expect(health.engineReady).toBe(true);
    expect(health.loadedVoiceId).toBe('vi_VN-vais1000-medium');
  });
});
