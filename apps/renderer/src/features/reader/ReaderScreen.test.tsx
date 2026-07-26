import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AppSettings, BookDetail, Chapter } from '@ln/shared';
import { JOB_PRIORITY_PREFETCH } from '@ln/shared';
import { installFakeApi, fakeBook, fakeSegments, type FakeApi } from '@/test/fake-api';
import { useReaderStore } from '@/stores/reader-store';
import { useQueueStore } from '@/stores/queue-store';
import { useSettingsStore } from '@/stores/settings-store';
import { ReaderScreen } from './ReaderScreen';

/**
 * pdfjs cần canvas thật — jsdom không có. Thay bằng tài liệu giả để phần ghép
 * nối (chọn chương, ghi tiến độ, bật/tắt panel) vẫn kiểm được.
 * Việc vẽ trang thật đã kiểm trên bản đóng gói, xem PROGRESS mục 4.
 */
vi.mock('./pdf-document', () => ({
  loadPdf: vi.fn(async () => ({
    doc: {
      numPages: 3,
      // Trả trang giả có `cleanup` — `PdfPage` luôn nhả trang sau khi vẽ
      getPage: vi.fn(async () => ({ cleanup: vi.fn(), getViewport: vi.fn(), render: vi.fn() })),
    },
    pageCount: 3,
    destroy: vi.fn(async () => {}),
  })),
  pageSizes: vi.fn(async () => [{ width: 600, height: 800 }]),
  fitWidthScale: vi.fn(() => 1),
  renderPage: vi.fn(() => ({ done: Promise.resolve(), cancel: vi.fn() })),
}));

let fake: FakeApi;

const chapter = (index: number): Chapter => ({
  id: `ch-${index + 1}`,
  bookId: 'book-1',
  index,
  title: `Chương ${index + 1}`,
  pageStart: index * 10 + 1,
  pageEnd: (index + 1) * 10,
  segmentCount: 3,
  audioBytes: 0,
  generateStatus: 'none',
});

const detail = (overrides: Partial<BookDetail> = {}): BookDetail => ({
  book: fakeBook(),
  chapters: [chapter(0), chapter(1), chapter(2)],
  ...overrides,
});

const setup = async (
  props: Partial<Parameters<typeof ReaderScreen>[0]> = {},
): Promise<{ onBack: ReturnType<typeof vi.fn> }> => {
  const onBack = vi.fn();

  await act(async () => {
    render(<ReaderScreen detail={detail()} onBack={onBack} {...props} />);
  });

  return { onBack };
};

/** Nạp settings để `voiceReady` đúng — mặc định đã chọn giọng VI */
const loadSettings = async (settings: Partial<AppSettings> = {}): Promise<void> => {
  fake = installFakeApi({ settings: { voiceVi: 'vi_VN-vais1000-medium', ...settings } });
  useSettingsStore.setState({ settings: null, error: null, loading: false });
  await useSettingsStore.getState().load();
};

beforeEach(async () => {
  vi.clearAllMocks();
  useReaderStore.setState({
    pdfBytes: null,
    html: null,
    segments: [],
    chapterId: null,
    activeSegmentId: null,
    loading: false,
    error: null,
  });
  useQueueStore.setState({ status: null, error: null, prefetched: [] });
  await loadSettings();
});

describe('nạp sách', () => {
  it('sách PDF lấy bytes qua IPC', async () => {
    await setup();
    await waitFor(() => expect(fake.api.reader.getBookFile).toHaveBeenCalledWith('book-1'));
  });

  it('sách DOCX lấy HTML thay vì bytes', async () => {
    await setup({ detail: detail({ book: fakeBook({ format: 'docx' }) }) });

    await waitFor(() => expect(fake.api.reader.getBookHtml).toHaveBeenCalledWith('book-1'));
    expect(fake.api.reader.getBookFile).not.toHaveBeenCalled();
  });

  it('mở chương đọc dở khi có', async () => {
    await setup({ detail: detail({ resumeChapterId: 'ch-2' }) });
    await waitFor(() => expect(fake.api.reader.listSegments).toHaveBeenCalledWith('ch-2'));
  });

  it('chưa đọc lần nào thì mở chương đầu', async () => {
    await setup();
    await waitFor(() => expect(fake.api.reader.listSegments).toHaveBeenCalledWith('ch-1'));
  });

  it('chương user bấm ở mục lục thắng chỗ đọc dở', async () => {
    await setup({ detail: detail({ resumeChapterId: 'ch-2' }), startChapterId: 'ch-3' });
    await waitFor(() => expect(fake.api.reader.listSegments).toHaveBeenCalledWith('ch-3'));
  });
});

describe('điều hướng', () => {
  it('đổi chương nạp segment mới', async () => {
    const user = userEvent.setup();
    await setup();
    await waitFor(() => expect(fake.api.reader.listSegments).toHaveBeenCalledWith('ch-1'));

    await user.selectOptions(screen.getByLabelText('Chọn chương'), 'ch-2');
    await waitFor(() => expect(fake.api.reader.listSegments).toHaveBeenCalledWith('ch-2'));
  });

  it('bấm quay lại gọi onBack', async () => {
    const user = userEvent.setup();
    const { onBack } = await setup();

    await user.click(screen.getByRole('button', { name: /Thư viện/ }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('ẩn/hiện được panel segment', async () => {
    const user = userEvent.setup();
    await setup();

    expect(screen.getByTestId('segment-panel')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ẩn đoạn' }));
    expect(screen.queryByTestId('segment-panel')).toBeNull();
  });
});

describe('ghi tiến độ đọc', () => {
  it('chọn segment thì ghi vị trí', async () => {
    const user = userEvent.setup();
    await setup();
    await waitFor(() => expect(screen.queryAllByTestId('segment-row').length).toBeGreaterThan(0));

    await user.click(screen.getAllByTestId('segment-row')[1]!);

    await waitFor(() =>
      expect(fake.api.library.setProgress).toHaveBeenCalledWith({
        bookId: 'book-1',
        segmentId: 'ch-1-s2',
      }),
    );
  });

  it('không ghi lại khi bấm đúng segment đang chọn', async () => {
    const user = userEvent.setup();
    await setup();
    await waitFor(() => expect(screen.queryAllByTestId('segment-row').length).toBeGreaterThan(0));

    const row = screen.getAllByTestId('segment-row')[0]!;
    await user.click(row);
    await user.click(row);

    await waitFor(() => expect(fake.api.library.setProgress).toHaveBeenCalledTimes(1));
  });

  it('chưa chọn segment thì chưa ghi gì', async () => {
    await setup();
    await waitFor(() => expect(fake.api.reader.listSegments).toHaveBeenCalled());

    // Mở sách không có nghĩa là đã đọc tới đâu
    expect(fake.api.library.setProgress).not.toHaveBeenCalled();
  });
});

describe('lỗi', () => {
  it('lỗi nạp sách hiện ra cho user', async () => {
    fake.api.reader.getBookFile.mockResolvedValueOnce({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Không tìm thấy file sách.' },
    });

    await setup();
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Không tìm thấy file sách.'),
    );
  });
});

describe('tạo audio trong trình đọc (P2.6)', () => {
  it('hiện nút tạo audio cho chương đang mở và cho cả sách', async () => {
    await setup();

    await waitFor(() => expect(screen.getByTestId('generate-chapter')).toBeInTheDocument());
    expect(screen.getByTestId('generate-book')).toBeInTheDocument();
  });

  it('chưa chọn giọng thì chặn nút và nói rõ lý do', async () => {
    await loadSettings({ voiceVi: '' });
    await setup();

    await waitFor(() => expect(screen.getByTestId('generate-no-voice')).toBeInTheDocument());
    expect(screen.getByTestId('generate-chapter')).toBeDisabled();
  });

  it('sách EN đọc voiceEn, không phải voiceVi', async () => {
    // Một `voiceId` dùng chung sẽ cho sách EN chạy bằng giọng Việt mà vẫn báo
    // "generate thành công" — xem PROGRESS 4.36.
    await loadSettings({ voiceVi: 'vi_VN-vais1000-medium', voiceEn: '' });
    await setup({ detail: detail({ book: fakeBook({ lang: 'en' }) }) });

    await waitFor(() => expect(screen.getByTestId('generate-no-voice')).toBeInTheDocument());
  });

  it('nạp trạng thái hàng đợi khi mở trình đọc', async () => {
    await setup();

    await waitFor(() => expect(fake.api.queue.getStatus).toHaveBeenCalled());
  });

  it('huỷ đăng ký cả hai listener hàng đợi khi rời trình đọc', async () => {
    const { unmount } = render(<ReaderScreen detail={detail()} onBack={vi.fn()} />);
    await waitFor(() => expect(fake.queueStatusListenerCount()).toBe(1));
    expect(fake.segmentUpdateListenerCount()).toBe(1);

    unmount();

    expect(fake.queueStatusListenerCount()).toBe(0);
    expect(fake.segmentUpdateListenerCount()).toBe(0);
  });

  it('segment vừa xong đổi trạng thái trong danh sách, không tải lại cả chương', async () => {
    await setup();
    await waitFor(() => expect(useReaderStore.getState().segments).toHaveLength(3));

    const before = fake.api.reader.listSegments.mock.calls.length;
    const target = useReaderStore.getState().segments[0]!;

    act(() => {
      fake.emitSegmentUpdated({ ...target, status: 'ready', alignStatus: 'estimated' });
    });

    await waitFor(() => {
      expect(useReaderStore.getState().segments[0]?.status).toBe('ready');
    });
    // Một chương có tới 1353 segment — tải lại cả danh sách mỗi lần xong một cái
    // là hàng nghìn lần gửi IPC vô ích.
    expect(fake.api.reader.listSegments.mock.calls.length).toBe(before);
  });

  it('segment của chương khác KHÔNG chen vào danh sách đang mở', async () => {
    await setup();
    await waitFor(() => expect(useReaderStore.getState().segments).toHaveLength(3));

    act(() => {
      fake.emitSegmentUpdated({
        ...fakeSegments('ch-khac', 1)[0]!,
        status: 'ready',
      });
    });

    expect(useReaderStore.getState().segments).toHaveLength(3);
  });
});

describe('prefetch chương kế (P2.6)', () => {
  it('chưa đọc tới 80% thì KHÔNG prefetch', async () => {
    await setup();
    await waitFor(() => expect(useReaderStore.getState().segments).toHaveLength(3));

    // Segment 1/3 = 33%
    act(() => {
      useReaderStore.getState().setActiveSegment('ch-1-s1');
    });

    expect(fake.api.queue.enqueueChapter).not.toHaveBeenCalled();
  });

  it('đọc tới segment cuối thì xếp trước chương kế với priority prefetch', async () => {
    await setup();
    await waitFor(() => expect(useReaderStore.getState().segments).toHaveLength(3));

    // Segment 3/3 = 100%
    act(() => {
      useReaderStore.getState().setActiveSegment('ch-1-s3');
    });

    await waitFor(() => {
      expect(fake.api.queue.enqueueChapter).toHaveBeenCalledWith({
        chapterId: 'ch-2',
        priority: JOB_PRIORITY_PREFETCH,
      });
    });
  });

  it('không prefetch khi chưa chọn giọng — mọi job sẽ hỏng như nhau', async () => {
    await loadSettings({ voiceVi: '' });
    await setup();
    await waitFor(() => expect(useReaderStore.getState().segments).toHaveLength(3));

    act(() => {
      useReaderStore.getState().setActiveSegment('ch-1-s3');
    });

    expect(fake.api.queue.enqueueChapter).not.toHaveBeenCalled();
  });

  it('chương cuối sách thì không có gì để prefetch', async () => {
    await setup({ startChapterId: 'ch-3' });
    await waitFor(() => expect(useReaderStore.getState().chapterId).toBe('ch-3'));

    act(() => {
      useReaderStore.getState().setActiveSegment('ch-3-s3');
    });

    expect(fake.api.queue.enqueueChapter).not.toHaveBeenCalled();
  });

  it('đọc qua lại quanh mốc 80% chỉ prefetch MỘT lần', async () => {
    await setup();
    await waitFor(() => expect(useReaderStore.getState().segments).toHaveLength(3));

    act(() => {
      useReaderStore.getState().setActiveSegment('ch-1-s3');
    });
    await waitFor(() => expect(fake.api.queue.enqueueChapter).toHaveBeenCalledTimes(1));

    // Cuộn lùi rồi tiến lại — mỗi lần đổi segment là một lượt effect
    act(() => {
      useReaderStore.getState().setActiveSegment('ch-1-s1');
    });
    act(() => {
      useReaderStore.getState().setActiveSegment('ch-1-s3');
    });

    expect(fake.api.queue.enqueueChapter).toHaveBeenCalledTimes(1);
  });
});
