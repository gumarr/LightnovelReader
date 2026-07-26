import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { err } from '@ln/shared';
import { installFakeApi, type FakeApi } from '@/test/fake-api';
import { useImportStore } from '@/stores/import-store';
import { ImportScreen } from './ImportScreen';

/**
 * Test bước chọn file của luồng nhập sách.
 *
 * Trọng tâm: **luôn có đường ra**. Trước đây màn này không có nút nào để về thư
 * viện — vào rồi mà không chọn file thì user kẹt, phải đóng app.
 */

let fake: FakeApi;

beforeEach(() => {
  fake = installFakeApi();
  useImportStore.setState({ preview: null, parsing: false, error: null });
});

describe('nút về thư viện', () => {
  it('có nút quay lại ở bước chọn file', () => {
    render(<ImportScreen onSaved={vi.fn()} onBack={vi.fn()} />);

    expect(screen.getByTestId('import-back')).toBeInTheDocument();
  });

  it('bấm quay lại gọi onBack, KHÔNG chọn file', async () => {
    const onBack = vi.fn();
    render(<ImportScreen onSaved={vi.fn()} onBack={onBack} />);

    await userEvent.click(screen.getByTestId('import-back'));

    expect(onBack).toHaveBeenCalledTimes(1);
    expect(fake.api.import.pickFile).not.toHaveBeenCalled();
  });

  it('lỗi phân tích vẫn còn nút quay lại — không để user kẹt ở màn báo lỗi', async () => {
    // Đây là ca dễ kẹt nhất: chọn file hỏng, thấy lỗi, rồi không biết đi đâu
    fake.api.import.pickFile.mockResolvedValueOnce(
      err('PDF_NO_TEXT_LAYER', 'PDF này là ảnh scan, không có text.'),
    );
    render(<ImportScreen onSaved={vi.fn()} onBack={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Chọn file' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('ảnh scan');
    });
    expect(screen.getByTestId('import-back')).toBeInTheDocument();
  });
});

describe('chọn file', () => {
  it('bấm chọn file gọi dialog của main', async () => {
    render(<ImportScreen onSaved={vi.fn()} onBack={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Chọn file' }));

    expect(fake.api.import.pickFile).toHaveBeenCalled();
  });

  it('đang phân tích thì chặn bấm lần nữa', () => {
    useImportStore.setState({ parsing: true });
    render(<ImportScreen onSaved={vi.fn()} onBack={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Đang phân tích…' })).toBeDisabled();
  });

  it('có preview thì chuyển sang màn xác nhận chương', async () => {
    render(<ImportScreen onSaved={vi.fn()} onBack={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Chọn file' }));

    // Không bao giờ generate ngay sau import — phải qua màn xác nhận (CLAUDE.md)
    await waitFor(() => {
      expect(screen.getByText('Xác nhận cấu trúc chương')).toBeInTheDocument();
    });
  });
});
