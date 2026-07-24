import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TitleBar } from './TitleBar';
import { installFakeApi, type FakeApi } from '@/test/fake-api';
import { useSettingsStore } from '@/stores/settings-store';

let fake: FakeApi;

beforeEach(() => {
  fake = installFakeApi();
  useSettingsStore.setState({ settings: null, error: null, loading: false });
});

describe('TitleBar', () => {
  it('hiển thị tiêu đề', () => {
    render(<TitleBar title="LN Reader" />);
    expect(screen.getByText('LN Reader')).toBeInTheDocument();
  });

  it('có đủ nút thu nhỏ, phóng to, đóng và đổi giao diện', () => {
    render(<TitleBar title="LN Reader" />);
    expect(screen.getByLabelText('Thu nhỏ')).toBeInTheDocument();
    expect(screen.getByLabelText('Phóng to')).toBeInTheDocument();
    expect(screen.getByLabelText('Đóng')).toBeInTheDocument();
    expect(screen.getByLabelText(/Giao diện/)).toBeInTheDocument();
  });

  it('vùng kéo cửa sổ có class drag-region', () => {
    const { container } = render(<TitleBar title="LN Reader" />);
    expect(container.querySelector('.drag-region')).not.toBeNull();
  });

  it('các nút mang class no-drag để bấm được trên vùng kéo', () => {
    const { container } = render(<TitleBar title="LN Reader" />);
    const noDrag = container.querySelectorAll('.no-drag');
    // 1 cụm window controls + 1 nút theme
    expect(noDrag.length).toBeGreaterThanOrEqual(2);
  });
});

describe('nút điều khiển cửa sổ', () => {
  it('bấm Thu nhỏ gọi IPC minimize', async () => {
    render(<TitleBar title="LN Reader" />);
    await userEvent.click(screen.getByLabelText('Thu nhỏ'));
    expect(fake.api.window.minimize).toHaveBeenCalledTimes(1);
  });

  it('bấm Đóng gọi IPC close', async () => {
    render(<TitleBar title="LN Reader" />);
    await userEvent.click(screen.getByLabelText('Đóng'));
    expect(fake.api.window.close).toHaveBeenCalledTimes(1);
  });

  it('bấm Phóng to gọi IPC và đổi nhãn thành Khôi phục', async () => {
    render(<TitleBar title="LN Reader" />);
    await userEvent.click(screen.getByLabelText('Phóng to'));

    expect(fake.api.window.toggleMaximize).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByLabelText('Khôi phục')).toBeInTheDocument());
  });

  it('hiển thị Khôi phục ngay khi cửa sổ đang phóng to lúc mở', async () => {
    fake = installFakeApi({ windowState: { isMaximized: true } });
    render(<TitleBar title="LN Reader" />);
    await waitFor(() => expect(screen.getByLabelText('Khôi phục')).toBeInTheDocument());
  });

  it('cập nhật nhãn khi main đẩy event window:stateChanged', async () => {
    render(<TitleBar title="LN Reader" />);
    await waitFor(() => expect(fake.api.window.onStateChanged).toHaveBeenCalled());

    await userEvent.click(screen.getByLabelText('Phóng to'));
    await waitFor(() => expect(screen.getByLabelText('Khôi phục')).toBeInTheDocument());

    await userEvent.click(screen.getByLabelText('Khôi phục'));
    await waitFor(() => expect(screen.getByLabelText('Phóng to')).toBeInTheDocument());
  });

  it('huỷ đăng ký event khi unmount — không rò rỉ listener', async () => {
    const { unmount } = render(<TitleBar title="LN Reader" />);
    await waitFor(() => expect(fake.windowListenerCount()).toBe(1));

    unmount();
    expect(fake.windowListenerCount()).toBe(0);
  });
});
