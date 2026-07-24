import { beforeEach, describe, expect, it } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeToggle } from './ThemeToggle';
import { installFakeApi, type FakeApi } from '@/test/fake-api';
import { emitPrefersDarkChange, setPrefersDark } from '@/test/setup';
import { useSettingsStore } from '@/stores/settings-store';

let fake: FakeApi;

const renderToggle = async (): Promise<void> => {
  render(<ThemeToggle />);
  // load() cập nhật store ngoài event handler của React → bọc act()
  await act(async () => {
    await useSettingsStore.getState().load();
  });
};

beforeEach(() => {
  fake = installFakeApi();
  useSettingsStore.setState({ settings: null, error: null, loading: false });
});

describe('ThemeToggle', () => {
  it('hiển thị nhãn tiếng Việt theo chế độ hiện tại', async () => {
    fake = installFakeApi({ settings: { theme: 'dark' } });
    await renderToggle();

    await waitFor(() => {
      expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'Giao diện: Tối');
    });
  });

  it('bấm xoay vòng Sáng → Tối', async () => {
    fake = installFakeApi({ settings: { theme: 'light' } });
    await renderToggle();
    await waitFor(() => expect(screen.getByRole('button')).toHaveAttribute('data-theme-mode', 'light'));

    await userEvent.click(screen.getByRole('button'));

    await waitFor(() => {
      expect(fake.api.settings.setTheme).toHaveBeenCalledWith('dark');
      expect(screen.getByRole('button')).toHaveAttribute('data-theme-mode', 'dark');
    });
  });

  it('xoay đủ vòng Sáng → Tối → Theo hệ thống → Sáng', async () => {
    fake = installFakeApi({ settings: { theme: 'light' } });
    await renderToggle();

    const button = screen.getByRole('button');
    await waitFor(() => expect(button).toHaveAttribute('data-theme-mode', 'light'));

    for (const expected of ['dark', 'system', 'light']) {
      await userEvent.click(button);
      await waitFor(() => expect(button).toHaveAttribute('data-theme-mode', expected));
    }
  });

  it('áp class dark lên <html> khi chọn Tối', async () => {
    fake = installFakeApi({ settings: { theme: 'dark' } });
    await renderToggle();

    await waitFor(() => {
      expect(document.documentElement).toHaveClass('dark');
      expect(document.documentElement.style.colorScheme).toBe('dark');
    });
  });

  it('gỡ class dark khi chọn Sáng', async () => {
    fake = installFakeApi({ settings: { theme: 'light' } });
    await renderToggle();

    await waitFor(() => {
      expect(document.documentElement).not.toHaveClass('dark');
      expect(document.documentElement.style.colorScheme).toBe('light');
    });
  });

  it('chế độ Theo hệ thống bám theo OS đang ở dark', async () => {
    setPrefersDark(true);
    fake = installFakeApi({ settings: { theme: 'system' } });
    await renderToggle();

    await waitFor(() => {
      expect(screen.getByRole('button')).toHaveAttribute('data-theme-resolved', 'dark');
      expect(document.documentElement).toHaveClass('dark');
    });
  });

  it('chế độ Theo hệ thống bám theo OS đang ở light', async () => {
    setPrefersDark(false);
    fake = installFakeApi({ settings: { theme: 'system' } });
    await renderToggle();

    await waitFor(() => {
      expect(screen.getByRole('button')).toHaveAttribute('data-theme-resolved', 'light');
      expect(document.documentElement).not.toHaveClass('dark');
    });
  });

  it('đổi thiết lập OS lúc đang chạy thì theme cập nhật theo', async () => {
    setPrefersDark(false);
    fake = installFakeApi({ settings: { theme: 'system' } });
    await renderToggle();
    await waitFor(() => expect(document.documentElement).not.toHaveClass('dark'));

    act(() => emitPrefersDarkChange(true));

    await waitFor(() => expect(document.documentElement).toHaveClass('dark'));
  });

  it('chế độ Sáng/Tối không đổi khi OS đổi', async () => {
    setPrefersDark(false);
    fake = installFakeApi({ settings: { theme: 'light' } });
    await renderToggle();
    await waitFor(() => expect(document.documentElement).not.toHaveClass('dark'));

    act(() => emitPrefersDarkChange(true));

    await waitFor(() =>
      expect(screen.getByRole('button')).toHaveAttribute('data-theme-resolved', 'light'),
    );
    expect(document.documentElement).not.toHaveClass('dark');
  });
});
