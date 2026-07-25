import { beforeEach, describe, expect, it, vi } from 'vitest';
import { err } from '@ln/shared';
import { installFakeApi, type FakeApi } from '@/test/fake-api';
import { useImportStore } from './import-store';

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

/** Nạp preview mặc định của fake api: 3 chương liền mạch trên sách 30 trang */
const loaded = async (): Promise<void> => {
  await useImportStore.getState().pickFile();
};

describe('pickFile', () => {
  it('nạp chương từ preview và tính vấn đề ngay', async () => {
    await loaded();
    const state = useImportStore.getState();

    expect(state.preview?.importId).toBe('imp1');
    expect(state.chapters).toHaveLength(3);
    expect(state.issues).toEqual([]);
    expect(state.parsing).toBe(false);
  });

  it('user bấm huỷ không phải lỗi — không đặt error', async () => {
    fake.api.import.pickFile.mockResolvedValueOnce({ ok: true, data: null });
    await useImportStore.getState().pickFile();

    const state = useImportStore.getState();
    expect(state.error).toBeNull();
    expect(state.preview).toBeNull();
    expect(state.parsing).toBe(false);
  });

  it('hiện lỗi từ main và tắt trạng thái đang parse', async () => {
    fake.api.import.pickFile.mockResolvedValueOnce(
      err('PDF_NO_TEXT_LAYER', 'PDF này là bản scan.'),
    );
    await useImportStore.getState().pickFile();

    const state = useImportStore.getState();
    expect(state.error).toBe('PDF này là bản scan.');
    expect(state.parsing).toBe(false);
  });

  it('IPC reject không làm UI kẹt ở "đang phân tích"', async () => {
    fake.api.import.pickFile.mockRejectedValueOnce(new Error('kênh chưa đăng ký'));
    await useImportStore.getState().pickFile();

    const state = useImportStore.getState();
    expect(state.parsing).toBe(false);
    expect(state.error).toContain('Không kết nối được');
  });

  it('nạp file mới xoá sạch trạng thái của file cũ', async () => {
    await loaded();
    useImportStore.getState().remove('c3');
    await useImportStore.getState().loadPreview('c1');
    expect(useImportStore.getState().history).toHaveLength(1);

    await loaded();
    const state = useImportStore.getState();
    expect(state.history).toEqual([]);
    expect(state.previews).toEqual({});
    expect(state.chapters).toHaveLength(3);
  });
});

describe('parseFile', () => {
  it('nạp được từ đường dẫn có sẵn (kéo-thả)', async () => {
    await useImportStore.getState().parseFile('D:\\a.pdf');
    expect(useImportStore.getState().chapters).toHaveLength(3);
    expect(fake.api.import.parseFile).toHaveBeenCalledWith('D:\\a.pdf');
  });

  it('lỗi parse hiện message của main', async () => {
    fake.api.import.parseFile.mockResolvedValueOnce(err('PARSE_ERROR', 'File hỏng'));
    await useImportStore.getState().parseFile('D:\\a.pdf');
    expect(useImportStore.getState().error).toBe('File hỏng');
  });
});

describe('loadPreview', () => {
  it('tải và lưu text preview theo chapterId', async () => {
    await loaded();
    await useImportStore.getState().loadPreview('c2');

    expect(useImportStore.getState().previews['c2']).toBe('Nội dung trang 11–20.');
  });

  it('không gọi IPC lại khi đã có preview', async () => {
    await loaded();
    await useImportStore.getState().loadPreview('c1');
    await useImportStore.getState().loadPreview('c1');

    expect(fake.api.import.getChapterPreview).toHaveBeenCalledTimes(1);
  });

  it('bấm liên tiếp chỉ gọi IPC một lần', async () => {
    await loaded();
    await Promise.all([
      useImportStore.getState().loadPreview('c1'),
      useImportStore.getState().loadPreview('c1'),
      useImportStore.getState().loadPreview('c1'),
    ]);

    expect(fake.api.import.getChapterPreview).toHaveBeenCalledTimes(1);
  });

  it('bỏ cờ đang tải kể cả khi IPC lỗi', async () => {
    await loaded();
    fake.api.import.getChapterPreview.mockRejectedValueOnce(new Error('main chết'));
    await useImportStore.getState().loadPreview('c1');

    const state = useImportStore.getState();
    expect(state.loadingPreviews).toEqual([]);
    expect(state.error).toContain('Không kết nối được');
  });

  it('phiên hết hạn hiện lỗi cho user', async () => {
    await loaded();
    fake.api.import.getChapterPreview.mockResolvedValueOnce(
      err('NOT_FOUND', 'Phiên nhập sách đã hết hạn. Hãy chọn lại file.'),
    );
    await useImportStore.getState().loadPreview('c1');

    expect(useImportStore.getState().error).toContain('hết hạn');
  });

  it('bỏ qua chapterId không tồn tại', async () => {
    await loaded();
    await useImportStore.getState().loadPreview('không-có');
    expect(fake.api.import.getChapterPreview).not.toHaveBeenCalled();
  });

  it('gửi đúng khoảng trang của chương', async () => {
    await loaded();
    await useImportStore.getState().loadPreview('c3');

    expect(fake.api.import.getChapterPreview).toHaveBeenCalledWith({
      importId: 'imp1',
      chapterId: 'c3',
      pageStart: 21,
      pageEnd: 30,
    });
  });
});

describe('sửa cấu trúc', () => {
  it('gộp chương dồn vùng trang lại', async () => {
    await loaded();
    useImportStore.getState().merge('c2');

    const state = useImportStore.getState();
    expect(state.chapters).toHaveLength(2);
    expect(state.chapters[0]).toMatchObject({ pageStart: 1, pageEnd: 20 });
  });

  it('gộp chương ĐẦU bị từ chối, không ghi vào history', async () => {
    await loaded();
    useImportStore.getState().merge('c1');

    const state = useImportStore.getState();
    expect(state.chapters).toHaveLength(3);
    expect(state.history).toEqual([]);
  });

  it('tách sai chỗ bị từ chối, không ghi vào history', async () => {
    await loaded();
    useImportStore.getState().split('c1', 1);

    expect(useImportStore.getState().history).toEqual([]);
  });

  it('tách hợp lệ sinh chương mới chưa có tên → lỗi chặn', async () => {
    await loaded();
    useImportStore.getState().split('c1', 5);

    const state = useImportStore.getState();
    expect(state.chapters).toHaveLength(4);
    expect(state.canConfirm()).toBe(false);
    expect(state.issues.some((i) => i.kind === 'empty-title')).toBe(true);
  });

  it('đặt tên xong thì xác nhận được', async () => {
    await loaded();
    useImportStore.getState().split('c1', 5);
    const newChapter = useImportStore.getState().chapters[1]!;
    useImportStore.getState().rename(newChapter.id, 'Chương 1.5');

    expect(useImportStore.getState().canConfirm()).toBe(true);
  });

  it('xoá chương sinh cảnh báo khoảng trống nhưng vẫn xác nhận được', async () => {
    await loaded();
    useImportStore.getState().remove('c2');

    const state = useImportStore.getState();
    expect(state.issues.some((i) => i.kind === 'gap')).toBe(true);
    expect(state.canConfirm()).toBe(true);
  });

  it('loại trừ hết mọi chương thì chặn xác nhận', async () => {
    await loaded();
    for (const id of ['c1', 'c2', 'c3']) useImportStore.getState().toggleExclude(id);

    const state = useImportStore.getState();
    expect(state.issues.some((i) => i.kind === 'no-chapters')).toBe(true);
    expect(state.canConfirm()).toBe(false);
  });

  it('không sửa được khi chưa nạp file', () => {
    useImportStore.getState().merge('c1');
    expect(useImportStore.getState().chapters).toEqual([]);
  });
});

describe('preview bị bỏ khi vùng trang đổi', () => {
  it('gộp xoá preview cũ của chương bị gộp', async () => {
    await loaded();
    await useImportStore.getState().loadPreview('c2');
    expect(useImportStore.getState().previews['c2']).toBeDefined();

    useImportStore.getState().merge('c2');
    expect(useImportStore.getState().previews['c2']).toBeUndefined();
  });

  it('tách xoá preview của chương bị tách — nội dung đã khác', async () => {
    await loaded();
    await useImportStore.getState().loadPreview('c1');
    useImportStore.getState().split('c1', 5);

    expect(useImportStore.getState().previews['c1']).toBeUndefined();
  });

  it('đổi tên KHÔNG xoá preview — nội dung không đổi', async () => {
    await loaded();
    await useImportStore.getState().loadPreview('c1');
    useImportStore.getState().rename('c1', 'Tên khác');

    expect(useImportStore.getState().previews['c1']).toBe('Nội dung trang 1–10.');
  });
});

describe('undo', () => {
  it('quay lại trạng thái trước thao tác gần nhất', async () => {
    await loaded();
    useImportStore.getState().merge('c2');
    expect(useImportStore.getState().chapters).toHaveLength(2);

    useImportStore.getState().undo();
    expect(useImportStore.getState().chapters).toHaveLength(3);
  });

  it('hoàn tác nhiều bước theo đúng thứ tự ngược', async () => {
    await loaded();
    useImportStore.getState().rename('c1', 'A');
    useImportStore.getState().rename('c1', 'B');

    useImportStore.getState().undo();
    expect(useImportStore.getState().chapters[0]?.title).toBe('A');

    useImportStore.getState().undo();
    expect(useImportStore.getState().chapters[0]?.title).toBe('Chương 1: Mở đầu');
  });

  it('undo khi history rỗng không làm gì', async () => {
    await loaded();
    useImportStore.getState().undo();
    expect(useImportStore.getState().chapters).toHaveLength(3);
  });

  it('tính lại vấn đề sau khi hoàn tác', async () => {
    await loaded();
    useImportStore.getState().split('c1', 5);
    expect(useImportStore.getState().canConfirm()).toBe(false);

    useImportStore.getState().undo();
    expect(useImportStore.getState().canConfirm()).toBe(true);
  });

  it('history có trần, không phình vô hạn', async () => {
    await loaded();
    for (let i = 0; i < 40; i += 1) {
      useImportStore.getState().rename('c1', `Tên ${i}`);
    }
    expect(useImportStore.getState().history.length).toBeLessThanOrEqual(20);
  });
});

describe('reset', () => {
  it('báo main giải phóng phiên và xoá trạng thái', async () => {
    await loaded();
    await useImportStore.getState().reset();

    expect(fake.api.import.cancel).toHaveBeenCalledWith('imp1');
    expect(useImportStore.getState().preview).toBeNull();
    expect(useImportStore.getState().chapters).toEqual([]);
  });

  it('chưa nạp file thì không gọi IPC', async () => {
    await useImportStore.getState().reset();
    expect(fake.api.import.cancel).not.toHaveBeenCalled();
  });

  it('IPC lỗi vẫn xoá trạng thái — màn hình đã đóng rồi', async () => {
    await loaded();
    fake.api.import.cancel.mockRejectedValueOnce(new Error('main chết'));
    await useImportStore.getState().reset();

    expect(useImportStore.getState().preview).toBeNull();
  });
});

describe('canConfirm', () => {
  it('false khi chưa nạp file', () => {
    expect(useImportStore.getState().canConfirm()).toBe(false);
  });

  it('false trong lúc đang parse', async () => {
    await loaded();
    useImportStore.setState({ parsing: true });
    expect(useImportStore.getState().canConfirm()).toBe(false);
  });

  it('true khi cấu trúc hợp lệ', async () => {
    await loaded();
    expect(useImportStore.getState().canConfirm()).toBe(true);
  });
});
