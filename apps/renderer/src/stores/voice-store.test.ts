import { beforeEach, describe, expect, it } from 'vitest';
import { err } from '@ln/shared';
import { installFakeApi, type FakeApi } from '@/test/fake-api';
import { useVoiceStore } from './voice-store';

/**
 * Test store voice manager.
 *
 * Trọng tâm: tiến độ tải giữ **riêng theo voiceId**, và mọi lời gọi IPC đều
 * bắt được rejection (xem PROGRESS mục 4.3 — không bắt thì UI kẹt vĩnh viễn).
 */

let fake: FakeApi;

const reset = (): void => {
  useVoiceStore.setState({
    catalog: [],
    progress: {},
    loading: false,
    error: null,
    sidecar: null,
  });
};

beforeEach(() => {
  fake = installFakeApi();
  reset();
});

describe('load', () => {
  it('nạp catalog và trạng thái sidecar', async () => {
    await useVoiceStore.getState().load();

    const state = useVoiceStore.getState();
    expect(state.catalog).toHaveLength(2);
    expect(state.sidecar?.state).toBe('ready');
    expect(state.error).toBeNull();
  });

  it('lỗi từ main hiện ra cho user', async () => {
    fake.api.voices.listCatalog.mockResolvedValueOnce(
      err('SIDECAR_UNAVAILABLE', 'Dịch vụ TTS chưa sẵn sàng.'),
    );

    await useVoiceStore.getState().load();
    expect(useVoiceStore.getState().error).toContain('chưa sẵn sàng');
  });

  it('IPC reject cũng bắt được, không kẹt ở loading', async () => {
    // `ipcRenderer.invoke` reject được khi main chết — không bắt thì UI treo
    // mãi ở "Đang tải…".
    fake.api.voices.listCatalog.mockRejectedValueOnce(new Error('kênh chưa đăng ký'));

    await useVoiceStore.getState().load();
    const state = useVoiceStore.getState();
    expect(state.loading).toBe(false);
    expect(state.error).not.toBeNull();
  });
});

describe('download', () => {
  it('đặt mốc 0% NGAY, không chờ khung SSE đầu tiên', async () => {
    // Sidecar mất một lúc mới nối tới HF; nút bấm rồi không đổi gì thì user
    // sẽ bấm lại lần nữa.
    await useVoiceStore.getState().download('vi_VN-vais1000-medium');

    const progress = useVoiceStore.getState().progress['vi_VN-vais1000-medium'];
    expect(progress?.state).toBe('downloading');
    expect(progress?.receivedBytes).toBe(0);
  });

  it('main từ chối thì bỏ mốc tiến độ đi', async () => {
    // Để lại thanh tiến trình đứng im ở 0% là nói dối user.
    fake.api.voices.download.mockResolvedValueOnce(
      err('ALREADY_RUNNING', 'Voice này đang được tải rồi.'),
    );

    await useVoiceStore.getState().download('vi_VN-vais1000-medium');
    const state = useVoiceStore.getState();
    expect(state.progress['vi_VN-vais1000-medium']).toBeUndefined();
    expect(state.error).toContain('đang được tải');
  });

  it('IPC reject cũng dọn tiến độ', async () => {
    fake.api.voices.download.mockRejectedValueOnce(new Error('main chết'));

    await useVoiceStore.getState().download('vi_VN-vais1000-medium');
    expect(useVoiceStore.getState().progress['vi_VN-vais1000-medium']).toBeUndefined();
  });
});

describe('applyProgress', () => {
  it('cập nhật tiến độ theo voiceId', () => {
    useVoiceStore.getState().applyProgress({
      voiceId: 'vi_VN-vais1000-medium',
      state: 'downloading',
      receivedBytes: 50,
      totalBytes: 100,
    });

    expect(useVoiceStore.getState().progress['vi_VN-vais1000-medium']?.receivedBytes).toBe(50);
  });

  it('hai voice tải song song KHÔNG đè tiến độ của nhau', () => {
    const store = useVoiceStore.getState();
    store.applyProgress({
      voiceId: 'a',
      state: 'downloading',
      receivedBytes: 10,
      totalBytes: 100,
    });
    store.applyProgress({
      voiceId: 'b',
      state: 'downloading',
      receivedBytes: 70,
      totalBytes: 100,
    });

    const progress = useVoiceStore.getState().progress;
    expect(progress['a']?.receivedBytes).toBe(10);
    expect(progress['b']?.receivedBytes).toBe(70);
  });

  it('trạng thái verifying vẫn giữ trong tiến độ', () => {
    useVoiceStore.getState().applyProgress({
      voiceId: 'a',
      state: 'verifying',
      receivedBytes: 100,
      totalBytes: 100,
    });
    expect(useVoiceStore.getState().progress['a']?.state).toBe('verifying');
  });

  it('done thì xoá tiến độ và nạp lại catalog', async () => {
    fake.setVoiceInstalled('vi_VN-vais1000-medium', true);

    useVoiceStore.getState().applyProgress({
      voiceId: 'vi_VN-vais1000-medium',
      state: 'done',
      receivedBytes: 100,
      totalBytes: 100,
    });

    // `load()` chạy nền — chờ một vòng rồi mới kiểm.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const state = useVoiceStore.getState();
    expect(state.progress['vi_VN-vais1000-medium']).toBeUndefined();
    expect(state.catalog.find((v) => v.id === 'vi_VN-vais1000-medium')?.installed).toBe(true);
  });

  it('error thì xoá tiến độ và hiện lý do', () => {
    useVoiceStore.getState().applyProgress({
      voiceId: 'a',
      state: 'error',
      receivedBytes: 0,
      totalBytes: 0,
      message: 'SHA256 không khớp',
    });

    const state = useVoiceStore.getState();
    expect(state.progress['a']).toBeUndefined();
    expect(state.error).toBe('SHA256 không khớp');
  });

  it('error không kèm lý do vẫn có thông báo đọc được', () => {
    useVoiceStore.getState().applyProgress({
      voiceId: 'a',
      state: 'error',
      receivedBytes: 0,
      totalBytes: 0,
    });
    expect(useVoiceStore.getState().error).toBeTruthy();
  });
});

describe('cancel', () => {
  it('xoá tiến độ ngay để thanh không đứng im như treo', async () => {
    useVoiceStore.getState().applyProgress({
      voiceId: 'a',
      state: 'downloading',
      receivedBytes: 10,
      totalBytes: 100,
    });

    await useVoiceStore.getState().cancel('a');
    expect(useVoiceStore.getState().progress['a']).toBeUndefined();
  });

  it('IPC hỏng vẫn dọn tiến độ', async () => {
    fake.api.voices.cancelDownload.mockRejectedValueOnce(new Error('main chết'));
    useVoiceStore.getState().applyProgress({
      voiceId: 'a',
      state: 'downloading',
      receivedBytes: 10,
      totalBytes: 100,
    });

    await useVoiceStore.getState().cancel('a');
    expect(useVoiceStore.getState().progress['a']).toBeUndefined();
  });
});

describe('remove', () => {
  it('xoá xong thì nạp lại catalog', async () => {
    await useVoiceStore.getState().load();
    fake.setVoiceInstalled('en_US-lessac-medium', false);

    await useVoiceStore.getState().remove('en_US-lessac-medium');

    const voice = useVoiceStore.getState().catalog.find((v) => v.id === 'en_US-lessac-medium');
    expect(voice?.installed).toBe(false);
  });

  it('lỗi xoá hiện ra cho user', async () => {
    fake.api.voices.remove.mockResolvedValueOnce(err('IO_ERROR', 'File đang được dùng'));

    await useVoiceStore.getState().remove('en_US-lessac-medium');
    expect(useVoiceStore.getState().error).toContain('đang được dùng');
  });
});

describe('setSidecar', () => {
  it('nhận trạng thái mới từ event', () => {
    useVoiceStore.getState().setSidecar({ state: 'failed', restarts: 3, engineReady: false });
    expect(useVoiceStore.getState().sidecar?.state).toBe('failed');
  });
});

describe('clearError', () => {
  it('đóng được thông báo lỗi', () => {
    useVoiceStore.setState({ error: 'lỗi gì đó' });
    useVoiceStore.getState().clearError();
    expect(useVoiceStore.getState().error).toBeNull();
  });
});
