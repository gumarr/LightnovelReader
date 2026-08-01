import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { UpdateStatus } from '@ln/shared';
import { UpdatePanel } from './UpdatePanel';

/**
 * Test ô cập nhật trong màn Cài đặt (P5.5c).
 *
 * Trọng tâm: **một nút cho mỗi trạng thái, và bấm đúng hàm**. Chỗ dễ sai nhất
 * của UI kiểu này là nút "Tải" vẫn gọi `onCheck` — trạng thái đổi mà dây không
 * đổi theo.
 */

const status = (overrides: Partial<UpdateStatus> = {}): UpdateStatus => ({
  state: 'idle',
  currentVersion: '0.1.0',
  ...overrides,
});

const renderPanel = (
  current: UpdateStatus | null,
  autoCheck = true,
): {
  onCheck: ReturnType<typeof vi.fn>;
  onDownload: ReturnType<typeof vi.fn>;
  onInstall: ReturnType<typeof vi.fn>;
  onAutoCheckChange: ReturnType<typeof vi.fn>;
} => {
  const handlers = {
    onCheck: vi.fn(),
    onDownload: vi.fn(),
    onInstall: vi.fn(),
    onAutoCheckChange: vi.fn(),
  };
  render(<UpdatePanel status={current} autoCheck={autoCheck} {...handlers} />);
  return handlers;
};

describe('nút hành động', () => {
  it('trạng thái `available` bấm ra `onDownload`, không phải `onCheck`', async () => {
    const h = renderPanel(status({ state: 'available', availableVersion: '0.2.0' }));

    await userEvent.click(screen.getByTestId('update-action'));

    expect(h.onDownload).toHaveBeenCalledTimes(1);
    expect(h.onCheck).not.toHaveBeenCalled();
    expect(h.onInstall).not.toHaveBeenCalled();
  });

  it('trạng thái `downloaded` bấm ra `onInstall`', async () => {
    const h = renderPanel(status({ state: 'downloaded', availableVersion: '0.2.0' }));

    await userEvent.click(screen.getByTestId('update-action'));

    expect(h.onInstall).toHaveBeenCalledTimes(1);
    expect(h.onDownload).not.toHaveBeenCalled();
  });

  it('trạng thái `idle` bấm ra `onCheck`', async () => {
    const h = renderPanel(status());

    await userEvent.click(screen.getByTestId('update-action'));

    expect(h.onCheck).toHaveBeenCalledTimes(1);
  });

  it('không có nút nào khi đang kiểm hoặc đang tải', () => {
    const { unmount } = render(
      <UpdatePanel
        status={status({ state: 'checking' })}
        autoCheck
        onCheck={vi.fn()}
        onDownload={vi.fn()}
        onInstall={vi.fn()}
        onAutoCheckChange={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('update-action')).not.toBeInTheDocument();
    unmount();

    renderPanel(status({ state: 'downloading', percent: 40 }));
    expect(screen.queryByTestId('update-action')).not.toBeInTheDocument();
  });

  it('bản portable / bản dev không có nút nào bấm được', () => {
    // Có nút mà bấm không ra kết quả khác là tệ hơn không có nút.
    renderPanel(status({ state: 'unsupported', message: 'Bản portable không tự cập nhật được.' }));

    expect(screen.queryByTestId('update-action')).not.toBeInTheDocument();
    expect(screen.getByTestId('update-detail')).toHaveTextContent('portable');
  });
});

describe('tiến độ tải', () => {
  it('thanh tiến độ có bề ngang đúng phần trăm', () => {
    renderPanel(
      status({
        state: 'downloading',
        percent: 42,
        downloadedBytes: 63_000_000,
        totalBytes: 150_000_000,
      }),
    );

    expect(screen.getByTestId('update-progress-bar').style.width).toBe('42%');
  });

  it('chỉ dựng thanh khi đang tải', () => {
    // Thanh nằm sẵn ở 0% mọi lúc sẽ bị đọc thành "đang tải mà đứng im".
    renderPanel(status({ state: 'available', availableVersion: '0.2.0' }));

    expect(screen.queryByTestId('update-progress-bar')).not.toBeInTheDocument();
  });
});

describe('tự kiểm tra bản mới', () => {
  it('ô tick phản ánh đúng settings đang lưu', () => {
    renderPanel(status(), false);
    expect(screen.getByTestId('update-auto-check')).not.toBeChecked();
  });

  it('bỏ tick thì báo lên để ghi xuống settings', async () => {
    // Đây là đường biến `autoCheckUpdates` từ "setting chết" (PROGRESS 4.71)
    // thành setting thật — cờ có từ P5.5b mà tới đây mới có chỗ bấm.
    const h = renderPanel(status(), true);

    await userEvent.click(screen.getByTestId('update-auto-check'));

    expect(h.onAutoCheckChange).toHaveBeenCalledWith(false);
  });

  it('nói rõ chỉ kiểm chứ không tự tải — app này bán mình là đọc offline', () => {
    renderPanel(status());
    expect(screen.getByTestId('settings-update')).toHaveTextContent('Tải bản cài vẫn do bạn bấm');
  });
});

describe('chưa nạp xong', () => {
  it('vẫn dựng khung và ô tick, không vỡ', () => {
    renderPanel(null);

    expect(screen.getByTestId('settings-update')).toHaveAttribute('data-update-state', 'loading');
    expect(screen.getByTestId('update-auto-check')).toBeInTheDocument();
    expect(screen.queryByTestId('update-action')).not.toBeInTheDocument();
  });
});
