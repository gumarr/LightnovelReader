import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeApi, type FakeApi } from '@/test/fake-api';
import { usePronunciationStore } from './pronunciation-store';

/**
 * Store phiên âm (P5.2, tầng 3).
 *
 * Trọng tâm: nạp lại sau khi lưu (vì `save` có thể **ghi đè**), và cờ `dirty`
 * để UI nhắc rằng audio cũ chưa đổi theo.
 */

let fake: FakeApi;

const reset = (options: Parameters<typeof installFakeApi>[0] = {}): void => {
  fake = installFakeApi(options);
  usePronunciationStore.setState({
    entries: [],
    bookId: null,
    loading: false,
    error: null,
    dirty: false,
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  reset();
});

describe('load', () => {
  it('nạp danh sách và nhớ sách đang mở', async () => {
    reset({
      pronunciations: [
        { id: 'p1', bookId: 'book-1', term: 'tokyo', replacement: 'Tô-ki-ô', createdAt: 1 },
      ],
    });

    await usePronunciationStore.getState().load('book-1');
    const state = usePronunciationStore.getState();
    expect(state.entries).toHaveLength(1);
    expect(state.bookId).toBe('book-1');
  });

  it('lỗi IPC vào `error`, không ném', async () => {
    fake.api.pronunciations.list.mockResolvedValueOnce({
      ok: false,
      error: { code: 'DB_ERROR', message: 'Không đọc được' },
    });

    await usePronunciationStore.getState().load('book-1');
    expect(usePronunciationStore.getState().error).toContain('Không đọc được');
  });
});

describe('save', () => {
  it('nạp LẠI danh sách thay vì tự chèn', async () => {
    // `save` ghi đè khi trùng `term`; tự chèn vào mảng sẽ ra hai dòng cùng một
    // từ mà DB thật không bao giờ có.
    reset({
      pronunciations: [
        { id: 'p1', bookId: 'book-1', term: 'tokyo', replacement: 'Cũ', createdAt: 1 },
      ],
    });
    await usePronunciationStore.getState().load('book-1');

    await usePronunciationStore
      .getState()
      .save({ term: 'Tokyo', replacement: 'Tô-ki-ô', global: false });

    const { entries } = usePronunciationStore.getState();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.replacement).toBe('Tô-ki-ô');
  });

  it('đặt cờ dirty để UI nhắc audio cũ chưa đổi', async () => {
    await usePronunciationStore.getState().load('book-1');
    await usePronunciationStore
      .getState()
      .save({ term: 'tokyo', replacement: 'Tô-ki-ô', global: false });

    expect(usePronunciationStore.getState().dirty).toBe(true);
  });

  it('chưa mở sách mà lưu theo sách thì báo lỗi, không gửi request', async () => {
    const okSaved = await usePronunciationStore
      .getState()
      .save({ term: 'tokyo', replacement: 'Tô-ki-ô', global: false });

    expect(okSaved).toBe(false);
    expect(fake.api.pronunciations.save).not.toHaveBeenCalled();
    expect(usePronunciationStore.getState().error).toContain('Chưa mở sách');
  });

  it('lưu toàn cục được kể cả khi chưa mở sách', async () => {
    const okSaved = await usePronunciationStore
      .getState()
      .save({ term: 'tokyo', replacement: 'Tô-ki-ô', global: true });

    expect(okSaved).toBe(true);
    expect(fake.api.pronunciations.save).toHaveBeenCalledWith({
      term: 'tokyo',
      replacement: 'Tô-ki-ô',
    });
  });

  it('lỗi từ main trả false để hộp thoại không tự đóng', async () => {
    await usePronunciationStore.getState().load('book-1');
    fake.api.pronunciations.save.mockResolvedValueOnce({
      ok: false,
      error: { code: 'INVALID_INPUT', message: 'Sai định dạng' },
    });

    const okSaved = await usePronunciationStore
      .getState()
      .save({ term: 'tokyo', replacement: 'Tô ki ô', global: false });

    expect(okSaved).toBe(false);
    expect(usePronunciationStore.getState().error).toContain('Sai định dạng');
  });
});

describe('remove', () => {
  it('bỏ mục khỏi danh sách', async () => {
    reset({
      pronunciations: [
        { id: 'p1', bookId: 'book-1', term: 'tokyo', replacement: 'Tô-ki-ô', createdAt: 1 },
      ],
    });
    await usePronunciationStore.getState().load('book-1');

    await usePronunciationStore.getState().remove('p1');
    expect(usePronunciationStore.getState().entries).toHaveLength(0);
    expect(usePronunciationStore.getState().dirty).toBe(true);
  });
});
