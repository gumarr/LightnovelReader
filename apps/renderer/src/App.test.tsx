import { beforeEach, describe, expect, it } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { err } from '@ln/shared';
import { App } from './App';
import { installFakeApi, fakeLibraryEntry, type FakeApi } from '@/test/fake-api';
import { useSettingsStore } from '@/stores/settings-store';
import { useImportStore } from '@/stores/import-store';
import { useLibraryStore } from '@/stores/library-store';
import { useUpdateStore } from '@/stores/update-store';

let fake: FakeApi;

beforeEach(() => {
  fake = installFakeApi();
  useSettingsStore.setState({ settings: null, error: null, loading: false });
  // Store zustand sống xuyên test — không dọn thì test sau mở thẳng vào màn
  // xác nhận chương của test trước
  useImportStore.setState({
    preview: null,
    chapters: [],
    previews: {},
    loadingPreviews: [],
    issues: [],
    parsing: false,
    saving: false,
    error: null,
    history: [],
  });
  useLibraryStore.setState({ entries: [], opened: null, loading: false, error: null });
  useUpdateStore.setState({ status: null, error: null, dismissed: false });
});

/**
 * `load()` chạy trong useEffect và resolve sau khi render() trả về.
 * Bọc trong act bất đồng bộ để React kịp flush trước khi assert.
 */
const renderApp = async (): Promise<ReturnType<typeof render>> => {
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(<App />);
  });
  return result;
};

describe('App', () => {
  it('hiển thị titlebar', async () => {
    const { container } = await renderApp();
    const header = container.querySelector('header');
    expect(header).toHaveTextContent('LN Reader');
  });

  it('nạp settings lúc mở app', async () => {
    await renderApp();
    await waitFor(() => expect(fake.api.settings.getAll).toHaveBeenCalledTimes(1));
  });

  it('mở vào màn thư viện, không phải màn nhập sách', async () => {
    await renderApp();
    await waitFor(() => expect(screen.getByText('Thư viện')).toBeInTheDocument());
  });

  it('bấm "Nhập sách" chuyển sang màn nhập', async () => {
    const user = userEvent.setup();
    await renderApp();

    await waitFor(() => expect(screen.getByText('Thư viện')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Nhập sách đầu tiên' }));

    expect(screen.getByRole('button', { name: 'Chọn file' })).toBeInTheDocument();
  });

  it('bấm "Cài đặt" chuyển sang màn cài đặt, quay lại được', async () => {
    const user = userEvent.setup();
    await renderApp();

    await waitFor(() => expect(screen.getByText('Thư viện')).toBeInTheDocument());
    await user.click(screen.getByTestId('open-settings'));

    expect(await screen.findByTestId('settings-screen')).toBeInTheDocument();

    await user.click(screen.getByTestId('settings-back'));
    await waitFor(() => expect(screen.getByText('Thư viện')).toBeInTheDocument());
  });

  it('từ Cài đặt sang thẳng màn Dung lượng', async () => {
    // Đường tắt này là lý do màn Cài đặt không dựng lại các ô dung lượng —
    // đứt nó thì user vào Cài đặt rồi phải quay ra mới chỉnh được bitrate.
    const user = userEvent.setup();
    await renderApp();

    await waitFor(() => expect(screen.getByText('Thư viện')).toBeInTheDocument());
    await user.click(screen.getByTestId('open-settings'));
    await user.click(await screen.findByTestId('settings-open-storage'));

    expect(await screen.findByTestId('storage-back')).toBeInTheDocument();
  });

  it('mở sách chuyển sang màn chi tiết', async () => {
    const user = userEvent.setup();
    fake = installFakeApi({ library: [fakeLibraryEntry()] });
    await renderApp();

    await waitFor(() => expect(screen.getByText('Kiếm Vực Thần Đế')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Mở Kiếm Vực Thần Đế/ }));

    await waitFor(() => expect(screen.getAllByTestId('chapter-item').length).toBeGreaterThan(0));
  });

  it('quay lại được từ màn chi tiết về thư viện', async () => {
    const user = userEvent.setup();
    fake = installFakeApi({ library: [fakeLibraryEntry()] });
    await renderApp();

    await waitFor(() => expect(screen.getByText('Kiếm Vực Thần Đế')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Mở Kiếm Vực Thần Đế/ }));
    await waitFor(() => expect(screen.getAllByTestId('chapter-item').length).toBeGreaterThan(0));

    await user.click(screen.getByRole('button', { name: /← Thư viện/ }));

    await waitFor(() => expect(screen.getAllByTestId('book-card').length).toBe(1));
  });

  it('nút đổi giao diện vẫn nằm ở titlebar', async () => {
    fake = installFakeApi({ settings: { theme: 'dark' } });
    await renderApp();
    await waitFor(() => expect(screen.getByLabelText(/Giao diện: Tối/)).toBeInTheDocument());
  });

  it('hiển thị lỗi thay vì kẹt ở "Đang tải" khi IPC hỏng', async () => {
    fake.api.settings.getAll.mockRejectedValueOnce(new Error('No handler registered'));
    await renderApp();

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/Không kết nối được tiến trình chính/);
    });
    expect(screen.queryByText('Đang tải…')).not.toBeInTheDocument();
  });

  it('hiển thị lỗi khi main trả Result lỗi', async () => {
    fake.api.settings.getAll.mockResolvedValueOnce(err('DB_ERROR', 'Không mở được DB'));
    await renderApp();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Không mở được DB'));
  });

  it('cập nhật khi main đẩy event settings:changed', async () => {
    await renderApp();
    await waitFor(() =>
      expect(screen.getByLabelText(/Giao diện: Theo hệ thống/)).toBeInTheDocument(),
    );

    act(() => fake.emitSettingsChanged({ ...fake.getSettings(), theme: 'light' }));

    await waitFor(() => expect(screen.getByLabelText(/Giao diện: Sáng/)).toBeInTheDocument());
  });

  it('huỷ đăng ký event settings khi unmount', async () => {
    const { unmount } = await renderApp();
    await waitFor(() => expect(fake.settingsListenerCount()).toBe(1));

    unmount();
    expect(fake.settingsListenerCount()).toBe(0);
  });
});

describe('dải báo cập nhật (P5.5c)', () => {
  it('nạp trạng thái cập nhật lúc mở app', async () => {
    await renderApp();
    await waitFor(() => expect(fake.api.update.getStatus).toHaveBeenCalledTimes(1));
  });

  it('không có dải nào khi không có bản mới', async () => {
    await renderApp();
    await waitFor(() => expect(fake.api.update.getStatus).toHaveBeenCalled());

    expect(screen.queryByTestId('update-banner')).not.toBeInTheDocument();
  });

  it('hiện dải khi main đẩy event có bản mới', async () => {
    // Đây là đường quan trọng nhất của P5.5c: lượt kiểm tự động chạy ở main
    // (P5.5b) và kết quả tới renderer **chỉ** qua event. Đứt chỗ này thì user
    // không bao giờ biết có bản mới trừ khi tự vào Cài đặt bấm.
    await renderApp();
    await waitFor(() => expect(fake.updateListenerCount()).toBe(1));

    act(() =>
      fake.emitUpdateStatus({
        state: 'available',
        currentVersion: '0.1.0',
        availableVersion: '0.2.0',
      }),
    );

    await waitFor(() => expect(screen.getByTestId('update-banner')).toHaveTextContent('0.2.0'));
  });

  it('đóng dải thì nó biến mất mà không ghi gì xuống settings', async () => {
    const user = userEvent.setup();
    await renderApp();
    await waitFor(() => expect(fake.updateListenerCount()).toBe(1));

    act(() =>
      fake.emitUpdateStatus({
        state: 'available',
        currentVersion: '0.1.0',
        availableVersion: '0.2.0',
      }),
    );
    await screen.findByTestId('update-banner');

    await user.click(screen.getByTestId('update-banner-dismiss'));

    await waitFor(() => expect(screen.queryByTestId('update-banner')).not.toBeInTheDocument());
    // Đóng dải là "để tôi yên lúc này", không phải một thiết lập lâu dài.
    expect(fake.api.settings.update).not.toHaveBeenCalled();
  });

  it('bấm tải trên dải gọi tới main', async () => {
    const user = userEvent.setup();
    await renderApp();
    await waitFor(() => expect(fake.updateListenerCount()).toBe(1));

    act(() =>
      fake.emitUpdateStatus({
        state: 'available',
        currentVersion: '0.1.0',
        availableVersion: '0.2.0',
      }),
    );
    await screen.findByTestId('update-banner');

    await act(async () => {
      await user.click(screen.getByTestId('update-banner-action'));
    });

    expect(fake.api.update.download).toHaveBeenCalledTimes(1);
  });

  it('huỷ đăng ký event cập nhật khi unmount', async () => {
    // Cùng lý do với listener settings: giữ lại là rò rỉ, và event tới sau khi
    // component đã gỡ sẽ đổi state của một cây React không còn tồn tại.
    const { unmount } = await renderApp();
    await waitFor(() => expect(fake.updateListenerCount()).toBe(1));

    unmount();
    expect(fake.updateListenerCount()).toBe(0);
  });
});

describe('đường tắt từ thanh player tới màn Giọng đọc (P3.3)', () => {
  it('đóng sách và mở màn Giọng đọc', async () => {
    const user = userEvent.setup();
    // Chưa chọn giọng → thanh player hiện đường tắt
    fake = installFakeApi({ library: [fakeLibraryEntry()], settings: { voiceVi: '' } });
    useSettingsStore.setState({ settings: null, error: null, loading: false });
    await renderApp();

    await waitFor(() => expect(screen.getByText('Kiếm Vực Thần Đế')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Mở Kiếm Vực Thần Đế/ }));
    await waitFor(() => expect(screen.getAllByTestId('chapter-item').length).toBeGreaterThan(0));

    await act(async () => {
      // Tên chính xác — `/^Đọc/` trúng cả nút "Đọc <tên chương>" của từng chương
      await user.click(screen.getByRole('button', { name: 'Đọc' }));
    });
    await screen.findByTestId('player-bar');

    await act(async () => {
      await user.click(screen.getByTestId('player-open-voices'));
    });

    // Màn Giọng đọc CHỈ hiện khi không còn sách nào mở, nên đường tắt phải đóng
    // sách chứ không riêng đổi `screen` — thiếu bước đó thì bấm xong không thấy
    // gì đổi cả.
    await waitFor(() => expect(screen.queryByTestId('player-bar')).not.toBeInTheDocument());
    expect(useLibraryStore.getState().opened).toBeNull();
  });
});
