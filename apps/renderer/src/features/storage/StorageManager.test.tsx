import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { err, type ChapterUsageInfo, type StorageUsageInfo } from '@ln/shared';
import { installFakeApi, fakeBook, fakeLibraryEntry, type FakeApi } from '@/test/fake-api';
import { useStorageStore } from '@/stores/storage-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useLibraryStore } from '@/stores/library-store';
import { StorageManager } from './StorageManager';

/**
 * Test màn Storage Manager.
 *
 * Trọng tâm: **không lượt xoá nào chạy mà chưa qua hộp xác nhận** (xoá audio
 * không lấy lại được), và số liệu hiện ra là số main trả về chứ không phải phép
 * trừ ở renderer.
 */

let fake: FakeApi;

const chapters: ChapterUsageInfo[] = [
  {
    chapterId: 'book-1-c1',
    title: 'Chương 1: Mở đầu',
    index: 0,
    segmentCount: 10,
    readySegments: 10,
    audioBytes: 40_000,
    errorCount: 0,
  },
  {
    chapterId: 'book-1-c2',
    title: 'Chương 2: Chưa tạo',
    index: 1,
    segmentCount: 10,
    readySegments: 0,
    audioBytes: 0,
    errorCount: 0,
  },
];

const install = (usage: Partial<StorageUsageInfo> = {}): FakeApi =>
  installFakeApi({
    library: [fakeLibraryEntry(fakeBook())],
    usage: {
      audioBytes: 40_000,
            audioBytesOnDisk: 41_000,
      warnBytes: 100_000,
      books: [
        {
          bookId: 'book-1',
          title: 'Kiếm Vực Thần Đế',
          bookFileBytes: 2048,
          audioBytes: 40_000,
          chapterCount: 2,
          completeChapters: 1,
        },
      ],
      ...usage,
    },
    chapterUsage: chapters.map((c) => ({ ...c })),
  });

beforeEach(async () => {
  fake = install();
  useStorageStore.setState({
    usage: null,
    chapters: [],
    expandedBookId: null,
    loading: false,
    deleting: false,
    error: null,
    lastDeleted: null,
  });
  useSettingsStore.setState({ settings: null, error: null, loading: false });
  useLibraryStore.setState({ entries: [], opened: null, error: null, loading: false });
  await useSettingsStore.getState().load();
});

const renderView = async (): Promise<void> => {
  await act(async () => {
    render(<StorageManager onBack={vi.fn()} />);
  });
};

describe('hiện dung lượng', () => {
  it('hiện tổng audio', async () => {
    await renderView();

    expect(screen.getByTestId('storage-total')).toHaveTextContent('39 KB');
  });

  it('hiện từng sách kèm dung lượng', async () => {
    await renderView();

    expect(screen.getByTestId('storage-book-book-1')).toBeInTheDocument();
    expect(screen.getByTestId('storage-book-bytes-book-1')).toHaveTextContent('39 KB');
  });

  it('hiện thanh mức dùng so với ngưỡng', async () => {
    await renderView();

    // 40 000 / 100 000 = 40%
    expect(screen.getByTestId('storage-bar')).toHaveAttribute('aria-valuenow', '40');
  });

  it('tắt cảnh báo thì không hiện thanh', async () => {
    fake = install({ warnBytes: 0 });
    await renderView();

    expect(screen.queryByTestId('storage-bar')).not.toBeInTheDocument();
  });

  it('vượt ngưỡng thì cảnh báo rõ', async () => {
    fake = install({ audioBytes: 200_000, warnBytes: 100_000 });
    await renderView();

    expect(screen.getByTestId('storage-over-warning')).toBeInTheDocument();
  });

  it('gần ngưỡng thì nhắc nhẹ, chưa phải cảnh báo đỏ', async () => {
    fake = install({ audioBytes: 85_000, warnBytes: 100_000 });
    await renderView();

    expect(screen.getByTestId('storage-near-warning')).toBeInTheDocument();
    expect(screen.queryByTestId('storage-over-warning')).not.toBeInTheDocument();
  });

  it('không có rác thì không hiện dòng dọn rác', async () => {
    await renderView();

    expect(screen.queryByTestId('storage-orphans')).not.toBeInTheDocument();
  });

  it('có rác thì hiện nút dọn', async () => {
    fake = install({ orphanFiles: 5, orphanBytes: 9000 });
    await renderView();

    expect(screen.getByTestId('storage-orphans')).toHaveTextContent('5 file');
  });

  it('lỗi nạp hiện ra cho user', async () => {
    fake = install();
    fake.api.storage.getUsage.mockResolvedValueOnce(err('DB_ERROR', 'Không đọc được DB'));
    await renderView();

    expect(screen.getByTestId('storage-error')).toHaveTextContent('Không đọc được DB');
  });
});

describe('xem theo chương', () => {
  it('bấm sách thì tải và hiện chương', async () => {
    await renderView();

    await userEvent.click(screen.getByRole('button', { expanded: false }));

    expect(await screen.findByTestId('storage-chapter-book-1-c1')).toBeInTheDocument();
    expect(screen.getByTestId('storage-chapter-book-1-c2')).toBeInTheDocument();
  });

  it('chưa mở sách thì KHÔNG tải chương — tránh N+1 lượt IPC', async () => {
    await renderView();

    expect(fake.api.storage.getChapterUsage).not.toHaveBeenCalled();
  });

  it('chương chưa có audio thì không cho xoá', async () => {
    await renderView();
    await userEvent.click(screen.getByRole('button', { expanded: false }));

    await screen.findByTestId('storage-chapter-book-1-c2');
    expect(screen.getByTestId('storage-delete-chapter-book-1-c2')).toBeDisabled();
    expect(screen.getByTestId('storage-delete-chapter-book-1-c1')).toBeEnabled();
  });
});

describe('cửa xác nhận xoá', () => {
  it('bấm xoá sách KHÔNG xoá ngay — phải qua hộp xác nhận', async () => {
    await renderView();

    await userEvent.click(screen.getByTestId('storage-delete-book-book-1'));

    expect(await screen.findByTestId('delete-audio-dialog')).toBeInTheDocument();
    expect(fake.api.storage.deleteBookAudio).not.toHaveBeenCalled();
  });

  it('bấm xoá chương cũng phải qua hộp xác nhận', async () => {
    await renderView();
    await userEvent.click(screen.getByRole('button', { expanded: false }));
    await screen.findByTestId('storage-chapter-book-1-c1');

    await userEvent.click(screen.getByTestId('storage-delete-chapter-book-1-c1'));

    expect(await screen.findByTestId('delete-audio-dialog')).toBeInTheDocument();
    expect(fake.api.storage.deleteChapterAudio).not.toHaveBeenCalled();
  });

  it('hộp xác nhận nói rõ giữ lại tiến độ đọc', async () => {
    await renderView();
    await userEvent.click(screen.getByTestId('storage-delete-book-book-1'));

    const dialog = await screen.findByTestId('delete-audio-dialog');
    expect(dialog).toHaveTextContent('tiến độ đọc');
  });

  it('bấm xoá phần đã đọc cũng phải qua hộp xác nhận', async () => {
    await renderView();

    await userEvent.click(screen.getByTestId('storage-delete-read-book-1'));

    expect(await screen.findByTestId('delete-audio-dialog')).toBeInTheDocument();
    expect(fake.api.storage.deleteReadAudio).not.toHaveBeenCalled();
  });

  it('hộp xoá phần đã đọc nói rõ chương đang đọc được giữ lại', async () => {
    // Không có câu này thì "xoá phần đã đọc" nghe như xoá cả chương đang nghe dở.
    await renderView();
    await userEvent.click(screen.getByTestId('storage-delete-read-book-1'));

    const note = await screen.findByTestId('delete-scope-note');
    expect(note).toHaveTextContent(/Chương đang đọc/);
  });

  it('xoá phần đã đọc KHÔNG hiện con số bịa', async () => {
    // Số byte do main tính theo vị trí đọc dở — renderer không biết trước. Hiện
    // "0 B" ở đây sẽ khiến user tưởng bấm cũng không xoá gì.
    await renderView();
    await userEvent.click(screen.getByTestId('storage-delete-read-book-1'));

    await screen.findByTestId('delete-audio-dialog');
    expect(screen.queryByTestId('delete-bytes')).not.toBeInTheDocument();
  });

  it('xác nhận rồi mới gọi IPC xoá phần đã đọc', async () => {
    await renderView();
    await userEvent.click(screen.getByTestId('storage-delete-read-book-1'));
    await userEvent.click(await screen.findByTestId('delete-confirm'));

    await waitFor(() => {
      expect(fake.api.storage.deleteReadAudio).toHaveBeenCalledWith('book-1');
    });
    // Không được đụng nhầm sang đường xoá cả sách
    expect(fake.api.storage.deleteBookAudio).not.toHaveBeenCalled();
  });

  it('huỷ thì không xoá gì và hộp đóng lại', async () => {
    await renderView();
    await userEvent.click(screen.getByTestId('storage-delete-book-book-1'));
    await userEvent.click(await screen.findByRole('button', { name: 'Huỷ' }));

    expect(screen.queryByTestId('delete-audio-dialog')).not.toBeInTheDocument();
    expect(fake.api.storage.deleteBookAudio).not.toHaveBeenCalled();
  });

  it('xác nhận rồi mới gọi IPC xoá', async () => {
    await renderView();
    await userEvent.click(screen.getByTestId('storage-delete-book-book-1'));
    await userEvent.click(await screen.findByTestId('delete-confirm'));

    await waitFor(() => {
      expect(fake.api.storage.deleteBookAudio).toHaveBeenCalledWith('book-1');
    });
  });

  it('xoá xong thì hiện số byte đã giải phóng', async () => {
    await renderView();
    await userEvent.click(screen.getByTestId('storage-delete-book-book-1'));
    await userEvent.click(await screen.findByTestId('delete-confirm'));

    expect(await screen.findByTestId('storage-freed')).toHaveTextContent('39 KB');
  });

  it('xoá xong thì số trên màn hình cập nhật theo main', async () => {
    await renderView();
    await userEvent.click(screen.getByTestId('storage-delete-book-book-1'));
    await userEvent.click(await screen.findByTestId('delete-confirm'));

    await waitFor(() => {
      expect(screen.getByTestId('storage-total')).toHaveTextContent('0 B');
    });
  });

  it('xoá xong thì nạp lại thư viện — grid không được hiện số cũ', async () => {
    await renderView();
    await userEvent.click(screen.getByTestId('storage-delete-book-book-1'));
    await userEvent.click(await screen.findByTestId('delete-confirm'));

    await waitFor(() => {
      expect(fake.api.library.list).toHaveBeenCalled();
    });
  });

  it('sách chưa có audio thì nút xoá bị vô hiệu', async () => {
    fake = install({
      audioBytes: 0,
      books: [
        {
          bookId: 'book-1',
          title: 'Kiếm Vực Thần Đế',
          bookFileBytes: 2048,
          audioBytes: 0,
          chapterCount: 2,
          completeChapters: 0,
        },
      ],
    });
    await renderView();

    expect(screen.getByTestId('storage-delete-book-book-1')).toBeDisabled();
  });
});

describe('thiết lập dung lượng', () => {
  it('hiện thư mục audio hiện tại', async () => {
    await renderView();

    expect(screen.getByTestId('storage-audio-dir')).toHaveTextContent('E:\\ln-audio');
  });

  it('bấm đổi thư mục gọi dialog của main', async () => {
    await renderView();

    await userEvent.click(screen.getByTestId('storage-pick-dir'));

    expect(fake.api.settings.pickAudioDir).toHaveBeenCalled();
  });

  it('cảnh báo đổi thư mục không di chuyển file cũ', async () => {
    await renderView();

    expect(screen.getByText(/không di chuyển audio đã tạo/)).toBeInTheDocument();
  });

  it('đổi bitrate ghi vào settings', async () => {
    await renderView();

    await userEvent.selectOptions(screen.getByLabelText('Chất lượng audio'), '32');

    await waitFor(() => {
      expect(fake.api.settings.update).toHaveBeenCalledWith({ bitrate: 32 });
    });
  });

  it('đổi ngưỡng cảnh báo ghi vào settings rồi nạp lại số', async () => {
    await renderView();
    const before = fake.api.storage.getUsage.mock.calls.length;

    await userEvent.selectOptions(
      screen.getByLabelText('Cảnh báo khi vượt'),
      String(10 * 1024 ** 3),
    );

    await waitFor(() => {
      expect(fake.api.settings.update).toHaveBeenCalledWith({
        storageWarnBytes: 10 * 1024 ** 3,
      });
    });
    // Ngưỡng nằm trong `usage` nên phải nạp lại, nếu không thanh vẫn theo số cũ
    expect(fake.api.storage.getUsage.mock.calls.length).toBeGreaterThan(before);
  });
});

describe('dọn rác', () => {
  it('bấm dọn gọi IPC và cập nhật lại', async () => {
    fake = install({ orphanFiles: 5, orphanBytes: 9000 });
    await renderView();

    await userEvent.click(screen.getByTestId('storage-delete-orphans'));

    await waitFor(() => {
      expect(fake.api.storage.deleteOrphans).toHaveBeenCalled();
    });
    // Dọn xong thì dòng rác biến mất
    await waitFor(() => {
      expect(screen.queryByTestId('storage-orphans')).not.toBeInTheDocument();
    });
  });
});

describe('thư viện rỗng', () => {
  it('nói rõ chưa có sách nào chứ không hiện bảng trống', async () => {
    fake = installFakeApi({ library: [], usage: { books: [] } });
    await renderView();

    expect(screen.getByText('Thư viện chưa có sách nào.')).toBeInTheDocument();
  });
});
