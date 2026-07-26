import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GenerateEstimateInfo } from '@ln/shared';
import { GenerateEstimateDialog } from './GenerateEstimateDialog';

/**
 * Test hộp xác nhận trước khi generate.
 *
 * CLAUDE.md **bắt buộc** hiện ước lượng thời gian + dung lượng trước khi chạy
 * "generate cả sách" — test ở đây khoá đúng ràng buộc đó.
 */

const estimate = (overrides: Partial<GenerateEstimateInfo> = {}): GenerateEstimateInfo => ({
  segmentCount: 100,
  totalChars: 15_000,
  audioDurationMs: 1_000_000,
  audioBytes: 3_000_000,
  processingMs: 150_000,
  existingBytes: 0,
  ...overrides,
});

const setup = (overrides: Partial<GenerateEstimateInfo> = {}, storageWarnBytes = 5 * 1024 ** 3) => {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();

  render(
    <GenerateEstimateDialog
      title="Chương Một"
      estimate={estimate(overrides)}
      storageWarnBytes={storageWarnBytes}
      busy={false}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
  );

  return { onConfirm, onCancel };
};

describe('GenerateEstimateDialog', () => {
  it('hiện đủ bốn con số bắt buộc trước khi generate', () => {
    setup();

    // Số đoạn, thời lượng, dung lượng, thời gian xử lý
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText(/16:40/)).toBeInTheDocument();
    expect(screen.getByTestId('estimate-bytes')).toHaveTextContent('2.9 MB');
    expect(screen.getByText(/2:30/)).toBeInTheDocument();
  });

  it('nói rõ đây là ước lượng, không phải số đo thật', () => {
    setup();

    expect(screen.getByText(/ước lượng/i)).toBeInTheDocument();
  });

  it('bấm xác nhận thì gọi onConfirm', async () => {
    const { onConfirm } = setup();

    await userEvent.click(screen.getByRole('button', { name: 'Bắt đầu tạo' }));

    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('bấm huỷ thì gọi onCancel', async () => {
    const { onCancel } = setup();

    await userEvent.click(screen.getByRole('button', { name: 'Huỷ' }));

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('không có gì để tạo thì KHÔNG hiện nút bắt đầu', () => {
    setup({ segmentCount: 0, totalChars: 0, audioBytes: 0 });

    expect(screen.queryByRole('button', { name: 'Bắt đầu tạo' })).not.toBeInTheDocument();
    expect(screen.getByText(/đã có audio/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Đóng' })).toBeInTheDocument();
  });

  it('cảnh báo khi vượt ngưỡng dung lượng', () => {
    // Ngưỡng 1 MB, ước lượng thêm ~2.9 MB
    setup({}, 1024 ** 2);

    expect(screen.getByTestId('estimate-storage-warning')).toBeInTheDocument();
  });

  it('cảnh báo tính trên TỔNG, gồm cả phần đã có', () => {
    // Phần thêm 1 MB một mình không vượt ngưỡng 5 MB, nhưng cộng 4.5 MB đã có
    // thì vượt — đĩa không quan tâm phần nào mới, phần nào cũ.
    setup({ audioBytes: 1024 ** 2, existingBytes: Math.round(4.5 * 1024 ** 2) }, 5 * 1024 ** 2);

    expect(screen.getByTestId('estimate-storage-warning')).toBeInTheDocument();
  });

  it('dưới ngưỡng thì không cảnh báo', () => {
    setup({}, 5 * 1024 ** 3);

    expect(screen.queryByTestId('estimate-storage-warning')).not.toBeInTheDocument();
  });

  it('hiện phần audio đã có sẵn khi có', () => {
    setup({ existingBytes: 1024 ** 2 });

    expect(screen.getByText(/Đã có sẵn/)).toBeInTheDocument();
  });

  it('chưa generate gì thì không hiện dòng "đã có sẵn"', () => {
    setup({ existingBytes: 0 });

    expect(screen.queryByText(/Đã có sẵn/)).not.toBeInTheDocument();
  });

  it('là dialog thật để trình đọc màn hình hiểu', () => {
    setup();

    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
  });
});
