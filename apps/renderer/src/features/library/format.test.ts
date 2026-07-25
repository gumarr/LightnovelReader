import { describe, expect, it } from 'vitest';
import { coverInitials, coverShade, formatLabel, relativeTime } from './format';

const NOW = 1_000_000_000_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('relativeTime', () => {
  it('chưa đọc lần nào', () => {
    expect(relativeTime(undefined, NOW)).toBe('Chưa đọc');
  });

  it('dưới một phút là "Vừa xong"', () => {
    expect(relativeTime(NOW - 30_000, NOW)).toBe('Vừa xong');
  });

  it('tính theo phút, giờ, ngày', () => {
    expect(relativeTime(NOW - 5 * MINUTE, NOW)).toBe('5 phút trước');
    expect(relativeTime(NOW - 3 * HOUR, NOW)).toBe('3 giờ trước');
    expect(relativeTime(NOW - 5 * DAY, NOW)).toBe('5 ngày trước');
  });

  it('một ngày là "Hôm qua"', () => {
    expect(relativeTime(NOW - DAY, NOW)).toBe('Hôm qua');
  });

  it('gộp thành tháng và năm khi đủ xa', () => {
    expect(relativeTime(NOW - 60 * DAY, NOW)).toBe('2 tháng trước');
    expect(relativeTime(NOW - 400 * DAY, NOW)).toBe('1 năm trước');
  });

  it('mốc trong tương lai không sinh số âm', () => {
    // Đồng hồ hệ thống lùi lại là chuyện có thật
    expect(relativeTime(NOW + HOUR, NOW)).toBe('Vừa xong');
  });
});

describe('coverInitials', () => {
  it('lấy chữ cái đầu của hai từ đầu', () => {
    expect(coverInitials('Kiếm Vực Thần Đế')).toBe('KV');
  });

  it('một từ thì lấy hai ký tự đầu', () => {
    expect(coverInitials('Overlord')).toBe('OV');
  });

  it('bỏ khoảng trắng thừa', () => {
    expect(coverInitials('  Hai   Từ  ')).toBe('HT');
  });

  it('tên rỗng không làm vỡ giao diện', () => {
    expect(coverInitials('   ')).toBe('?');
  });
});

describe('coverShade', () => {
  it('cùng tên luôn ra cùng sắc độ', () => {
    expect(coverShade('Kiếm Vực')).toBe(coverShade('Kiếm Vực'));
  });

  it('nằm trong khoảng dùng được, không quá nhạt hay quá đậm', () => {
    for (const title of ['A', 'Kiếm Vực Thần Đế', 'Overlord', 'Re:Zero', '']) {
      const shade = coverShade(title);
      expect(shade).toBeGreaterThanOrEqual(0.08);
      expect(shade).toBeLessThanOrEqual(0.28);
    }
  });

  it('tên khác nhau cho ra nhiều sắc độ khác nhau', () => {
    const shades = new Set(
      ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta'].map(coverShade),
    );
    expect(shades.size).toBeGreaterThan(1);
  });
});

describe('formatLabel', () => {
  it('viết hoa định dạng', () => {
    expect(formatLabel('pdf')).toBe('PDF');
    expect(formatLabel('docx')).toBe('DOCX');
  });
});
