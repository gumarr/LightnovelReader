import { describe, expect, it } from 'vitest';
import type { UpdateStatus } from '@ln/shared';
import {
  downloadProgressLabel,
  shouldNotify,
  updateAction,
  updateActionLabel,
  updateDetail,
  updateTitle,
} from './update-format';

const status = (overrides: Partial<UpdateStatus> = {}): UpdateStatus => ({
  state: 'idle',
  currentVersion: '0.1.0',
  ...overrides,
});

describe('updateTitle', () => {
  it('không khẳng định "mới nhất" khi chưa kiểm lần nào', () => {
    // `idle` + `checkedAt` rỗng = vừa mở app, chưa hỏi ai. Nói "đang dùng bản
    // mới nhất" ở đây là khẳng định app không có cơ sở nào để đưa ra.
    expect(updateTitle(status())).toBe('Cập nhật');
  });

  it('khẳng định "mới nhất" sau khi đã kiểm', () => {
    expect(updateTitle(status({ checkedAt: 1 }))).toBe('Đang dùng bản mới nhất');
  });

  it('nêu số phiên bản mới trong tiêu đề', () => {
    expect(updateTitle(status({ state: 'available', availableVersion: '0.2.0' }))).toBe(
      'Có bản mới 0.2.0',
    );
  });

  it('không để lại khoảng trắng thừa khi thiếu số phiên bản', () => {
    // `availableVersion` là optional trong `UpdateStatus`; ghép chuỗi thô sẽ ra
    // "Có bản mới " với dấu cách cuối.
    expect(updateTitle(status({ state: 'available' }))).toBe('Có bản mới');
  });

  it('mỗi trạng thái còn lại có tiêu đề riêng, không rỗng', () => {
    const states: UpdateStatus['state'][] = [
      'checking',
      'downloading',
      'downloaded',
      'error',
      'unsupported',
    ];
    const titles = states.map((state) => updateTitle(status({ state })));

    expect(titles.every((t) => t.length > 0)).toBe(true);
    expect(new Set(titles).size).toBe(states.length);
  });
});

describe('updateDetail', () => {
  it('nêu bản đang chạy khi có bản mới — user cần biết mình đang ở đâu', () => {
    const detail = updateDetail(status({ state: 'available', availableVersion: '0.2.0' }));
    expect(detail).toContain('0.1.0');
  });

  it('báo trước rằng app sẽ đóng khi cài', () => {
    // User đang đọc dở; bấm nhầm mà app tắt không báo trước là mất chỗ đọc.
    expect(updateDetail(status({ state: 'downloaded' }))).toContain('đóng');
  });

  it('dùng chính `message` của main cho error và unsupported', () => {
    expect(updateDetail(status({ state: 'error', message: 'ENOTFOUND' }))).toBe('ENOTFOUND');
    expect(updateDetail(status({ state: 'unsupported', message: 'Bản portable…' }))).toBe(
      'Bản portable…',
    );
  });

  it('không có mô tả khi chưa kiểm lần nào hoặc đang kiểm', () => {
    expect(updateDetail(status())).toBeUndefined();
    expect(updateDetail(status({ state: 'checking' }))).toBeUndefined();
  });

  it('hiện phiên bản hiện tại sau khi kiểm xong mà không có gì mới', () => {
    expect(updateDetail(status({ checkedAt: 1 }))).toContain('0.1.0');
  });
});

describe('downloadProgressLabel', () => {
  it('hiện cả số đã tải lẫn tổng', () => {
    const label = downloadProgressLabel(
      status({ state: 'downloading', downloadedBytes: 15_728_640, totalBytes: 157_286_400 }),
    );
    expect(label).toBe('15 MB / 150 MB');
  });

  it('không dựng nhãn khi chưa có mốc tiến độ nào', () => {
    // `electron-updater` bắn `download-progress` lần đầu sau vài trăm ms; trước
    // đó `downloadedBytes` chưa tồn tại.
    expect(downloadProgressLabel(status({ state: 'downloading' }))).toBeUndefined();
  });

  it('không chia cho 0 khi server không trả Content-Length', () => {
    expect(
      downloadProgressLabel(
        status({ state: 'downloading', downloadedBytes: 100, totalBytes: 0 }),
      ),
    ).toBeUndefined();
  });
});

describe('updateAction', () => {
  it('có bản mới thì mời tải, tải xong thì mời cài', () => {
    expect(updateAction(status({ state: 'available' }))).toBe('download');
    expect(updateAction(status({ state: 'downloaded' }))).toBe('install');
  });

  it('cho bấm lại sau khi lỗi — mất mạng tạm là ca hay gặp nhất', () => {
    expect(updateAction(status({ state: 'error' }))).toBe('check');
  });

  it('không có nút nào khi đang chạy dở', () => {
    // Bấm nữa chỉ tạo lượt thứ hai chồng lên lượt đang chạy; main có chặn
    // (P5.5b) nhưng UI không được mời user làm việc vô ích.
    expect(updateAction(status({ state: 'checking' }))).toBe('none');
    expect(updateAction(status({ state: 'downloading' }))).toBe('none');
  });

  it('không có nút nào ở bản portable / bản dev', () => {
    expect(updateAction(status({ state: 'unsupported' }))).toBe('none');
  });

  it('mọi action trừ `none` đều có nhãn', () => {
    expect(updateActionLabel('check')).toBeDefined();
    expect(updateActionLabel('download')).toBeDefined();
    expect(updateActionLabel('install')).toBeDefined();
    expect(updateActionLabel('none')).toBeUndefined();
  });
});

describe('shouldNotify', () => {
  it('chỉ báo ra ngoài khi user làm được gì đó', () => {
    expect(shouldNotify(status({ state: 'available' }))).toBe(true);
    expect(shouldNotify(status({ state: 'downloaded' }))).toBe(true);
  });

  it('KHÔNG báo lỗi ra dải ngoài', () => {
    // App đọc sách offline: mỗi lần mở không có mạng lại hiện một dải đỏ thì
    // user học cách bỏ qua dải đó, kể cả lúc nó nói điều đáng nghe.
    expect(shouldNotify(status({ state: 'error', message: 'ENOTFOUND' }))).toBe(false);
  });

  it('không báo ở các trạng thái còn lại', () => {
    for (const state of ['idle', 'checking', 'downloading', 'unsupported'] as const) {
      expect(shouldNotify(status({ state }))).toBe(false);
    }
  });
});
