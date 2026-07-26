import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS, IPC_EVENTS, ok, type AppSettings } from '@ln/shared';

const ipcRenderer = vi.hoisted(() => ({
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
}));
vi.mock('electron', () => ({ ipcRenderer }));

const { api } = await import('./api.js');

const settings: AppSettings = {
  theme: 'dark',
  audioDir: 'E:\\audio',
  bitrate: 24,
  storageWarnBytes: 0,
  alignmentEnabled: true,
  viewerPaneRatio: 0.66,
  subtitleFontSize: 18,
  playbackRate: 1,
};

beforeEach(() => {
  ipcRenderer.invoke.mockReset().mockResolvedValue(ok(settings));
  ipcRenderer.on.mockReset();
  ipcRenderer.removeListener.mockReset();
});

/** Thu thập mọi channel mà bề mặt api gọi tới */
const invokedChannels = async (): Promise<Set<string>> => {
  const channels = new Set<string>();
  const calls: Array<() => Promise<unknown>> = [
    () => api.app.getInfo(),
    () => api.settings.getAll(),
    () => api.settings.update({ bitrate: 32 }),
    () => api.settings.setTheme('dark'),
    () => api.settings.pickAudioDir(),
    () => api.import.pickFile(),
    () => api.import.parseFile('D:\\a.pdf'),
    () =>
      api.import.getChapterPreview({
        importId: 'imp1',
        chapterId: 'c1',
        pageStart: 1,
        pageEnd: 10,
      }),
    () => api.import.cancel('imp1'),
    () =>
      api.library.saveBook({
        importId: 'imp1',
        title: 'Sách',
        lang: 'vi',
        chapters: [{ id: 'c1', title: 'Chương 1', pageStart: 1, pageEnd: 10, excluded: false }],
      }),
    () => api.library.list(),
    () => api.library.openBook('book-1'),
    () => api.library.setProgress({ bookId: 'book-1', segmentId: 'seg-1' }),
    () => api.library.removeBook('book-1'),
    () => api.reader.getBookFile('book-1'),
    () => api.reader.getBookHtml('book-1'),
    () => api.reader.listSegments('ch-1'),
    () => api.sidecar.getStatus(),
    () => api.window.minimize(),
    () => api.window.toggleMaximize(),
    () => api.window.close(),
    () => api.window.getState(),
  ];

  for (const call of calls) {
    ipcRenderer.invoke.mockClear();
    await call();
    const channel = ipcRenderer.invoke.mock.calls[0]?.[0];
    if (typeof channel === 'string') channels.add(channel);
  }
  return channels;
};

describe('bề mặt window.api', () => {
  it('chỉ gọi channel nằm trong whitelist', async () => {
    const used = await invokedChannels();
    for (const channel of used) {
      expect(IPC_CHANNELS as readonly string[]).toContain(channel);
    }
  });

  it('phủ hết mọi channel đã khai báo — không có channel chết', async () => {
    const used = await invokedChannels();
    for (const channel of IPC_CHANNELS) {
      expect([...used]).toContain(channel);
    }
  });

  it('không expose ipcRenderer thô cho renderer', () => {
    const surface = JSON.stringify(Object.keys(api));
    expect(surface).not.toContain('ipcRenderer');
    expect(Object.keys(api).sort()).toEqual([
      'app',
      'import',
      'library',
      'reader',
      'settings',
      'sidecar',
      'window',
    ]);
  });

  it('truyền input xuống đúng channel', async () => {
    await api.settings.setTheme('light');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('settings:setTheme', 'light');
  });

  it('truyền undefined cho channel không có input', async () => {
    await api.window.minimize();
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('window:minimize', undefined);
  });

  it('trả nguyên Result từ main', async () => {
    await expect(api.settings.getAll()).resolves.toEqual(ok(settings));
  });
});

describe('đăng ký event', () => {
  it('đăng ký đúng tên event trong whitelist, phủ hết event đã khai báo', () => {
    api.settings.onChanged(() => {});
    api.window.onStateChanged(() => {});
    api.sidecar.onStatusChanged(() => {});

    const registered = ipcRenderer.on.mock.calls.map((c) => c[0]);
    for (const event of registered) {
      expect(IPC_EVENTS as readonly string[]).toContain(event);
    }
    // Khai event trong contract mà quên nối ở preload thì renderer không bao
    // giờ nhận được — kiểm cả hai chiều, không chỉ chiều whitelist.
    for (const event of IPC_EVENTS) {
      expect(registered).toContain(event);
    }
    expect(registered).toHaveLength(IPC_EVENTS.length);
  });

  it('trả về hàm huỷ đăng ký gỡ đúng listener', () => {
    const unsubscribe = api.settings.onChanged(() => {});
    const handler = ipcRenderer.on.mock.calls[0]?.[1];

    unsubscribe();
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith('settings:changed', handler);
  });

  it('chỉ truyền payload, không truyền IpcRendererEvent chứa sender', () => {
    const received: unknown[] = [];
    api.settings.onChanged((s) => received.push(s));

    const handler = ipcRenderer.on.mock.calls[0]?.[1] as
      | ((e: unknown, payload: unknown) => void)
      | undefined;
    handler?.({ sender: 'nguy hiểm' }, settings);

    expect(received).toEqual([settings]);
  });
});
