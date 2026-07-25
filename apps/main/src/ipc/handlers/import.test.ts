import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ParseError } from '@ln/parsers';
import type { ImportPreview } from '@ln/shared';
import { createImportHandlers } from './import.js';
import type { ImportSession, ImportSessionStore } from '../../services/import-session.js';
import { InvalidInputError } from '../wrap.js';

const showOpenDialog = vi.hoisted(() => vi.fn());
vi.mock('electron', () => ({ dialog: { showOpenDialog } }));

const preview = (importId: string): ImportPreview => ({
  importId,
  filePath: 'a.pdf',
  suggestedTitle: 'a',
  format: 'pdf',
  totalPages: 10,
  hasRealPages: true,
  hasOutline: false,
  chapters: [{ id: 'c1', title: 'Chương 1', pageStart: 1, pageEnd: 10, excluded: false }],
});

/** Store giả: service thật đã có test riêng, ở đây chỉ kiểm phần handler */
const fakeStore = (options: {
  onCreate?: (filePath: string) => Promise<{ session: ImportSession; preview: ImportPreview }>;
  // `| undefined` tường minh: dự án bật `exactOptionalPropertyTypes` nên
  // truyền thẳng `session: undefined` (ca "phiên hết hạn") sẽ lỗi nếu thiếu
  session?: ImportSession | undefined;
} = {}): ImportSessionStore & { discarded: string[] } => {
  const discarded: string[] = [];
  return {
    discarded,
    create:
      options.onCreate ??
      (async (filePath: string) => ({
        session: { id: 'imp1' } as ImportSession,
        preview: { ...preview('imp1'), filePath },
      })),
    get: () => options.session,
    discard: (id: string) => {
      discarded.push(id);
      return true;
    },
    size: () => 0,
  };
};

const sessionWith = (pages: { pageNumber: number; text: string }[]): ImportSession =>
  ({ id: 'imp1', filePath: 'a.pdf', cleaned: pages, createdAt: 0 }) as ImportSession;

const handlersFor = (store: ImportSessionStore): ReturnType<typeof createImportHandlers> =>
  createImportHandlers({ sessions: store, getWindow: () => null, extensions: ['.pdf', '.docx'] });

beforeEach(() => {
  showOpenDialog.mockReset();
});

describe('import:pickFile', () => {
  it('trả null khi user bấm huỷ — không phải lỗi', async () => {
    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });

    const result = await handlersFor(fakeStore()).pickFile();
    expect(result).toEqual({ ok: true, data: null });
  });

  it('parse file user chọn', async () => {
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['D:\\sach\\x.pdf'] });

    const result = await handlersFor(fakeStore()).pickFile();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data?.filePath).toBe('D:\\sach\\x.pdf');
  });

  it('bỏ dấu chấm khỏi đuôi file khi dựng filter cho dialog', async () => {
    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });

    await handlersFor(fakeStore()).pickFile();
    const [options] = showOpenDialog.mock.calls[0] as [{ filters: { extensions: string[] }[] }];
    expect(options.filters[0]?.extensions).toEqual(['pdf', 'docx']);
  });

  it('mảng filePaths rỗng dù không canceled vẫn trả null', async () => {
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [] });

    const result = await handlersFor(fakeStore()).pickFile();
    expect(result).toEqual({ ok: true, data: null });
  });
});

describe('import:parseFile', () => {
  it('từ chối input không phải chuỗi', async () => {
    await expect(handlersFor(fakeStore()).parseFile(42)).rejects.toBeInstanceOf(InvalidInputError);
  });

  it('từ chối chuỗi rỗng', async () => {
    await expect(handlersFor(fakeStore()).parseFile('')).rejects.toBeInstanceOf(InvalidInputError);
  });

  it('PDF scan trả mã PDF_NO_TEXT_LAYER để UI hiện chỉ dẫn riêng', async () => {
    const store = fakeStore({
      onCreate: () => Promise.reject(new ParseError('scanned-pdf', 'Bản scan, không có text.')),
    });

    const result = await handlersFor(store).parseFile('a.pdf');
    expect(result).toEqual({
      ok: false,
      error: { code: 'PDF_NO_TEXT_LAYER', message: 'Bản scan, không có text.' },
    });
  });

  it('định dạng lạ trả mã UNSUPPORTED_FORMAT', async () => {
    const store = fakeStore({
      onCreate: () => Promise.reject(new ParseError('unsupported-format', 'Không hỗ trợ .epub')),
    });

    const result = await handlersFor(store).parseFile('a.epub');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('UNSUPPORTED_FORMAT');
  });

  it('file hỏng trả mã PARSE_ERROR', async () => {
    const store = fakeStore({
      onCreate: () => Promise.reject(new ParseError('corrupt-file', 'File hỏng')),
    });

    const result = await handlersFor(store).parseFile('a.pdf');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PARSE_ERROR');
  });

  it('giữ lỗi gốc vào detail — không có thì lỗi đóng gói không chẩn đoán được', async () => {
    const cause = new Error('Setting up fake worker failed');
    const store = fakeStore({
      onCreate: () =>
        Promise.reject(new ParseError('corrupt-file', 'Không đọc được file PDF.', { cause })),
    });

    const result = await handlersFor(store).parseFile('a.pdf');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.detail).toBe('Setting up fake worker failed');
  });

  it('ghi log lỗi parse — wrapHandler không thấy vì ParseError thành Result', async () => {
    const logged: string[] = [];
    const store = fakeStore({
      onCreate: () => Promise.reject(new ParseError('corrupt-file', 'File hỏng')),
    });

    const handlers = createImportHandlers({
      sessions: store,
      getWindow: () => null,
      extensions: ['.pdf'],
      logError: (message) => logged.push(message),
    });

    await handlers.parseFile('D:\\a.pdf');
    expect(logged[0]).toContain('D:\\a.pdf');
    expect(logged[0]).toContain('corrupt-file');
  });

  it('lỗi KHÔNG phải ParseError được ném tiếp để wrapHandler ghi log stack', async () => {
    const store = fakeStore({ onCreate: () => Promise.reject(new Error('ENOMEM')) });

    // Nuốt ở đây thì mất stack — lỗi hạ tầng phải đi qua wrapHandler
    await expect(handlersFor(store).parseFile('a.pdf')).rejects.toThrow('ENOMEM');
  });
});

describe('import:getChapterPreview', () => {
  it('trả text của đúng khoảng trang', () => {
    const store = fakeStore({
      session: sessionWith([
        { pageNumber: 1, text: 'Trang một.' },
        { pageNumber: 2, text: 'Trang hai.' },
        { pageNumber: 3, text: 'Trang ba.' },
      ]),
    });

    const result = handlersFor(store).getChapterPreview({
      importId: 'imp1',
      chapterId: 'c1',
      pageStart: 2,
      pageEnd: 3,
    });

    expect(result).toEqual({ ok: true, data: { chapterId: 'c1', text: 'Trang hai. Trang ba.' } });
  });

  it('phiên đã hết hạn trả NOT_FOUND với hướng dẫn cho user', () => {
    const store = fakeStore({ session: undefined });

    const result = handlersFor(store).getChapterPreview({
      importId: 'imp-cũ',
      chapterId: 'c1',
      pageStart: 1,
      pageEnd: 2,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
      expect(result.error.message).toContain('chọn lại file');
    }
  });

  it('từ chối pageStart không dương', () => {
    expect(() =>
      handlersFor(fakeStore()).getChapterPreview({
        importId: 'imp1',
        chapterId: 'c1',
        pageStart: 0,
        pageEnd: 2,
      }),
    ).toThrow(InvalidInputError);
  });

  it('từ chối maxChars vượt trần — renderer không được ép main gửi cả sách', () => {
    expect(() =>
      handlersFor(fakeStore()).getChapterPreview({
        importId: 'imp1',
        chapterId: 'c1',
        pageStart: 1,
        pageEnd: 2,
        maxChars: 999_999,
      }),
    ).toThrow(InvalidInputError);
  });

  it('từ chối input thiếu field', () => {
    expect(() => handlersFor(fakeStore()).getChapterPreview({ importId: 'imp1' })).toThrow(
      InvalidInputError,
    );
  });
});

describe('import:cancel', () => {
  it('bỏ phiên theo ID', () => {
    const store = fakeStore();
    const result = handlersFor(store).cancel('imp1');

    expect(result).toEqual({ ok: true, data: undefined });
    expect(store.discarded).toEqual(['imp1']);
  });

  it('bỏ phiên không tồn tại vẫn ok — renderer có thể gọi hai lần', () => {
    const store = fakeStore();
    expect(handlersFor(store).cancel('không-có').ok).toBe(true);
  });

  it('từ chối importId rỗng', () => {
    expect(() => handlersFor(fakeStore()).cancel('')).toThrow(InvalidInputError);
  });
});
