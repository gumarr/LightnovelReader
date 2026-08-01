import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { err, type UpdateStatus } from '@ln/shared';
import { installFakeApi, type FakeApi } from '@/test/fake-api';
import { useSettingsStore } from '@/stores/settings-store';
import { useUpdateStore } from '@/stores/update-store';
import { SettingsScreen } from './SettingsScreen';

/**
 * Test màn Cài đặt (P5.3).
 *
 * Trọng tâm: cỡ chữ phụ đề **thật sự ghi xuống settings** (trước P5.3 nó là
 * setting chết — có trong schema mà không màn nào đọc), và màn này không dựng
 * lại các ô đã có ở Storage Manager mà chỉ trỏ sang.
 */

let fake: FakeApi;

const renderScreen = async (): Promise<{
  onBack: ReturnType<typeof vi.fn>;
  onManageStorage: ReturnType<typeof vi.fn>;
}> => {
  const onBack = vi.fn();
  const onManageStorage = vi.fn();

  await act(async () => {
    render(<SettingsScreen onBack={onBack} onManageStorage={onManageStorage} />);
  });

  return { onBack, onManageStorage };
};

/** Dựng trạng thái cập nhật **trước** khi render — không cần `act` ở đây */
const setUpdateStatus = (status: UpdateStatus): void => {
  useUpdateStore.setState({ status });
};

beforeEach(async () => {
  vi.clearAllMocks();
  fake = installFakeApi();
  useSettingsStore.setState({ settings: null, error: null, loading: false });
  useUpdateStore.setState({ status: null, error: null, dismissed: false });
  await useSettingsStore.getState().load();
});

describe('cỡ chữ phụ đề', () => {
  it('hiện giá trị đang lưu trong settings', async () => {
    await renderScreen();
    expect(screen.getByTestId('subtitle-font-value')).toHaveTextContent('18 px');
  });

  it('kéo thanh trượt thì ghi xuống settings', async () => {
    // Đây là đường biến `subtitleFontSize` từ setting chết thành setting thật.
    // Dùng `fireEvent.change` chứ không `userEvent`: với `input[type=range]`,
    // userEvent phải mô phỏng cả quãng kéo chuột theo toạ độ — mà jsdom không
    // có bố cục thật nên không tính ra được giá trị đích.
    await renderScreen();

    await act(async () => {
      fireEvent.change(screen.getByTestId('subtitle-font-range'), { target: { value: '28' } });
    });

    await waitFor(() => {
      expect(fake.api.settings.update).toHaveBeenCalledWith({ subtitleFontSize: 28 });
    });
  });

  it('xem thử đổi cỡ chữ ngay tại chỗ', async () => {
    // Con số px không nói lên gì cho tới khi nhìn thấy — nếu preview không đổi
    // theo thì thanh trượt này vô dụng.
    await renderScreen();
    expect(screen.getByTestId('subtitle-font-preview').style.fontSize).toBe('18px');
  });

  it('settings chưa nạp xong vẫn hiện được mặc định', async () => {
    useSettingsStore.setState({ settings: null });
    await renderScreen();

    expect(screen.getByTestId('subtitle-font-value')).toHaveTextContent('18 px');
  });
});

describe('dung lượng', () => {
  it('chỉ trỏ sang Storage Manager, không dựng lại các ô ở đây', async () => {
    // Hai chỗ chỉnh cùng một thứ mà chỉ một chỗ hiện hậu quả là cái bẫy cần tránh.
    const { onManageStorage } = await renderScreen();

    await act(async () => {
      await userEvent.click(screen.getByTestId('settings-open-storage'));
    });

    expect(onManageStorage).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('storage-audio-dir')).not.toBeInTheDocument();
  });
});

describe('về ứng dụng', () => {
  it('hiện phiên bản để user báo lỗi có căn cứ', async () => {
    await renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('settings-version')).toHaveTextContent('0.1.0');
    });
  });

  it('lỗi đọc thông tin app KHÔNG chặn phần cài đặt bên trên', async () => {
    fake.api.app.getInfo.mockResolvedValueOnce(err('UNKNOWN', 'Không đọc được'));
    await renderScreen();

    expect(screen.queryByTestId('settings-about')).not.toBeInTheDocument();
    // Phần quan trọng vẫn dùng được
    expect(screen.getByTestId('subtitle-font-range')).toBeInTheDocument();
  });

  it('IPC reject cũng không làm vỡ màn hình', async () => {
    fake.api.app.getInfo.mockRejectedValueOnce(new Error('main chết'));
    await renderScreen();

    expect(screen.getByTestId('settings-screen')).toBeInTheDocument();
  });
});

describe('cập nhật (P5.5c)', () => {
  it('ô tick tự kiểm tra ghi xuống settings', async () => {
    // `autoCheckUpdates` có trong schema từ P5.5b mà tới đây mới có chỗ bấm —
    // đúng hình dạng "setting chết" của PROGRESS 4.71.
    await renderScreen();

    // `fireEvent` chứ không `userEvent`: `userEvent.click` chờ giữa các bước
    // chuột, mà store zustand `set()` ngay trong handler — React thấy lần đổi
    // state đó rơi ngoài `act` và cảnh báo. `fireEvent` bắn một sự kiện gọn.
    await act(async () => {
      fireEvent.click(screen.getByTestId('update-auto-check'));
    });

    await waitFor(() => {
      expect(fake.api.settings.update).toHaveBeenCalledWith({ autoCheckUpdates: false });
    });
  });

  it('bấm "Kiểm tra" gọi tới main', async () => {
    setUpdateStatus({ state: 'idle', currentVersion: '0.1.0' });
    await renderScreen();

    await act(async () => {
      fireEvent.click(screen.getByTestId('update-action'));
    });

    expect(fake.api.update.check).toHaveBeenCalledTimes(1);
  });

  it('bấm "Tải bản mới" gọi download chứ không gọi check', async () => {
    setUpdateStatus({ state: 'available', currentVersion: '0.1.0', availableVersion: '0.2.0' });
    await renderScreen();

    await act(async () => {
      fireEvent.click(screen.getByTestId('update-action'));
    });

    expect(fake.api.update.download).toHaveBeenCalledTimes(1);
    expect(fake.api.update.check).not.toHaveBeenCalled();
  });

  it('lỗi cập nhật hiện riêng, không lẫn với lỗi lưu settings', async () => {
    // Gộp chung một ô sẽ khiến "không kiểm được bản mới" trông như "không lưu
    // được cỡ chữ" — hai việc khác hẳn nhau.
    useUpdateStore.setState({ error: 'Không kết nối được tiến trình chính.' });
    await renderScreen();

    expect(screen.getByTestId('update-error')).toBeInTheDocument();
    expect(screen.queryByTestId('settings-error')).not.toBeInTheDocument();
  });
});

describe('điều hướng', () => {
  it('nút quay lại gọi onBack', async () => {
    const { onBack } = await renderScreen();

    await act(async () => {
      await userEvent.click(screen.getByTestId('settings-back'));
    });

    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
