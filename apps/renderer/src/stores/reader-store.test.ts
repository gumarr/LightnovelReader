import { beforeEach, describe, expect, it, vi } from 'vitest';
import { err } from '@ln/shared';
import { installFakeApi, fakeSegments, type FakeApi } from '@/test/fake-api';
import { useReaderStore, activeSegmentOf } from './reader-store';

let fake: FakeApi;

const reset = (): void => {
  useReaderStore.setState({
    pdfBytes: null,
    html: null,
    segments: [],
    chapterId: null,
    activeSegmentId: null,
    loading: false,
    error: null,
  });
};

beforeEach(() => {
  vi.restoreAllMocks();
  reset();
  fake = installFakeApi();
});

describe('loadBook', () => {
  it('sách PDF lấy bytes', async () => {
    await useReaderStore.getState().loadBook('book-1', 'pdf');

    expect(fake.api.reader.getBookFile).toHaveBeenCalledWith('book-1');
    expect(useReaderStore.getState().pdfBytes).not.toBeNull();
    expect(useReaderStore.getState().html).toBeNull();
  });

  it('sách DOCX lấy HTML', async () => {
    await useReaderStore.getState().loadBook('book-1', 'docx');

    expect(fake.api.reader.getBookHtml).toHaveBeenCalledWith('book-1');
    expect(useReaderStore.getState().html).not.toBeNull();
    expect(useReaderStore.getState().pdfBytes).toBeNull();
  });

  it('không gọi nhầm kênh cho từng định dạng', async () => {
    await useReaderStore.getState().loadBook('book-1', 'pdf');
    expect(fake.api.reader.getBookHtml).not.toHaveBeenCalled();
  });

  it('EPUB báo chưa hỗ trợ thay vì gọi IPC', async () => {
    await useReaderStore.getState().loadBook('book-1', 'epub');

    expect(useReaderStore.getState().error).toMatch(/EPUB/);
    expect(fake.api.reader.getBookFile).not.toHaveBeenCalled();
  });

  it('lỗi từ main hiện ra cho user', async () => {
    fake.api.reader.getBookFile.mockResolvedValueOnce(err('NOT_FOUND', 'Không tìm thấy sách này.'));
    await useReaderStore.getState().loadBook('book-1', 'pdf');

    expect(useReaderStore.getState().error).toBe('Không tìm thấy sách này.');
    expect(useReaderStore.getState().loading).toBe(false);
  });

  it('IPC hỏng vẫn tắt trạng thái loading', async () => {
    fake.api.reader.getBookFile.mockRejectedValueOnce(new Error('kênh đứt'));
    await useReaderStore.getState().loadBook('book-1', 'pdf');

    expect(useReaderStore.getState().loading).toBe(false);
    expect(useReaderStore.getState().error).toMatch(/kênh đứt/);
  });
});

describe('loadChapter', () => {
  it('nạp segment của chương', async () => {
    await useReaderStore.getState().loadChapter('ch-1');

    expect(useReaderStore.getState().segments).toHaveLength(3);
    expect(useReaderStore.getState().chapterId).toBe('ch-1');
  });

  it('bấm lại đúng chương đang mở thì không gọi IPC lần nữa', async () => {
    await useReaderStore.getState().loadChapter('ch-1');
    await useReaderStore.getState().loadChapter('ch-1');

    // 1353 segment qua IPC — không nạp lại thứ đã có
    expect(fake.api.reader.listSegments).toHaveBeenCalledTimes(1);
  });

  it('đổi chương thì bỏ segment đang chọn', async () => {
    await useReaderStore.getState().loadChapter('ch-1');
    useReaderStore.getState().setActiveSegment('ch-1-s2');

    await useReaderStore.getState().loadChapter('ch-2');

    // Segment cũ thuộc chương khác — giữ lại thì viewer cuộn tới chỗ vô nghĩa
    expect(useReaderStore.getState().activeSegmentId).toBeNull();
  });

  it('lỗi nạp chương hiện ra cho user', async () => {
    fake.api.reader.listSegments.mockResolvedValueOnce(err('NOT_FOUND', 'Không tìm thấy chương.'));
    await useReaderStore.getState().loadChapter('ch-lạ');

    expect(useReaderStore.getState().error).toBe('Không tìm thấy chương.');
  });
});

describe('activeSegmentOf', () => {
  it('tra được segment đang chọn', async () => {
    await useReaderStore.getState().loadChapter('ch-1');
    useReaderStore.getState().setActiveSegment('ch-1-s2');

    expect(activeSegmentOf(useReaderStore.getState())?.id).toBe('ch-1-s2');
  });

  it('chưa chọn thì undefined', () => {
    expect(activeSegmentOf(useReaderStore.getState())).toBeUndefined();
  });

  it('id không có trong danh sách thì undefined', async () => {
    await useReaderStore.getState().loadChapter('ch-1');
    useReaderStore.getState().setActiveSegment('không-có');

    expect(activeSegmentOf(useReaderStore.getState())).toBeUndefined();
  });
});

describe('reset', () => {
  it('bỏ hết nội dung khi rời trình đọc', async () => {
    fake = installFakeApi({ segments: fakeSegments('ch-1') });
    await useReaderStore.getState().loadBook('book-1', 'pdf');
    await useReaderStore.getState().loadChapter('ch-1');
    useReaderStore.getState().setActiveSegment('ch-1-s1');

    useReaderStore.getState().reset();

    // Bytes PDF có thể vài chục MB — phải nhả khi đóng sách
    const state = useReaderStore.getState();
    expect(state.pdfBytes).toBeNull();
    expect(state.html).toBeNull();
    expect(state.segments).toEqual([]);
    expect(state.chapterId).toBeNull();
    expect(state.activeSegmentId).toBeNull();
  });

  it('reset rồi nạp lại chương cũ vẫn gọi IPC', async () => {
    await useReaderStore.getState().loadChapter('ch-1');
    useReaderStore.getState().reset();
    await useReaderStore.getState().loadChapter('ch-1');

    expect(fake.api.reader.listSegments).toHaveBeenCalledTimes(2);
  });
});
