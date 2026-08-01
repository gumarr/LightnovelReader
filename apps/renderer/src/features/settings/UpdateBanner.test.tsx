import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { UpdateStatus } from '@ln/shared';
import { UpdateBanner } from './UpdateBanner';

/**
 * Test dải báo bản mới (P5.5c).
 *
 * Trọng tâm: **dải chỉ hiện đúng hai trạng thái**. Một dải hiện quá tay sẽ bị
 * user học cách bỏ qua, và khi đó nó vô dụng cả ở lần đáng nghe.
 */

const status = (overrides: Partial<UpdateStatus> = {}): UpdateStatus => ({
  state: 'idle',
  currentVersion: '0.1.0',
  ...overrides,
});

const renderBanner = (
  current: UpdateStatus | null,
  dismissed = false,
): {
  onDownload: ReturnType<typeof vi.fn>;
  onInstall: ReturnType<typeof vi.fn>;
  onDismiss: ReturnType<typeof vi.fn>;
} => {
  const handlers = { onDownload: vi.fn(), onInstall: vi.fn(), onDismiss: vi.fn() };
  render(<UpdateBanner status={current} dismissed={dismissed} {...handlers} />);
  return handlers;
};

describe('khi nào hiện', () => {
  it('hiện khi có bản mới', () => {
    renderBanner(status({ state: 'available', availableVersion: '0.2.0' }));

    expect(screen.getByTestId('update-banner')).toHaveTextContent('0.2.0');
  });

  it('hiện khi đã tải xong, mời cài', () => {
    renderBanner(status({ state: 'downloaded', availableVersion: '0.2.0' }));

    expect(screen.getByTestId('update-banner-action')).toHaveTextContent('cài');
  });

  it('KHÔNG hiện khi lỗi mạng', () => {
    // App đọc sách offline: dải đỏ mỗi lần mở máy không có mạng là dải user học
    // cách bỏ qua. Lỗi vẫn đọc được trong màn Cài đặt.
    renderBanner(status({ state: 'error', message: 'ENOTFOUND' }));

    expect(screen.queryByTestId('update-banner')).not.toBeInTheDocument();
  });

  it('không hiện ở các trạng thái không có việc gì cho user', () => {
    for (const state of ['idle', 'checking', 'downloading', 'unsupported'] as const) {
      const { unmount } = render(
        <UpdateBanner
          status={status({ state })}
          dismissed={false}
          onDownload={vi.fn()}
          onInstall={vi.fn()}
          onDismiss={vi.fn()}
        />,
      );
      expect(screen.queryByTestId('update-banner')).not.toBeInTheDocument();
      unmount();
    }
  });

  it('không hiện khi chưa nạp trạng thái', () => {
    renderBanner(null);
    expect(screen.queryByTestId('update-banner')).not.toBeInTheDocument();
  });

  it('không hiện sau khi user đóng', () => {
    renderBanner(status({ state: 'available', availableVersion: '0.2.0' }), true);
    expect(screen.queryByTestId('update-banner')).not.toBeInTheDocument();
  });
});

describe('hành động', () => {
  it('`available` bấm ra tải, không phải cài', async () => {
    // Bấm nhầm sang cài ở đây là đóng app của user khi chưa có gì để cài.
    const h = renderBanner(status({ state: 'available', availableVersion: '0.2.0' }));

    await userEvent.click(screen.getByTestId('update-banner-action'));

    expect(h.onDownload).toHaveBeenCalledTimes(1);
    expect(h.onInstall).not.toHaveBeenCalled();
  });

  it('`downloaded` bấm ra cài', async () => {
    const h = renderBanner(status({ state: 'downloaded', availableVersion: '0.2.0' }));

    await userEvent.click(screen.getByTestId('update-banner-action'));

    expect(h.onInstall).toHaveBeenCalledTimes(1);
    expect(h.onDownload).not.toHaveBeenCalled();
  });

  it('nút đóng luôn có mặt — dải không tắt được là dải phiền', async () => {
    const h = renderBanner(status({ state: 'available', availableVersion: '0.2.0' }));

    await userEvent.click(screen.getByTestId('update-banner-dismiss'));

    expect(h.onDismiss).toHaveBeenCalledTimes(1);
  });

  it('nút đóng có nhãn cho trình đọc màn hình', () => {
    // Nội dung nút là ký tự ✕ — không có `aria-label` thì nó vô nghĩa khi đọc.
    renderBanner(status({ state: 'available' }));

    expect(screen.getByTestId('update-banner-dismiss')).toHaveAccessibleName();
  });
});
