import { describe, expect, it } from 'vitest';
import {
  TOKEN_HEADER,
  createSidecarClient,
  parseSseFrames,
  type FetchLike,
} from './sidecar-client.js';
import type { VoiceDownloadProgress } from '@ln/shared';

/**
 * Test phần voice của client: gọi API và **đọc SSE**.
 *
 * SSE là chỗ dễ sai nhất — một khung có thể bị cắt làm đôi giữa hai lần đọc
 * mạng. Test dựng đúng những kiểu cắt đó bằng `ReadableStream` tự tạo.
 */

const endpoint = { host: '127.0.0.1', port: 54757, pid: 1 };

/** Dựng stream trả về từng khối byte đúng như đã chỉ định, kể cả khi cắt giữa khung */
const streamOf = (chunks: string[]): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[index]));
      index += 1;
    },
  });
};

const streamingFetch = (chunks: string[], init?: { ok?: boolean; status?: number }): FetchLike =>
  (async () => ({
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    text: async () => chunks.join(''),
    body: streamOf(chunks),
  })) as FetchLike;

const jsonFetch = (body: string): FetchLike & { calls: { url: string; method: string }[] } => {
  const calls: { url: string; method: string }[] = [];
  const impl = (async (url, requestInit) => {
    calls.push({ url, method: requestInit.method });
    return { ok: true, status: 200, text: async () => body };
  }) as FetchLike & { calls: typeof calls };
  impl.calls = calls;
  return impl;
};

const frame = (progress: Record<string, unknown>): string =>
  `data: ${JSON.stringify(progress)}\n\n`;

describe('parseSseFrames', () => {
  it('tách được các khung trọn vẹn', () => {
    const { frames, rest } = parseSseFrames('data: {"a":1}\n\ndata: {"a":2}\n\n');
    expect(frames).toEqual(['{"a":1}', '{"a":2}']);
    expect(rest).toBe('');
  });

  it('giữ lại phần dở dang để ghép với khối sau', () => {
    // Đây là ca hay gặp thật: mạng trả về nửa khung rồi mới trả nốt.
    const { frames, rest } = parseSseFrames('data: {"a":1}\n\ndata: {"b"');
    expect(frames).toEqual(['{"a":1}']);
    expect(rest).toBe('data: {"b"');
  });

  it('chấp nhận xuống dòng kiểu CRLF', () => {
    const { frames } = parseSseFrames('data: {"a":1}\r\n\r\n');
    expect(frames).toEqual(['{"a":1}']);
  });

  it('bỏ qua dòng không phải data (comment giữ kết nối)', () => {
    const { frames } = parseSseFrames(': giữ kết nối\n\ndata: {"a":1}\n\n');
    expect(frames).toEqual(['{"a":1}']);
  });

  it('chuỗi rỗng không sinh khung nào', () => {
    expect(parseSseFrames('').frames).toEqual([]);
  });
});

describe('listCatalog', () => {
  it('trả danh sách voice', async () => {
    const fetchImpl = jsonFetch(
      JSON.stringify({
        version: 1,
        voices: [{ id: 'vi_VN-vais1000-medium', lang: 'vi', installed: false }],
      }),
    );
    const client = createSidecarClient({ endpoint, token: 't', fetchImpl });

    const voices = await client.listCatalog();
    expect(voices).toHaveLength(1);
    expect(voices[0]?.id).toBe('vi_VN-vais1000-medium');
    expect(fetchImpl.calls[0]?.url).toBe('http://127.0.0.1:54757/voices/catalog');
  });

  it('thiếu trường voices thì ném', async () => {
    const client = createSidecarClient({ endpoint, token: 't', fetchImpl: jsonFetch('{}') });
    await expect(client.listCatalog()).rejects.toThrow(/voices/);
  });
});

describe('listInstalled', () => {
  it('gọi đúng đường dẫn /voices', async () => {
    const fetchImpl = jsonFetch(JSON.stringify({ voices: [] }));
    const client = createSidecarClient({ endpoint, token: 't', fetchImpl });

    await client.listInstalled();
    expect(fetchImpl.calls[0]?.url).toBe('http://127.0.0.1:54757/voices');
  });
});

describe('downloadVoice', () => {
  const collect = async (chunks: string[]): Promise<VoiceDownloadProgress[]> => {
    const client = createSidecarClient({
      endpoint,
      token: 't',
      fetchImpl: streamingFetch(chunks),
    });
    const seen: VoiceDownloadProgress[] = [];
    await client.downloadVoice({
      voiceId: 'vi_VN-vais1000-medium',
      onProgress: (p) => seen.push(p),
    });
    return seen;
  };

  it('đọc được tiến độ từ dòng chảy SSE', async () => {
    const seen = await collect([
      frame({ voiceId: 'v', state: 'downloading', receivedBytes: 10, totalBytes: 100 }),
      frame({ voiceId: 'v', state: 'done', receivedBytes: 100, totalBytes: 100 }),
    ]);

    expect(seen.map((p) => p.state)).toEqual(['downloading', 'done']);
    expect(seen[1]?.receivedBytes).toBe(100);
  });

  it('ghép đúng khung bị CẮT LÀM ĐÔI giữa hai khối mạng', async () => {
    // Khung bị cắt ngay giữa chuỗi JSON — nếu parse từng khối rời thì hỏng.
    const whole = frame({ voiceId: 'v', state: 'downloading', receivedBytes: 5, totalBytes: 9 });
    const cut = Math.floor(whole.length / 2);
    const seen = await collect([whole.slice(0, cut), whole.slice(cut)]);

    expect(seen).toHaveLength(1);
    expect(seen[0]?.receivedBytes).toBe(5);
  });

  it('giải mã đúng ký tự UTF-8 bị cắt giữa hai khối', async () => {
    // Tên voice tiếng Việt: một ký tự chiếm nhiều byte, cắt giữa chừng mà
    // giải mã từng khối rời sẽ ra ký tự thay thế.
    const whole = frame({
      voiceId: 'v',
      state: 'error',
      receivedBytes: 0,
      totalBytes: 0,
      message: 'Tải giọng đọc thất bại',
    });
    const bytes = new TextEncoder().encode(whole);
    const encoderCut = 30;

    const client = createSidecarClient({
      endpoint,
      token: 't',
      fetchImpl: (async () => ({
        ok: true,
        status: 200,
        text: async () => whole,
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes.slice(0, encoderCut));
            controller.enqueue(bytes.slice(encoderCut));
            controller.close();
          },
        }),
      })) as FetchLike,
    });

    const seen: VoiceDownloadProgress[] = [];
    await client.downloadVoice({ voiceId: 'v', onProgress: (p) => seen.push(p) });

    expect(seen[0]?.message).toBe('Tải giọng đọc thất bại');
  });

  it('bỏ qua khung JSON hỏng thay vì huỷ cả lượt tải', async () => {
    // Mất một mốc tiến độ không sao; ném ở đây thì huỷ luôn 63 MB đang tải dở.
    const seen = await collect([
      'data: { hỏng\n\n',
      frame({ voiceId: 'v', state: 'done', receivedBytes: 1, totalBytes: 1 }),
    ]);

    expect(seen).toHaveLength(1);
    expect(seen[0]?.state).toBe('done');
  });

  it('bỏ qua khung thiếu trường bắt buộc', async () => {
    const seen = await collect([
      frame({ state: 'downloading' }),
      frame({ voiceId: 'v', state: 'done', receivedBytes: 1, totalBytes: 1 }),
    ]);
    expect(seen).toHaveLength(1);
  });

  it('bỏ qua khung có state lạ', async () => {
    const seen = await collect([frame({ voiceId: 'v', state: 'khong-biet' })]);
    expect(seen).toEqual([]);
  });

  it('gửi token trong header', async () => {
    let headers: Record<string, string> = {};
    const client = createSidecarClient({
      endpoint,
      token: 'token-bi-mat',
      fetchImpl: (async (_url, init) => {
        headers = init.headers;
        return { ok: true, status: 200, text: async () => '', body: streamOf([]) };
      }) as FetchLike,
    });

    await client.downloadVoice({ voiceId: 'v', onProgress: () => undefined });
    expect(headers[TOKEN_HEADER]).toBe('token-bi-mat');
  });

  it('mã lỗi HTTP thì ném, không im lặng bỏ qua', async () => {
    const client = createSidecarClient({
      endpoint,
      token: 't',
      fetchImpl: streamingFetch([], { ok: false, status: 404 }),
    });

    await expect(
      client.downloadVoice({ voiceId: 'khong-co', onProgress: () => undefined }),
    ).rejects.toThrow(/404/);
  });

  it('không có thân dòng chảy thì đọc trọn một lượt', async () => {
    // Bản `fetch` không hỗ trợ stream vẫn phải cho ra kết quả cuối đúng.
    const body = frame({ voiceId: 'v', state: 'done', receivedBytes: 9, totalBytes: 9 });
    const client = createSidecarClient({
      endpoint,
      token: 't',
      fetchImpl: (async () => ({ ok: true, status: 200, text: async () => body })) as FetchLike,
    });

    const seen: VoiceDownloadProgress[] = [];
    await client.downloadVoice({ voiceId: 'v', onProgress: (p) => seen.push(p) });
    expect(seen[0]?.state).toBe('done');
  });

  it('escape voiceId trong URL', async () => {
    let calledUrl = '';
    const client = createSidecarClient({
      endpoint,
      token: 't',
      fetchImpl: (async (url) => {
        calledUrl = url;
        return { ok: true, status: 200, text: async () => '', body: streamOf([]) };
      }) as FetchLike,
    });

    await client.downloadVoice({ voiceId: 'a b/c', onProgress: () => undefined });
    expect(calledUrl).toBe('http://127.0.0.1:54757/voices/a%20b%2Fc/download');
  });
});

describe('deleteVoice', () => {
  it('trả true khi sidecar báo đã xoá', async () => {
    const fetchImpl = jsonFetch(JSON.stringify({ voiceId: 'v', removed: true }));
    const client = createSidecarClient({ endpoint, token: 't', fetchImpl });

    expect(await client.deleteVoice('v')).toBe(true);
    expect(fetchImpl.calls[0]?.method).toBe('DELETE');
  });

  it('trả false khi không có gì để xoá', async () => {
    const client = createSidecarClient({
      endpoint,
      token: 't',
      fetchImpl: jsonFetch(JSON.stringify({ voiceId: 'v', removed: false })),
    });
    expect(await client.deleteVoice('v')).toBe(false);
  });
});
