import { describe, expect, it } from 'vitest';
import {
  compareVersions,
  normalizePercent,
  shouldOfferUpdate,
  updateBlockMessage,
  updateBlockReason,
} from './update-policy.js';

describe('updateBlockReason', () => {
  it('bản NSIS đã cài thì cập nhật được', () => {
    expect(updateBlockReason({ isPackaged: true, hasUpdateConfig: true })).toBeUndefined();
  });

  it('bản dev bị chặn', () => {
    expect(updateBlockReason({ isPackaged: false, hasUpdateConfig: false })).toBe('dev');
  });

  it('bản portable bị chặn — đóng gói nhưng không có app-update.yml', () => {
    // Đây là ca `app.isPackaged` KHÔNG phân biệt được: portable cũng `true`.
    expect(updateBlockReason({ isPackaged: true, hasUpdateConfig: false })).toBe('portable');
  });

  it('dev được ưu tiên báo trước portable', () => {
    // Chạy `pnpm dev` mà thư mục lại có app-update.yml sót lại từ lần build
    // trước: vẫn là bản dev, không được coi là cập nhật được.
    expect(updateBlockReason({ isPackaged: false, hasUpdateConfig: true })).toBe('dev');
  });

  it('mỗi lý do có câu giải thích riêng, không lẫn', () => {
    expect(updateBlockMessage('dev')).not.toBe(updateBlockMessage('portable'));
    expect(updateBlockMessage('portable')).toContain('portable');
  });
});

describe('compareVersions', () => {
  it('so theo từng nhóm số', () => {
    expect(compareVersions('0.2.0', '0.1.0')).toBeGreaterThan(0);
    expect(compareVersions('0.1.0', '0.2.0')).toBeLessThan(0);
    expect(compareVersions('0.1.0', '0.1.0')).toBe(0);
  });

  it('so số chứ không so chuỗi', () => {
    // Bẫy kinh điển: '0.10.0' < '0.9.0' nếu lỡ so bằng chuỗi.
    expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '0.99.99')).toBeGreaterThan(0);
  });

  it('bỏ tiền tố v của tag GitHub', () => {
    // Tag trên GitHub thường là `v0.2.0` còn `app.getVersion()` là `0.2.0`.
    expect(compareVersions('v0.2.0', '0.2.0')).toBe(0);
    expect(compareVersions('v0.2.0', '0.1.0')).toBeGreaterThan(0);
  });

  it('prerelease xếp trước bản chính thức cùng số', () => {
    expect(compareVersions('1.0.0-beta', '1.0.0')).toBeLessThan(0);
    expect(compareVersions('1.0.0', '1.0.0-beta')).toBeGreaterThan(0);
  });

  it('thiếu nhóm số thì coi như 0', () => {
    expect(compareVersions('1', '1.0.0')).toBe(0);
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('1.2', '1.2.1')).toBeLessThan(0);
  });

  it('phần không phải số coi như 0, không ném', () => {
    // `latest.yml` là file người upload — không đảm bảo lúc nào cũng đúng dạng.
    expect(() => compareVersions('abc', '0.1.0')).not.toThrow();
    expect(compareVersions('abc', '0.1.0')).toBeLessThan(0);
  });

  it('bỏ khoảng trắng thừa', () => {
    expect(compareVersions(' 0.2.0 ', '0.2.0')).toBe(0);
  });
});

describe('shouldOfferUpdate', () => {
  it('mời khi bản trên GitHub mới hơn', () => {
    expect(shouldOfferUpdate('0.1.0', '0.2.0')).toBe(true);
  });

  it('không mời khi đã ở bản mới nhất', () => {
    expect(shouldOfferUpdate('0.2.0', '0.2.0')).toBe(false);
  });

  it('KHÔNG mời khi latest.yml trỏ về bản cũ hơn', () => {
    // Ca này là lý do hàm tồn tại: publish nhầm release cũ đè lên `latest.yml`
    // sẽ đẩy user đang ở 0.2.0 lùi về 0.1.0, mà họ không tự quay lại được.
    expect(shouldOfferUpdate('0.2.0', '0.1.0')).toBe(false);
  });
});

describe('normalizePercent', () => {
  it('tính phần trăm và làm tròn', () => {
    expect(normalizePercent(50, 200)).toBe(25);
    expect(normalizePercent(1, 3)).toBe(33);
  });

  it('total = 0 cho 0 chứ không NaN', () => {
    // Server không trả Content-Length. NaN đi vào style.width làm thanh tiến
    // trình biến mất mà không có lỗi nào — đúng kiểu hỏng lặng lẽ.
    expect(normalizePercent(10, 0)).toBe(0);
    expect(Number.isNaN(normalizePercent(10, 0))).toBe(false);
  });

  it('kẹp trần 100 khi tải quá tổng đã biết', () => {
    expect(normalizePercent(300, 200)).toBe(100);
  });

  it('giá trị âm hay vô hạn vẫn cho số hợp lệ', () => {
    expect(normalizePercent(-5, 100)).toBe(0);
    expect(normalizePercent(Number.NaN, 100)).toBe(0);
    expect(normalizePercent(10, Number.POSITIVE_INFINITY)).toBe(0);
  });
});
