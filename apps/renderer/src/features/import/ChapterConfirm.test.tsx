import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ImportPreview } from '@ln/shared';
import { installFakeApi, defaultImportPreview, type FakeApi } from '@/test/fake-api';
import { useImportStore } from '@/stores/import-store';
import { ChapterConfirm } from './ChapterConfirm';

let fake: FakeApi;

const resetStore = (): void => {
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
};

beforeEach(() => {
  vi.restoreAllMocks();
  fake = installFakeApi();
  resetStore();
});

/** Nạp preview vào store rồi render màn xác nhận */
const setup = async (
  preview: ImportPreview = defaultImportPreview,
): Promise<{ onConfirm: ReturnType<typeof vi.fn>; onCancel: ReturnType<typeof vi.fn> }> => {
  fake.api.import.pickFile.mockResolvedValueOnce({ ok: true, data: preview });
  await act(async () => {
    await useImportStore.getState().pickFile();
  });

  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(<ChapterConfirm preview={preview} onConfirm={onConfirm} onCancel={onCancel} />);
  return { onConfirm, onCancel };
};

const rows = (): HTMLElement[] => screen.getAllByTestId('chapter-row');

const rowFor = (chapterId: string): HTMLElement => {
  const row = rows().find((r) => r.dataset['chapterId'] === chapterId);
  if (row === undefined) throw new Error(`Không tìm thấy hàng cho ${chapterId}`);
  return row;
};

describe('hiển thị', () => {
  it('liệt kê đủ chương từ preview', async () => {
    await setup();
    expect(rows()).toHaveLength(3);
    expect(screen.getByDisplayValue('Chương 1: Mở đầu')).toBeInTheDocument();
  });

  it('hiện khoảng trang và số trang của từng chương', async () => {
    await setup();
    const row = rowFor('c1');
    expect(within(row).getByText('Trang 1–10')).toBeInTheDocument();
    expect(within(row).getByText('10 trang')).toBeInTheDocument();
  });

  it('DOCX hiện "Đoạn" chứ không phải "Trang"', async () => {
    await setup({ ...defaultImportPreview, hasRealPages: false, format: 'docx' });

    const row = rowFor('c1');
    expect(within(row).getByText('Đoạn 1–10')).toBeInTheDocument();
    expect(within(row).queryByText('Trang 1–10')).not.toBeInTheDocument();
  });

  it('chương điểm thấp được gắn nhãn "Nên kiểm lại"', async () => {
    await setup();
    // c3 có confidence 1.5 — vừa qua ngưỡng 1.4, đáng để user soi
    expect(within(rowFor('c3')).getByText('Nên kiểm lại')).toBeInTheDocument();
    expect(within(rowFor('c1')).getByText('Chắc chắn')).toBeInTheDocument();
  });

  it('sách không outline KHÔNG bị gắn cảnh báo ở mọi chương', async () => {
    // Lỗi thật thấy trên bản đóng gói: file EN cho cả 5/5 chương đều đỏ, mà
    // cảnh báo ở mọi dòng thì user chỉ học cách phớt lờ.
    await setup({
      ...defaultImportPreview,
      hasOutline: false,
      chapters: [
        { id: 'c1', title: 'Prologue', pageStart: 1, pageEnd: 4, confidence: 1.86, excluded: false },
        { id: 'c2', title: 'Chapter 1', pageStart: 5, pageEnd: 52, confidence: 1.86, excluded: false },
        { id: 'c3', title: 'Chapter 2', pageStart: 53, pageEnd: 182, confidence: 1.41, excluded: false },
      ],
    });

    const warned = rows().filter((r) => within(r).queryByText('Nên kiểm lại') !== null);
    expect(warned.length).toBeLessThan(rows().length);
  });

  it('nút xác nhận hiện số chương được giữ', async () => {
    await setup();
    expect(screen.getByRole('button', { name: 'Xác nhận 3 chương' })).toBeEnabled();
  });

  it('chương đầu tiên không có nút gộp lên trên', async () => {
    await setup();
    expect(within(rowFor('c1')).queryByRole('button', { name: 'Gộp lên trên' })).toBeNull();
    expect(within(rowFor('c2')).getByRole('button', { name: 'Gộp lên trên' })).toBeInTheDocument();
  });
});

describe('loại trừ chương', () => {
  it('bỏ chọn thì không tính vào số chương xác nhận', async () => {
    const user = userEvent.setup();
    await setup();

    await user.click(within(rowFor('c2')).getByRole('checkbox'));

    expect(screen.getByRole('button', { name: 'Xác nhận 2 chương' })).toBeInTheDocument();
    expect(rowFor('c2').dataset['excluded']).toBe('true');
  });

  it('chương bị loại vẫn nằm trong danh sách để user đổi ý', async () => {
    const user = userEvent.setup();
    await setup();

    await user.click(within(rowFor('c2')).getByRole('checkbox'));
    expect(rows()).toHaveLength(3);
  });

  it('loại hết mọi chương thì chặn xác nhận', async () => {
    const user = userEvent.setup();
    await setup();

    for (const id of ['c1', 'c2', 'c3']) {
      await user.click(within(rowFor(id)).getByRole('checkbox'));
    }

    expect(screen.getByRole('button', { name: /Xác nhận/ })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('ít nhất một chương');
  });

  it('chỉ truyền chương được giữ ra ngoài khi xác nhận', async () => {
    const user = userEvent.setup();
    const { onConfirm } = await setup();

    await user.click(within(rowFor('c2')).getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Xác nhận 2 chương' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const passed = onConfirm.mock.calls[0]![0] as { id: string }[];
    expect(passed.map((c) => c.id)).toEqual(['c1', 'c3']);
  });
});

describe('đổi tên', () => {
  it('lưu tên mới khi rời khỏi ô', async () => {
    const user = userEvent.setup();
    await setup();

    const input = within(rowFor('c1')).getByLabelText('Tên chương');
    await user.clear(input);
    await user.type(input, 'Mở màn');
    await user.tab();

    expect(useImportStore.getState().chapters[0]?.title).toBe('Mở màn');
  });

  it('gõ chưa rời ô thì chưa ghi vào history — tránh mỗi ký tự một bước', async () => {
    const user = userEvent.setup();
    await setup();

    const input = within(rowFor('c1')).getByLabelText('Tên chương');
    await user.type(input, 'abc');

    expect(useImportStore.getState().history).toHaveLength(0);
  });

  it('xoá sạch tên thì chặn xác nhận', async () => {
    const user = userEvent.setup();
    await setup();

    const input = within(rowFor('c1')).getByLabelText('Tên chương');
    await user.clear(input);
    await user.tab();

    expect(screen.getByRole('button', { name: /Xác nhận/ })).toBeDisabled();
    expect(within(rowFor('c1')).getByRole('alert')).toHaveTextContent('chưa có tên');
  });
});

describe('gộp và tách', () => {
  it('gộp dồn hai chương thành một', async () => {
    const user = userEvent.setup();
    await setup();

    await user.click(within(rowFor('c2')).getByRole('button', { name: 'Gộp lên trên' }));

    expect(rows()).toHaveLength(2);
    expect(within(rowFor('c1')).getByText('Trang 1–20')).toBeInTheDocument();
  });

  it('tách sinh chương mới chưa có tên và chặn xác nhận', async () => {
    const user = userEvent.setup();
    await setup();

    await user.click(within(rowFor('c1')).getByRole('button', { name: 'Xem nội dung' }));
    const splitInput = within(rowFor('c1')).getByLabelText('Tách từ trang');
    await user.clear(splitInput);
    await user.type(splitInput, '5');
    await user.click(within(rowFor('c1')).getByRole('button', { name: 'Tách' }));

    expect(rows()).toHaveLength(4);
    expect(screen.getByRole('button', { name: /Xác nhận/ })).toBeDisabled();
  });

  it('chương một trang không cho tách', async () => {
    const user = userEvent.setup();
    await setup({
      ...defaultImportPreview,
      chapters: [
        { id: 'c1', title: 'Chỉ một trang', pageStart: 1, pageEnd: 1, confidence: 3, excluded: false },
      ],
    });

    await user.click(screen.getByRole('button', { name: 'Xem nội dung' }));
    expect(screen.getByText(/không tách được/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tách' })).toBeNull();
  });
});

describe('xoá chương', () => {
  it('xoá bỏ hàng và cảnh báo khoảng trống nhưng vẫn xác nhận được', async () => {
    const user = userEvent.setup();
    await setup();

    await user.click(within(rowFor('c2')).getByRole('button', { name: 'Xoá' }));

    expect(rows()).toHaveLength(2);
    expect(screen.getByText(/Trang 11–20 không thuộc chương nào/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Xác nhận 2 chương' })).toBeEnabled();
  });
});

describe('preview nội dung', () => {
  it('chỉ tải khi user mở chương ra xem', async () => {
    const user = userEvent.setup();
    await setup();

    expect(fake.api.import.getChapterPreview).not.toHaveBeenCalled();

    await user.click(within(rowFor('c2')).getByRole('button', { name: 'Xem nội dung' }));

    await waitFor(() =>
      expect(within(rowFor('c2')).getByText('Nội dung trang 11–20.')).toBeInTheDocument(),
    );
  });

  it('thu gọn rồi mở lại không gọi IPC lần nữa', async () => {
    const user = userEvent.setup();
    await setup();

    const row = rowFor('c2');
    await user.click(within(row).getByRole('button', { name: 'Xem nội dung' }));
    await waitFor(() => expect(fake.api.import.getChapterPreview).toHaveBeenCalledTimes(1));

    await user.click(within(rowFor('c2')).getByRole('button', { name: 'Thu gọn' }));
    await user.click(within(rowFor('c2')).getByRole('button', { name: 'Xem nội dung' }));

    expect(fake.api.import.getChapterPreview).toHaveBeenCalledTimes(1);
  });

  it('vùng trang không có chữ báo rõ cho user', async () => {
    const user = userEvent.setup();
    fake.api.import.getChapterPreview.mockResolvedValue({
      ok: true,
      data: { chapterId: 'c1', text: '' },
    });
    await setup();

    await user.click(within(rowFor('c1')).getByRole('button', { name: 'Xem nội dung' }));

    await waitFor(() =>
      expect(screen.getByText(/không có chữ nào đọc được/)).toBeInTheDocument(),
    );
  });
});

describe('hoàn tác', () => {
  it('vô hiệu khi chưa có thao tác nào', async () => {
    await setup();
    expect(screen.getByRole('button', { name: 'Hoàn tác' })).toBeDisabled();
  });

  it('khôi phục chương vừa xoá', async () => {
    const user = userEvent.setup();
    await setup();

    await user.click(within(rowFor('c2')).getByRole('button', { name: 'Xoá' }));
    expect(rows()).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: 'Hoàn tác' }));
    expect(rows()).toHaveLength(3);
  });

  it('ô tên cập nhật theo khi hoàn tác đổi tên', async () => {
    const user = userEvent.setup();
    await setup();

    const input = within(rowFor('c1')).getByLabelText('Tên chương');
    await user.clear(input);
    await user.type(input, 'Tên mới');
    await user.tab();
    expect(screen.getByDisplayValue('Tên mới')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Hoàn tác' }));
    expect(screen.getByDisplayValue('Chương 1: Mở đầu')).toBeInTheDocument();
  });
});

describe('huỷ', () => {
  it('gọi onCancel', async () => {
    const user = userEvent.setup();
    const { onCancel } = await setup();

    await user.click(screen.getByRole('button', { name: 'Huỷ' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
