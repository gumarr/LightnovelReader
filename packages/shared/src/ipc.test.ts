import { describe, expect, it } from 'vitest';
import { IPC_CHANNELS, IPC_EVENTS, isIpcChannel, isIpcEvent } from './ipc.js';

describe('IPC whitelist', () => {
  it('không có channel trùng lặp', () => {
    expect(new Set(IPC_CHANNELS).size).toBe(IPC_CHANNELS.length);
    expect(new Set(IPC_EVENTS).size).toBe(IPC_EVENTS.length);
  });

  it('mọi channel dùng dạng "domain:action"', () => {
    for (const channel of IPC_CHANNELS) {
      expect(channel).toMatch(/^[a-z]+:[a-zA-Z]+$/);
    }
  });

  it('isIpcChannel chấp nhận channel hợp lệ', () => {
    for (const channel of IPC_CHANNELS) {
      expect(isIpcChannel(channel)).toBe(true);
    }
  });

  it('isIpcChannel từ chối channel lạ — chặn renderer gọi kênh tuỳ ý', () => {
    for (const bad of ['fs:readFile', 'app:evil', '', 'settings']) {
      expect(isIpcChannel(bad)).toBe(false);
    }
  });

  it('isIpcEvent phân biệt event với channel invoke', () => {
    expect(isIpcEvent('window:stateChanged')).toBe(true);
    expect(isIpcEvent('window:minimize')).toBe(false);
  });

  it('event và invoke channel không giẫm tên nhau', () => {
    const overlap = (IPC_EVENTS as readonly string[]).filter((e) =>
      (IPC_CHANNELS as readonly string[]).includes(e),
    );
    expect(overlap).toEqual([]);
  });
});
