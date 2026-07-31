import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeApi, type FakeApi } from '@/test/fake-api';
import { usePronunciationStore } from '@/stores/pronunciation-store';
import { PronunciationDialog } from './PronunciationDialog';

/**
 * Test hộp sửa cách đọc (P5.2, tầng 3 — plan.md mục 8.1).
 *
 * Trọng tâm là hành vi user thấy: điền sẵn mục đã có, mặc định lưu theo sách,
 * và nói rõ audio cũ không tự đổi.
 */

let fake: FakeApi;

const renderDialog = async (
  term = 'Tokyo',
  options: Parameters<typeof installFakeApi>[0] = {},
) => {
  fake = installFakeApi(options);
  usePronunciationStore.setState({
    entries: [],
    bookId: 'book-1',
    loading: false,
    error: null,
    dirty: false,
  });
  await act(async () => {
    await usePronunciationStore.getState().load('book-1');
  });

  const onClose = vi.fn();
  await act(async () => {
    render(<PronunciationDialog term={term} onClose={onClose} />);
  });
  return { onClose };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('hiển thị', () => {
  it('hiện từ user bấm vào', async () => {
    await renderDialog('Tokyo');
    expect(screen.getByTestId('pronunciation-dialog')).toHaveTextContent('Tokyo');
  });

  it('nói rõ audio cũ vẫn đọc theo cách cũ', async () => {
    // Đây là hiểu nhầm chắc chắn xảy ra nếu không nói: sửa xong mà đoạn đang
    // nghe vẫn đọc như cũ thì user tưởng app hỏng.
    await renderDialog();
    expect(screen.getByTestId('pronunciation-dialog')).toHaveTextContent(/vẫn giữ cách đọc cũ/);
  });

  it('nhắc dùng gạch nối thay vì dấu cách', async () => {
    await renderDialog();
    expect(screen.getByTestId('pronunciation-dialog')).toHaveTextContent(/gạch nối/);
  });

  it('điền sẵn cách đọc đã lưu cho từ đó', async () => {
    // Mở hộp cho một từ đã sửa rồi mà ô trống thì trông như mất dữ liệu.
    await renderDialog('Tokyo', {
      pronunciations: [
        { id: 'p1', bookId: 'book-1', term: 'tokyo', replacement: 'Tô-ki-ô', createdAt: 1 },
      ],
    });

    expect(screen.getByTestId('pronunciation-input')).toHaveValue('Tô-ki-ô');
    expect(screen.getByTestId('pronunciation-remove')).toBeInTheDocument();
  });

  it('từ chưa có mục thì ô trống và không có nút xoá', async () => {
    await renderDialog('Asuka');
    expect(screen.getByTestId('pronunciation-input')).toHaveValue('');
    expect(screen.queryByTestId('pronunciation-remove')).not.toBeInTheDocument();
  });

  it('mặc định lưu theo sách, không phải toàn cục', async () => {
    // Cách đọc một cái tên thường chỉ đúng trong bộ truyện đó.
    await renderDialog();
    expect(screen.getByTestId('pronunciation-global')).not.toBeChecked();
  });
});

describe('lưu', () => {
  it('nút Lưu bị chặn khi ô trống', async () => {
    await renderDialog();
    expect(screen.getByTestId('pronunciation-save')).toBeDisabled();
  });

  it('lưu kèm bookId của sách đang mở', async () => {
    const { onClose } = await renderDialog('Tokyo');

    await act(async () => {
      await userEvent.type(screen.getByTestId('pronunciation-input'), 'Tô-ki-ô');
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('pronunciation-save'));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(fake.api.pronunciations.save).toHaveBeenCalledWith({
      bookId: 'book-1',
      term: 'Tokyo',
      replacement: 'Tô-ki-ô',
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('tích "mọi sách" thì bỏ bookId', async () => {
    await renderDialog('Tokyo');

    await act(async () => {
      await userEvent.type(screen.getByTestId('pronunciation-input'), 'Tô-ki-ô');
      await userEvent.click(screen.getByTestId('pronunciation-global'));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('pronunciation-save'));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(fake.api.pronunciations.save).toHaveBeenCalledWith({
      term: 'Tokyo',
      replacement: 'Tô-ki-ô',
    });
  });

  it('lỗi từ main hiện ra và KHÔNG đóng hộp', async () => {
    // Đóng hộp khi lỗi là mất luôn thứ user vừa gõ.
    const { onClose } = await renderDialog('Tokyo');
    fake.api.pronunciations.save.mockResolvedValueOnce({
      ok: false,
      error: { code: 'INVALID_INPUT', message: 'Cách đọc không được chứa khoảng trắng' },
    });

    await act(async () => {
      await userEvent.type(screen.getByTestId('pronunciation-input'), 'Tô ki ô');
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('pronunciation-save'));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(await screen.findByTestId('pronunciation-error')).toHaveTextContent('khoảng trắng');
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('xoá', () => {
  it('xoá mục rồi đóng hộp', async () => {
    const { onClose } = await renderDialog('Tokyo', {
      pronunciations: [
        { id: 'p1', bookId: 'book-1', term: 'tokyo', replacement: 'Tô-ki-ô', createdAt: 1 },
      ],
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('pronunciation-remove'));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(fake.api.pronunciations.remove).toHaveBeenCalledWith('p1');
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

describe('đóng hộp', () => {
  it('Escape đóng', async () => {
    const { onClose } = await renderDialog();
    fireEvent.keyDown(screen.getByTestId('pronunciation-dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('nút Huỷ đóng', async () => {
    const { onClose } = await renderDialog();
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Huỷ' }));
    });
    expect(onClose).toHaveBeenCalled();
  });
});
