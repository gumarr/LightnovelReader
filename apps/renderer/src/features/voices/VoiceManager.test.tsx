import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeVoice, installFakeApi, type FakeApi } from '@/test/fake-api';
import { useVoiceStore } from '@/stores/voice-store';
import { useSettingsStore } from '@/stores/settings-store';
import { VoiceManager } from './VoiceManager';

/**
 * Test màn quản lý giọng đọc.
 *
 * Trọng tâm là hành vi user thấy được: nút bị chặn khi sidecar chưa lên, thanh
 * tiến trình chạy theo event, và trạng thái sidecar hiện ra (nợ P2.2).
 */

let fake: FakeApi;

const renderManager = async (options: Parameters<typeof installFakeApi>[0] = {}) => {
  fake = installFakeApi(options);
  useVoiceStore.setState({
    catalog: [],
    progress: {},
    loading: false,
    error: null,
    sidecar: null,
  });

  // Từ P2.6 màn này đọc `AppSettings.voiceVi/voiceEn` để biết giọng nào đang dùng
  useSettingsStore.setState({ settings: null, error: null, loading: false });
  await useSettingsStore.getState().load();

  const onBack = vi.fn();
  await act(async () => {
    render(<VoiceManager onBack={onBack} />);
  });
  return { onBack };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('danh sách voice', () => {
  it('hiện voice từ catalog', async () => {
    await renderManager();

    await waitFor(() => expect(screen.getAllByTestId('voice-row')).toHaveLength(2));
    expect(screen.getByText('VAIS 1000')).toBeInTheDocument();
    expect(screen.getByText('Lessac')).toBeInTheDocument();
  });

  it('hiện dung lượng để user biết phải tải bao nhiêu', async () => {
    await renderManager();
    await waitFor(() => expect(screen.getAllByTestId('voice-row')).toHaveLength(2));
    expect(screen.getAllByText(/60\.3 MB/)[0]).toBeInTheDocument();
  });

  it('voice đã cài hiện nhãn "Đã cài" và nút Xoá', async () => {
    await renderManager();

    await waitFor(() => expect(screen.getAllByTestId('voice-row')).toHaveLength(2));
    expect(screen.getByTestId('voice-installed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Xoá' })).toBeInTheDocument();
  });

  it('catalog rỗng thì nói rõ chứ không để trắng', async () => {
    await renderManager({ voices: [] });
    await waitFor(() =>
      expect(screen.getByText(/Chưa có giọng đọc nào/)).toBeInTheDocument(),
    );
  });
});

describe('trạng thái sidecar', () => {
  it('hiện badge khi sidecar sẵn sàng', async () => {
    await renderManager();
    await waitFor(() =>
      expect(screen.getByTestId('sidecar-badge')).toHaveAttribute('data-state', 'ready'),
    );
  });

  it('sidecar hỏng thì badge chuyển tông lỗi kèm lý do', async () => {
    // Trước P2.3, sidecar `failed` chỉ thấy trong log — user không biết gì.
    await renderManager({
      sidecarStatus: {
        state: 'failed',
        restarts: 3,
        engineReady: false,
        message: 'Không khởi động được sau 3 lần thử.',
      },
    });

    await waitFor(() => {
      const badge = screen.getByTestId('sidecar-badge');
      expect(badge).toHaveAttribute('data-tone', 'error');
      expect(badge).toHaveTextContent('3 lần thử');
    });
  });

  it('badge cập nhật khi main đẩy trạng thái mới', async () => {
    await renderManager();
    await waitFor(() => expect(screen.getByTestId('sidecar-badge')).toBeInTheDocument());

    act(() => {
      fake.emitSidecarStatus({ state: 'restarting', restarts: 1, engineReady: false });
    });

    await waitFor(() =>
      expect(screen.getByTestId('sidecar-badge')).toHaveAttribute('data-state', 'restarting'),
    );
  });

  it('huỷ đăng ký listener khi rời màn — không rò mỗi lần vào ra', async () => {
    fake = installFakeApi();
    const { unmount } = render(<VoiceManager onBack={vi.fn()} />);
    await waitFor(() => expect(fake.sidecarListenerCount()).toBe(1));

    unmount();
    expect(fake.sidecarListenerCount()).toBe(0);
    expect(fake.voiceProgressListenerCount()).toBe(0);
  });
});

describe('nút tải', () => {
  it('bấm tải thì gọi IPC', async () => {
    const user = userEvent.setup();
    await renderManager();
    await waitFor(() => expect(screen.getAllByTestId('voice-row')).toHaveLength(2));

    await user.click(screen.getByRole('button', { name: 'Tải về' }));
    expect(fake.api.voices.download).toHaveBeenCalledWith('vi_VN-vais1000-medium');
  });

  it('sidecar chưa sẵn sàng thì nút tải bị chặn', async () => {
    // Tải model cần sidecar sống — cho bấm rồi báo lỗi là tệ hơn chặn trước.
    await renderManager({
      sidecarStatus: { state: 'starting', restarts: 0, engineReady: false },
    });

    await waitFor(() => expect(screen.getAllByTestId('voice-row')).toHaveLength(2));
    expect(screen.getByRole('button', { name: 'Tải về' })).toBeDisabled();
  });

  it('nút bị chặn có nói lý do', async () => {
    await renderManager({
      sidecarStatus: { state: 'starting', restarts: 0, engineReady: false },
    });
    await waitFor(() => expect(screen.getAllByTestId('voice-row')).toHaveLength(2));

    expect(screen.getByRole('button', { name: 'Tải về' })).toHaveAttribute(
      'title',
      expect.stringContaining('dịch vụ TTS'),
    );
  });

  it('engineReady=false KHÔNG chặn tải — engine chỉ nạp ở P2.4', async () => {
    // Chặn theo `engineReady` thì không bao giờ tải được voice nào.
    await renderManager({
      sidecarStatus: { state: 'ready', restarts: 0, port: 1, engineReady: false },
    });

    await waitFor(() => expect(screen.getAllByTestId('voice-row')).toHaveLength(2));
    expect(screen.getByRole('button', { name: 'Tải về' })).toBeEnabled();
  });
});

describe('tiến độ tải', () => {
  it('thanh tiến trình chạy theo event từ main', async () => {
    const user = userEvent.setup();
    await renderManager();
    await waitFor(() => expect(screen.getAllByTestId('voice-row')).toHaveLength(2));

    await user.click(screen.getByRole('button', { name: 'Tải về' }));

    act(() => {
      fake.emitVoiceProgress({
        voiceId: 'vi_VN-vais1000-medium',
        state: 'downloading',
        receivedBytes: 31_603_077,
        totalBytes: 63_206_154,
      });
    });

    await waitFor(() =>
      expect(screen.getByTestId('voice-progress')).toHaveAttribute('aria-valuenow', '50'),
    );
  });

  it('đang tải thì nút đổi thành Huỷ', async () => {
    const user = userEvent.setup();
    await renderManager();
    await waitFor(() => expect(screen.getAllByTestId('voice-row')).toHaveLength(2));

    await user.click(screen.getByRole('button', { name: 'Tải về' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Huỷ' })).toBeInTheDocument());
  });

  it('giai đoạn verify nói rõ đang kiểm tra, không để thanh đứng im khó hiểu', async () => {
    const user = userEvent.setup();
    await renderManager();
    await waitFor(() => expect(screen.getAllByTestId('voice-row')).toHaveLength(2));
    await user.click(screen.getByRole('button', { name: 'Tải về' }));

    act(() => {
      fake.emitVoiceProgress({
        voiceId: 'vi_VN-vais1000-medium',
        state: 'verifying',
        receivedBytes: 63_206_154,
        totalBytes: 63_206_154,
      });
    });

    await waitFor(() =>
      expect(screen.getByText(/Đang kiểm tra tính toàn vẹn/)).toBeInTheDocument(),
    );
  });

  it('bấm Huỷ thì gọi IPC huỷ', async () => {
    const user = userEvent.setup();
    await renderManager();
    await waitFor(() => expect(screen.getAllByTestId('voice-row')).toHaveLength(2));
    await user.click(screen.getByRole('button', { name: 'Tải về' }));

    await user.click(await screen.findByRole('button', { name: 'Huỷ' }));
    expect(fake.api.voices.cancelDownload).toHaveBeenCalledWith('vi_VN-vais1000-medium');
  });

  it('tải hỏng thì hiện lỗi cho user', async () => {
    const user = userEvent.setup();
    await renderManager();
    await waitFor(() => expect(screen.getAllByTestId('voice-row')).toHaveLength(2));
    await user.click(screen.getByRole('button', { name: 'Tải về' }));

    act(() => {
      fake.emitVoiceProgress({
        voiceId: 'vi_VN-vais1000-medium',
        state: 'error',
        receivedBytes: 0,
        totalBytes: 0,
        message: 'SHA256 không khớp — file tải về có thể đã hỏng',
      });
    });

    await waitFor(() =>
      expect(screen.getByTestId('voice-error')).toHaveTextContent('SHA256 không khớp'),
    );
  });
});

describe('xoá voice', () => {
  it('bấm Xoá thì gọi IPC', async () => {
    const user = userEvent.setup();
    await renderManager();
    await waitFor(() => expect(screen.getAllByTestId('voice-row')).toHaveLength(2));

    await user.click(screen.getByRole('button', { name: 'Xoá' }));
    expect(fake.api.voices.remove).toHaveBeenCalledWith('en_US-lessac-medium');
  });
});

describe('điều hướng', () => {
  it('nút quay lại gọi onBack', async () => {
    const user = userEvent.setup();
    const { onBack } = await renderManager();

    await user.click(screen.getByRole('button', { name: /Quay lại/ }));
    expect(onBack).toHaveBeenCalled();
  });
});

describe('chọn giọng đọc (P2.6)', () => {
  it('voice đã cài có nút "Dùng giọng này"', async () => {
    await renderManager();

    await waitFor(() => expect(screen.getAllByTestId('voice-row')).toHaveLength(2));
    // Trong catalog mẫu chỉ voice EN đã cài
    expect(screen.getAllByTestId('voice-select')).toHaveLength(1);
  });

  it('voice CHƯA cài thì không cho chọn', async () => {
    // Chọn voice chưa tải sẽ ghi vào settings một id mà hàng đợi không nạp được
    await renderManager({ voices: [fakeVoice({ installed: false })] });

    await waitFor(() => expect(screen.getAllByTestId('voice-row')).toHaveLength(1));
    expect(screen.queryByTestId('voice-select')).not.toBeInTheDocument();
  });

  it('bấm chọn thì ghi vào settings theo NGÔN NGỮ của voice', async () => {
    await renderManager({ voices: [fakeVoice({ installed: true })] });

    await waitFor(() => expect(screen.getByTestId('voice-select')).toBeInTheDocument());
    await userEvent.click(screen.getByTestId('voice-select'));

    await waitFor(() => {
      expect(fake.api.settings.update).toHaveBeenCalledWith({
        voiceVi: 'vi_VN-vais1000-medium',
      });
    });
  });

  it('voice EN ghi vào voiceEn, không đè lên voiceVi', async () => {
    // Một `voiceId` dùng chung sẽ khiến sách EN bị đọc bằng giọng Việt
    await renderManager({
      voices: [fakeVoice({ id: 'en_US-lessac-medium', lang: 'en', installed: true })],
    });

    await waitFor(() => expect(screen.getByTestId('voice-select')).toBeInTheDocument());
    await userEvent.click(screen.getByTestId('voice-select'));

    await waitFor(() => {
      expect(fake.api.settings.update).toHaveBeenCalledWith({ voiceEn: 'en_US-lessac-medium' });
    });
  });

  it('giọng đang dùng hiện nhãn thay cho nút', async () => {
    await renderManager({
      voices: [fakeVoice({ installed: true })],
      settings: { voiceVi: 'vi_VN-vais1000-medium' },
    });

    await waitFor(() => expect(screen.getByTestId('voice-selected')).toBeInTheDocument());
    expect(screen.queryByTestId('voice-select')).not.toBeInTheDocument();
    expect(screen.getByTestId('voice-row').dataset['selected']).toBe('true');
  });

  it('nhắc khi đã cài mà chưa chọn — cái bẫy hàng đợi dừng ngay', async () => {
    await renderManager({ voices: [fakeVoice({ installed: true })] });

    await waitFor(() => {
      expect(screen.getByTestId('voice-unselected-hint')).toBeInTheDocument();
    });
  });

  it('đã chọn rồi thì không nhắc nữa', async () => {
    await renderManager({
      voices: [fakeVoice({ installed: true })],
      settings: { voiceVi: 'vi_VN-vais1000-medium' },
    });

    await waitFor(() => expect(screen.getByTestId('voice-selected')).toBeInTheDocument());
    expect(screen.queryByTestId('voice-unselected-hint')).not.toBeInTheDocument();
  });

  it('chưa cài voice nào thì không nhắc chọn', async () => {
    await renderManager({ voices: [fakeVoice({ installed: false })] });

    await waitFor(() => expect(screen.getAllByTestId('voice-row')).toHaveLength(1));
    expect(screen.queryByTestId('voice-unselected-hint')).not.toBeInTheDocument();
  });

  it('xoá giọng ĐANG dùng thì bỏ chọn luôn', async () => {
    // Để nguyên thì settings trỏ tới model không còn trên đĩa, và lỗi chỉ lộ ra
    // tới lúc generate
    await renderManager({
      voices: [fakeVoice({ installed: true })],
      settings: { voiceVi: 'vi_VN-vais1000-medium' },
    });

    await waitFor(() => expect(screen.getByTestId('voice-selected')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Xoá' }));

    await waitFor(() => {
      expect(fake.api.settings.update).toHaveBeenCalledWith({ voiceVi: '' });
    });
    expect(fake.api.voices.remove).toHaveBeenCalledWith('vi_VN-vais1000-medium');
  });

  it('xoá giọng KHÔNG dùng thì không đụng vào settings', async () => {
    await renderManager({
      voices: [
        fakeVoice({ installed: true }),
        fakeVoice({ id: 'vi_VN-other-medium', name: 'Khác', installed: true }),
      ],
      settings: { voiceVi: 'vi_VN-other-medium' },
    });

    await waitFor(() => expect(screen.getAllByTestId('voice-row')).toHaveLength(2));
    const rows = screen.getAllByTestId('voice-row');
    const notSelected = rows.find((r) => r.dataset['selected'] === 'false');
    await userEvent.click(within(notSelected!).getByRole('button', { name: 'Xoá' }));

    expect(fake.api.settings.update).not.toHaveBeenCalled();
    expect(fake.api.voices.remove).toHaveBeenCalledWith('vi_VN-vais1000-medium');
  });
});
