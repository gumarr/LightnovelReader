import { describe, expect, it, vi } from 'vitest';
import type { VoiceDownloadProgress } from '@ln/shared';
import { createVoicesHandlers } from './voices.js';
import type { SidecarClient } from '../../services/sidecar-client.js';

/**
 * Test handler `voices:*`.
 *
 * Trọng tâm là những thứ **không** lộ ra ở tầng dưới: nhánh sidecar chưa sẵn
 * sàng, chặn tải trùng, và huỷ không bị báo nhầm thành lỗi.
 */

const catalogVoice = {
  id: 'vi_VN-vais1000-medium',
  lang: 'vi' as const,
  name: 'VAIS 1000',
  quality: 'medium' as const,
  sampleRate: 22050,
  license: 'CC BY-NC-SA 4.0',
  totalBytes: 63_206_154,
  installed: false,
};

type ClientOverrides = Partial<SidecarClient>;

const fakeClient = (overrides: ClientOverrides = {}): SidecarClient =>
  ({
    baseUrl: 'http://127.0.0.1:1',
    health: vi.fn(),
    normalize: vi.fn(),
    listCatalog: vi.fn(async () => [catalogVoice]),
    listInstalled: vi.fn(async () => []),
    downloadVoice: vi.fn(async () => undefined),
    deleteVoice: vi.fn(async () => true),
    ...overrides,
  }) as unknown as SidecarClient;

const setup = (
  client: SidecarClient | undefined,
): {
  handlers: ReturnType<typeof createVoicesHandlers>;
  progress: VoiceDownloadProgress[];
} => {
  const progress: VoiceDownloadProgress[] = [];
  const handlers = createVoicesHandlers({
    getClient: () => client,
    onProgress: (p) => progress.push(p),
    getBitrate: () => 24,
  });
  return { handlers, progress };
};

/** Nhường một vòng event loop để tác vụ tải chạy nền kịp hoàn tất */
const flush = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('khi sidecar chưa sẵn sàng', () => {
  // `getClient()` trả `undefined` là trạng thái BÌNH THƯỜNG lúc app vừa mở,
  // không phải lỗi hiếm — mọi handler phải trả lỗi đọc được thay vì nổ.
  it('listCatalog báo lỗi thay vì ném', async () => {
    const { handlers } = setup(undefined);
    const result = await handlers.listCatalog();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('SIDECAR_UNAVAILABLE');
  });

  it('listInstalled báo lỗi', async () => {
    const { handlers } = setup(undefined);
    expect((await handlers.listInstalled()).ok).toBe(false);
  });

  it('download báo lỗi', () => {
    const { handlers } = setup(undefined);
    expect(handlers.download('vi_VN-vais1000-medium').ok).toBe(false);
  });

  it('remove báo lỗi', async () => {
    const { handlers } = setup(undefined);
    expect((await handlers.remove('vi_VN-vais1000-medium')).ok).toBe(false);
  });
});

describe('listCatalog', () => {
  it('trả về voice kèm cờ đã cài', async () => {
    const { handlers } = setup(fakeClient());
    const result = await handlers.listCatalog();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data[0]?.id).toBe('vi_VN-vais1000-medium');
      expect(result.data[0]?.installed).toBe(false);
      expect(result.data[0]?.totalBytes).toBe(63_206_154);
    }
  });
});

describe('download', () => {
  it('trả về NGAY, không chờ tải xong', async () => {
    // Tải mất vài phút; treo `invoke` suốt thời gian đó thì renderer reload
    // một cái là mất đường theo dõi.
    let resolveDownload = (): void => undefined;
    const client = fakeClient({
      downloadVoice: vi.fn(
        async () =>
          await new Promise<void>((resolve) => {
            resolveDownload = resolve;
          }),
      ),
    });

    const { handlers } = setup(client);
    expect(handlers.download('vi_VN-vais1000-medium').ok).toBe(true);

    resolveDownload();
    await flush();
  });

  it('đẩy tiến độ xuống renderer', async () => {
    const client = fakeClient({
      downloadVoice: vi.fn(async ({ onProgress }) => {
        onProgress({
          voiceId: 'vi_VN-vais1000-medium',
          state: 'downloading',
          receivedBytes: 10,
          totalBytes: 100,
        });
      }),
    });

    const { handlers, progress } = setup(client);
    handlers.download('vi_VN-vais1000-medium');
    await flush();

    expect(progress).toHaveLength(1);
    expect(progress[0]?.receivedBytes).toBe(10);
  });

  it('chặn tải trùng cùng một voice', () => {
    // Hai lượt cùng ghi vào một file `.part` sẽ cho ra file hỏng mà sha256
    // không giải thích được nguyên nhân.
    const client = fakeClient({
      downloadVoice: vi.fn(async () => await new Promise<void>(() => undefined)),
    });

    const { handlers } = setup(client);
    expect(handlers.download('vi_VN-vais1000-medium').ok).toBe(true);

    const second = handlers.download('vi_VN-vais1000-medium');
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe('ALREADY_RUNNING');
  });

  it('cho phép tải HAI voice khác nhau cùng lúc', () => {
    const client = fakeClient({
      downloadVoice: vi.fn(async () => await new Promise<void>(() => undefined)),
    });

    const { handlers } = setup(client);
    expect(handlers.download('vi_VN-vais1000-medium').ok).toBe(true);
    expect(handlers.download('en_US-lessac-medium').ok).toBe(true);
  });

  it('tải xong thì MỞ KHOÁ để tải lại được', async () => {
    // Quên xoá khoá thì voice bị chặn vĩnh viễn tới khi khởi động lại app.
    const { handlers } = setup(fakeClient());

    handlers.download('vi_VN-vais1000-medium');
    await flush();

    expect(handlers.download('vi_VN-vais1000-medium').ok).toBe(true);
  });

  it('tải HỎNG cũng mở khoá', async () => {
    const client = fakeClient({
      downloadVoice: vi.fn(async () => {
        throw new Error('mạng đứt');
      }),
    });

    const { handlers } = setup(client);
    handlers.download('vi_VN-vais1000-medium');
    await flush();

    expect(handlers.download('vi_VN-vais1000-medium').ok).toBe(true);
  });

  it('tải hỏng thì đẩy state error kèm lý do', async () => {
    const client = fakeClient({
      downloadVoice: vi.fn(async () => {
        throw new Error('SHA256 không khớp');
      }),
    });

    const { handlers, progress } = setup(client);
    handlers.download('vi_VN-vais1000-medium');
    await flush();

    expect(progress[0]?.state).toBe('error');
    expect(progress[0]?.message).toContain('SHA256');
  });

  it('voiceId không hợp lệ bị từ chối', () => {
    const { handlers } = setup(fakeClient());
    expect(() => handlers.download('../../windows')).toThrow();
  });

  it('voiceId không phải chuỗi bị từ chối', () => {
    const { handlers } = setup(fakeClient());
    expect(() => handlers.download(42)).toThrow();
  });
});

describe('cancelDownload', () => {
  it('huỷ lượt đang chạy', async () => {
    let seenSignal: AbortSignal | undefined;
    const client = fakeClient({
      downloadVoice: vi.fn(async ({ signal }) => {
        seenSignal = signal;
        await new Promise<void>(() => undefined);
      }),
    });

    const { handlers } = setup(client);
    handlers.download('vi_VN-vais1000-medium');
    await flush();

    handlers.cancelDownload('vi_VN-vais1000-medium');
    expect(seenSignal?.aborted).toBe(true);
  });

  it('huỷ khi không có gì đang tải vẫn OK', () => {
    // User muốn "đừng tải nữa", mà điều đó đã đúng sẵn rồi.
    const { handlers } = setup(fakeClient());
    expect(handlers.cancelDownload('vi_VN-vais1000-medium').ok).toBe(true);
  });

  it('huỷ KHÔNG bị báo nhầm thành lỗi', async () => {
    // Hiện hộp thoại đỏ cho hành động user vừa chủ động làm là sai.
    const client = fakeClient({
      downloadVoice: vi.fn(async ({ signal }) => {
        await new Promise<void>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('aborted')));
        });
      }),
    });

    const { handlers, progress } = setup(client);
    handlers.download('vi_VN-vais1000-medium');
    await flush();
    handlers.cancelDownload('vi_VN-vais1000-medium');
    await flush();

    expect(progress.filter((p) => p.state === 'error')).toHaveLength(0);
  });
});

describe('remove', () => {
  it('gọi sidecar xoá voice', async () => {
    const deleteVoice = vi.fn(async () => true);
    const { handlers } = setup(fakeClient({ deleteVoice }));

    expect((await handlers.remove('vi_VN-vais1000-medium')).ok).toBe(true);
    expect(deleteVoice).toHaveBeenCalledWith('vi_VN-vais1000-medium');
  });

  it('huỷ lượt tải dở trước khi xoá', async () => {
    // Không huỷ thì thread tải bên sidecar dựng lại đúng thư mục vừa xoá.
    let seenSignal: AbortSignal | undefined;
    const client = fakeClient({
      downloadVoice: vi.fn(async ({ signal }) => {
        seenSignal = signal;
        await new Promise<void>(() => undefined);
      }),
    });

    const { handlers } = setup(client);
    handlers.download('vi_VN-vais1000-medium');
    await flush();

    await handlers.remove('vi_VN-vais1000-medium');
    expect(seenSignal?.aborted).toBe(true);
  });

  it('voiceId không hợp lệ bị từ chối', async () => {
    const { handlers } = setup(fakeClient());
    await expect(handlers.remove('a/../b')).rejects.toThrow();
  });
});

describe('preview', () => {
  const installedVi = {
    id: 'vi_VN-vais1000-medium',
    lang: 'vi' as const,
    name: 'VAIS 1000',
    quality: 'medium' as const,
    sampleRate: 22050,
    sizeBytes: 63_206_154,
  };

  /**
   * `preview` giả trả 4 byte nhận ra được, đủ để kiểm bytes đi đúng đường.
   *
   * Khai báo tham số tường minh (không phải `async () => …`) để `mock.calls`
   * còn giữ kiểu — thiếu nó thì tuple rỗng và không đọc được cái gì đã gửi đi.
   */
  const fakePreview = (): SidecarClient['preview'] =>
    vi.fn(async (_input: Parameters<SidecarClient['preview']>[0]) => ({
      voiceId: 'vi_VN-vais1000-medium',
      durationMs: 4200,
      sampleRate: 24000,
      audio: new Uint8Array([0x4f, 0x67, 0x67, 0x53]), // "OggS"
    }));

  it('trả bytes audio và câu đã đọc', async () => {
    const preview = fakePreview();
    const { handlers } = setup(
      fakeClient({ listInstalled: vi.fn(async () => [installedVi]), preview }),
    );

    const result = await handlers.preview('vi_VN-vais1000-medium');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(new Uint8Array(result.data.bytes)).toEqual(new Uint8Array([0x4f, 0x67, 0x67, 0x53]));
    expect(result.data.durationMs).toBe(4200);
    // Câu mẫu phải về theo để UI hiện được user đang nghe gì.
    expect(result.data.text.length).toBeGreaterThan(0);
  });

  it('chọn câu mẫu theo ngôn ngữ của voice', async () => {
    // Voice EN phải đọc câu EN — đọc câu tiếng Việt bằng giọng Anh thì user
    // không đánh giá được giọng đó có dùng được không.
    const preview = fakePreview();
    const installedEn = { ...installedVi, id: 'en_US-lessac-medium', lang: 'en' as const };
    const { handlers } = setup(
      fakeClient({ listInstalled: vi.fn(async () => [installedEn]), preview }),
    );

    await handlers.preview('en_US-lessac-medium');
    const sent = vi.mocked(preview).mock.calls[0]?.[0];
    expect(sent?.lang).toBe('en');
    expect(sent?.text).toMatch(/classroom/);
  });

  it('voice chưa cài thì báo lỗi thay vì gọi sidecar', async () => {
    // Gọi thẳng xuống thì sidecar trả 422 với câu khó hiểu; chặn ở đây để nói
    // đúng thứ user cần làm.
    const preview = fakePreview();
    const { handlers } = setup(
      fakeClient({ listInstalled: vi.fn(async () => []), preview }),
    );

    const result = await handlers.preview('vi_VN-vais1000-medium');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_FOUND');
    expect(preview).not.toHaveBeenCalled();
  });

  it('dùng bitrate hiện tại trong settings', async () => {
    // Nghe thử ở bitrate khác lúc generate thì user đánh giá nhầm chất lượng.
    const preview = fakePreview();
    const progress: VoiceDownloadProgress[] = [];
    const handlers = createVoicesHandlers({
      getClient: () => fakeClient({ listInstalled: vi.fn(async () => [installedVi]), preview }),
      onProgress: (p) => progress.push(p),
      getBitrate: () => 32,
    });

    await handlers.preview('vi_VN-vais1000-medium');
    const sent = vi.mocked(preview).mock.calls[0]?.[0];
    expect(sent?.bitrate).toBe(32);
  });

  it('sidecar chưa sẵn sàng thì báo lỗi thay vì ném', async () => {
    const { handlers } = setup(undefined);
    const result = await handlers.preview('vi_VN-vais1000-medium');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('SIDECAR_UNAVAILABLE');
  });

  it('voiceId không hợp lệ bị từ chối', async () => {
    const { handlers } = setup(fakeClient());
    await expect(handlers.preview('a/../b')).rejects.toThrow();
  });
});
