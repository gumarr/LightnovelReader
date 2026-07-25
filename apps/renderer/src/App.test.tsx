import { beforeEach, describe, expect, it } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { err } from '@ln/shared';
import { App } from './App';
import { installFakeApi, type FakeApi } from '@/test/fake-api';
import { useSettingsStore } from '@/stores/settings-store';
import { useImportStore } from '@/stores/import-store';

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
    error: null,
    history: [],
  });
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

  it('hiện màn nhập sách sau khi nạp settings xong', async () => {
    await renderApp();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Chọn file' })).toBeInTheDocument(),
    );
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
