import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AppSettings, BookDetail, Chapter, Segment } from '@ln/shared';
import { JOB_PRIORITY_PREFETCH, JOB_PRIORITY_URGENT } from '@ln/shared';
import { installFakeApi, fakeBook, fakeSegments, type FakeApi } from '@/test/fake-api';
import { useReaderStore } from '@/stores/reader-store';
import { useQueueStore } from '@/stores/queue-store';
import { useSettingsStore } from '@/stores/settings-store';
import { usePlayerStore } from '@/stores/player-store';
import { countOpenObjectUrls } from '@/test/setup';
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
  errorCount: 0,
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
  usePlayerStore.setState({
    state: 'idle',
    segmentId: null,
    timings: [],
    durationMs: 0,
    playbackRate: 1,
    skipped: [],
    error: null,
  });
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

describe('bố cục khung đoạn (P2.7b)', () => {
  /**
   * Lỗi thật: danh sách đoạn bị cắt mất nửa dưới ngay khi mở chương, nhưng ẩn
   * rồi hiện lại thì đủ.
   *
   * Nguyên nhân là ô cuộn `h-full` của `SegmentList` nằm trong flex column mà
   * không có `flex-1 min-h-0`, nên nó lấy chiều cao theo **nội dung** lúc đo lần
   * đầu — lúc đó segment chưa nạp xong. Bấm ẩn/hiện dựng lại component sau khi
   * layout đã xong nên trông như hết lỗi.
   *
   * jsdom không tính CSS thật nên không đo được chiều cao. Khoá lại **ràng buộc
   * cấu trúc** mà bản sửa dựa vào: ô cuộn phải nằm trong một khối co giãn được.
   */
  it('ô cuộn nằm trong khối flex-1 min-h-0 — không thì danh sách bị cắt', async () => {
    await setup();

    const scroll = await screen.findByTestId('segment-scroll');
    const wrapper = scroll.parentElement;

    expect(wrapper).not.toBeNull();
    expect(wrapper?.className).toContain('flex-1');
    // `min-h-0` để flex item được phép co dưới chiều cao nội dung; thiếu nó thì
    // nó đẩy tràn cả `aside` thay vì cuộn bên trong.
    expect(wrapper?.className).toContain('min-h-0');
  });

  it('khối bọc ô cuộn KHÔNG phải chính cái aside — header nút tạo audio đứng riêng', async () => {
    await setup();

    const scroll = await screen.findByTestId('segment-scroll');
    const panel = screen.getByTestId('segment-panel');

    // Nút tạo audio (`shrink-0`) và danh sách (co giãn) là hai khối chị em;
    // gộp lại thì header cũng bị co theo và nút biến dạng.
    expect(scroll.parentElement).not.toBe(panel);
    expect(panel.contains(scroll)).toBe(true);
  });

  it('ẩn rồi hiện lại vẫn giữ đúng cấu trúc', async () => {
    await setup();
    await screen.findByTestId('segment-scroll');

    await userEvent.click(screen.getByRole('button', { name: 'Ẩn đoạn' }));
    expect(screen.queryByTestId('segment-scroll')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Hiện đoạn' }));

    const scroll = await screen.findByTestId('segment-scroll');
    expect(scroll.parentElement?.className).toContain('min-h-0');
  });
});

describe('player nối vào trình đọc', () => {
  it('có thanh điều khiển player', async () => {
    await setup();
    expect(await screen.findByTestId('player-bar')).toBeInTheDocument();
  });

  it('bấm phát thì lấy audio qua IPC và cuộn viewer tới đoạn đang phát', async () => {
    fake = installFakeApi({
      settings: { voiceVi: 'vi_VN-vais1000-medium' },
      segments: fakeSegments('ch-1').map((s) => ({ ...s, status: 'ready' as const })),
    });
    useSettingsStore.setState({ settings: null, error: null, loading: false });
    await useSettingsStore.getState().load();

    await setup();
    await screen.findByTestId('segment-scroll');

    await act(async () => {
      await usePlayerStore.getState().toggle();
    });

    await waitFor(() => {
      expect(fake.api.reader.getSegmentAudio).toHaveBeenCalledWith('ch-1-s1');
    });
    // `setActiveSegment` là đường P1.6c đã dựng sẵn: viewer cuộn + tô
    expect(useReaderStore.getState().activeSegmentId).toBe('ch-1-s1');
  });

  it('xếp segment sắp phát lên ĐẦU hàng đợi', async () => {
    await setup();
    await screen.findByTestId('segment-scroll');

    await act(async () => {
      await usePlayerStore.getState().toggle();
    });

    await waitFor(() => {
      expect(fake.api.queue.enqueueSegments).toHaveBeenCalledWith(
        expect.objectContaining({ priority: JOB_PRIORITY_URGENT }),
      );
    });
  });

  it('hàng đợi báo segment xong thì player đang chờ phát ngay', async () => {
    await setup();
    await screen.findByTestId('segment-scroll');

    await act(async () => {
      await usePlayerStore.getState().toggle();
    });
    // Mọi segment mặc định `pending` → player đứng chờ
    await waitFor(() => expect(usePlayerStore.getState().state).toBe('waiting'));

    const segment = useReaderStore.getState().segments[0] as Segment;
    await act(async () => {
      fake.emitSegmentUpdated({ ...segment, status: 'ready', durationMs: 1000 });
      await Promise.resolve();
    });

    await waitFor(() => expect(usePlayerStore.getState().state).toBe('playing'));
  });

  it('file audio bị xoá dưới chân player thì BỎ QUA, không dừng nhạc', async () => {
    // Storage Manager vừa xoá: DB nói `ready` nhưng getSegmentAudio trả NOT_FOUND
    await loadSettings();
    fake = installFakeApi({
      settings: { voiceVi: 'vi_VN-vais1000-medium' },
      segments: fakeSegments('ch-1').map((s) => ({ ...s, status: 'ready' as const })),
      missingAudio: ['ch-1-s1'],
    });
    useSettingsStore.setState({ settings: null, error: null, loading: false });
    await useSettingsStore.getState().load();

    await setup();
    await screen.findByTestId('segment-scroll');

    await act(async () => {
      await usePlayerStore.getState().toggle();
    });

    await waitFor(() => {
      const state = usePlayerStore.getState();
      // Nhảy sang đoạn kế và VẪN đang phát — không dừng, không hộp lỗi
      expect(state.segmentId).toBe('ch-1-s2');
      expect(state.state).toBe('playing');
    });
    expect(usePlayerStore.getState().error).toBeNull();
    expect(screen.getByTestId('player-skipped')).toHaveTextContent('Đã bỏ qua 1 đoạn');
  });

  it('rời trình đọc thì nhả HẾT Blob URL — không rò 30 KB mỗi câu', async () => {
    fake = installFakeApi({
      settings: { voiceVi: 'vi_VN-vais1000-medium' },
      segments: fakeSegments('ch-1').map((s) => ({ ...s, status: 'ready' as const })),
    });
    useSettingsStore.setState({ settings: null, error: null, loading: false });
    await useSettingsStore.getState().load();

    const { unmount } = render(<ReaderScreen detail={detail()} onBack={vi.fn()} />);
    await screen.findByTestId('player-bar');
    await screen.findByTestId('segment-scroll');

    await act(async () => {
      await usePlayerStore.getState().toggle();
    });
    await waitFor(() => expect(usePlayerStore.getState().state).toBe('playing'));
    // Có ít nhất một url đang mở thì phép kiểm dưới mới có nghĩa
    expect(countOpenObjectUrls()).toBeGreaterThan(0);

    await act(async () => {
      unmount();
    });

    // `reset()` gọi `sink.dispose()` TRƯỚC khi bỏ deps — sau đó không còn sink
    expect(countOpenObjectUrls()).toBe(0);
    expect(usePlayerStore.getState().state).toBe('idle');
  });

  it('phát nhiều đoạn liên tiếp không tích tụ Blob URL', async () => {
    fake = installFakeApi({
      settings: { voiceVi: 'vi_VN-vais1000-medium' },
      segments: fakeSegments('ch-1').map((s) => ({ ...s, status: 'ready' as const })),
    });
    useSettingsStore.setState({ settings: null, error: null, loading: false });
    await useSettingsStore.getState().load();

    await setup();
    await screen.findByTestId('segment-scroll');

    await act(async () => {
      await usePlayerStore.getState().toggle();
    });
    await waitFor(() => expect(usePlayerStore.getState().state).toBe('playing'));

    for (let i = 0; i < 2; i += 1) {
      await act(async () => {
        await usePlayerStore.getState().handleEnded();
      });
    }

    // Mỗi lượt phát nhả url của lượt trước → luôn chỉ còn đúng một cái đang mở
    expect(countOpenObjectUrls()).toBe(1);
  });
});

describe('đường tắt tới màn Giọng đọc (P3.3)', () => {
  it('chưa chọn giọng thì thanh player nói rõ và cho đường đi thẳng tới chỗ sửa', async () => {
    await loadSettings({ voiceVi: '' });
    const onOpenVoices = vi.fn();
    await act(async () => {
      render(<ReaderScreen detail={detail()} onBack={vi.fn()} onOpenVoices={onOpenVoices} />);
    });

    await userEvent.click(screen.getByTestId('player-open-voices'));
    expect(onOpenVoices).toHaveBeenCalledOnce();
  });

  it('đã chọn giọng thì không hiện cảnh báo ở thanh player', async () => {
    await setup();
    expect(screen.queryByTestId('player-no-voice')).not.toBeInTheDocument();
  });
});

describe('nhớ tốc độ phát qua phiên (P3.3)', () => {
  it('áp tốc độ đã lưu khi mở trình đọc', async () => {
    await loadSettings({ voiceVi: 'vi_VN-vais1000-medium', playbackRate: 1.5 });
    await setup();

    await waitFor(() => expect(usePlayerStore.getState().playbackRate).toBe(1.5));
  });

  it('đổi tốc độ thì ghi xuống settings', async () => {
    await setup();

    await act(async () => {
      await usePlayerStore.getState().setRate(2.5);
    });

    await waitFor(() =>
      expect(fake.api.settings.update).toHaveBeenCalledWith({ playbackRate: 2.5 }),
    );
  });

  it('KHÔNG ghi lại tốc độ vừa đọc từ settings — không tự ghi đè lên chính nó', async () => {
    await loadSettings({ voiceVi: 'vi_VN-vais1000-medium', playbackRate: 2 });
    await setup();

    await waitFor(() => expect(usePlayerStore.getState().playbackRate).toBe(2));
    expect(fake.api.settings.update).not.toHaveBeenCalled();
  });
});

describe('vòng đời thẻ <audio>', () => {
  it('gắn đúng MỘT thẻ vào DOM để ui-check dò được', async () => {
    await setup();

    const tags = document.querySelectorAll('[data-testid="player-audio"]');
    expect(tags).toHaveLength(1);
  });

  it('gỡ thẻ khỏi DOM khi rời trình đọc — không bỏ lại thẻ giữ bộ đệm giải mã', async () => {
    let unmount!: () => void;
    await act(async () => {
      ({ unmount } = render(<ReaderScreen detail={detail()} onBack={vi.fn()} />));
    });
    expect(document.querySelectorAll('[data-testid="player-audio"]')).toHaveLength(1);

    await act(async () => {
      unmount();
    });

    expect(document.querySelectorAll('[data-testid="player-audio"]')).toHaveLength(0);
  });

  it('mở lại trình đọc nhiều lần không tích tụ thẻ audio', async () => {
    for (let i = 0; i < 3; i += 1) {
      let unmount!: () => void;
      await act(async () => {
        ({ unmount } = render(<ReaderScreen detail={detail()} onBack={vi.fn()} />));
      });
      await act(async () => {
        unmount();
      });
    }

    expect(document.querySelectorAll('[data-testid="player-audio"]')).toHaveLength(0);
  });
});

describe('phụ đề + splitter (P3.4)', () => {
  it('phụ đề hiện text của đoạn ĐANG PHÁT, không phải đoạn đang chọn', async () => {
    await setup();
    await screen.findByTestId('segment-scroll');

    // Chọn đoạn 3 nhưng đang phát đoạn 1: phụ đề phải bám tiếng đang nghe,
    // nếu không chữ và tiếng lệch nhau.
    await act(async () => {
      useReaderStore.setState({ activeSegmentId: 'ch-1-s3' });
      usePlayerStore.setState({ state: 'playing', segmentId: 'ch-1-s1' });
    });

    const pane = screen.getByTestId('subtitle-pane');
    expect(pane.textContent).toContain('Câu thứ 1');
    expect(pane.textContent).not.toContain('Câu thứ 3');
  });

  it('bấm một từ trên phụ đề thì tua tới mốc của từ đó', async () => {
    await setup();
    await screen.findByTestId('segment-scroll');

    await act(async () => {
      usePlayerStore.setState({
        state: 'playing',
        segmentId: 'ch-1-s1',
        durationMs: 2000,
        timings: [
          { w: 'Câu', startMs: 0, endMs: 300, charStart: 0, charEnd: 3 },
          { w: 'thứ', startMs: 300, endMs: 600, charStart: 4, charEnd: 7 },
          { w: '1', startMs: 600, endMs: 900, charStart: 8, charEnd: 9 },
        ],
      });
    });

    const seek = vi.fn();
    usePlayerStore.setState({ seek });
    await userEvent.click(screen.getByRole('button', { name: 'thứ' }));
    expect(seek).toHaveBeenCalledWith(300);
  });

  it('ẩn phụ đề thì viewer lấy hết chỗ, hiện lại thì quay về tỉ lệ cũ', async () => {
    await setup();
    await screen.findByTestId('subtitle-pane');

    await userEvent.click(screen.getByRole('button', { name: 'Ẩn phụ đề' }));
    expect(screen.queryByTestId('subtitle-pane')).toBeNull();
    expect(screen.queryByTestId('pane-splitter')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Hiện phụ đề' }));
    expect(await screen.findByTestId('subtitle-pane')).toBeTruthy();
  });

  it('kéo splitter bằng bàn phím thì ghi tỉ lệ xuống settings', async () => {
    await setup();
    const bar = await screen.findByTestId('pane-splitter');

    await act(async () => {
      bar.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });

    await waitFor(() => {
      expect(fake.api.settings.update).toHaveBeenCalledWith(
        expect.objectContaining({ viewerPaneRatio: expect.any(Number) }),
      );
    });
  });

  it('tỉ lệ đã lưu từ phiên trước được áp khi mở trình đọc', async () => {
    await loadSettings({ viewerPaneRatio: 0.4 });
    await setup();

    const bar = await screen.findByTestId('pane-splitter');
    expect(bar.getAttribute('aria-valuenow')).toBe('40');
  });

  it('phụ đề và danh sách đoạn cùng bật được — hai thứ khác nhau', async () => {
    await setup();

    expect(await screen.findByTestId('subtitle-pane')).toBeTruthy();
    expect(screen.getByTestId('segment-panel')).toBeTruthy();
  });

  it('chưa phát gì thì phụ đề mời bấm phát, không để trống trơn', async () => {
    await setup();

    const pane = await screen.findByTestId('subtitle-pane');
    expect(pane.getAttribute('data-empty')).toBe('true');
    expect(pane.textContent).toContain('Bấm phát');
  });
});
