import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileLogger, formatLogLine } from './logger.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ln-log-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('formatLogLine', () => {
  it('gồm timestamp ISO, level và message', () => {
    const line = formatLogLine('info', 'app khởi động');
    expect(line).toMatch(/^\[\d{4}-\d{2}-\d{2}T[\d:.]+Z\] INFO {2}app khởi động\n$/);
  });

  it('nối detail sau dấu |', () => {
    expect(formatLogLine('error', 'lỗi', 'chi tiết')).toContain('lỗi | chi tiết');
  });

  it('gộp xuống dòng trong detail để mỗi log là một dòng', () => {
    const line = formatLogLine('error', 'lỗi', 'dòng 1\ndòng 2');
    expect(line.split('\n')).toHaveLength(2); // chỉ có newline cuối
    expect(line).toContain('dòng 1 ⏎ dòng 2');
  });

  it('xử lý CRLF của Windows', () => {
    const line = formatLogLine('warn', 'w', 'a\r\nb');
    expect(line.split('\n')).toHaveLength(2);
  });

  it('level được căn lề để log dễ đọc', () => {
    expect(formatLogLine('info', 'x')).toContain('INFO  x');
    expect(formatLogLine('error', 'x')).toContain('ERROR x');
  });
});

describe('createFileLogger', () => {
  it('tạo thư mục logs nếu chưa có', () => {
    const nested = join(dir, 'a', 'b', 'logs');
    createFileLogger(nested);
    expect(existsSync(nested)).toBe(true);
  });

  it('ghi log xuống app.log', () => {
    const logger = createFileLogger(dir);
    logger.info('xin chào');
    expect(readFileSync(join(dir, 'app.log'), 'utf8')).toContain('xin chào');
  });

  it('ghi nối tiếp, không ghi đè log cũ', () => {
    const logger = createFileLogger(dir);
    logger.info('dòng một');
    logger.warn('dòng hai');

    const content = readFileSync(join(dir, 'app.log'), 'utf8');
    expect(content).toContain('dòng một');
    expect(content).toContain('dòng hai');
    expect(content.trimEnd().split('\n')).toHaveLength(2);
  });

  it('ghi đủ bốn mức log', () => {
    const logger = createFileLogger(dir);
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');

    const content = readFileSync(join(dir, 'app.log'), 'utf8');
    for (const level of ['DEBUG', 'INFO', 'WARN', 'ERROR']) {
      expect(content).toContain(level);
    }
  });

  it('xoay file khi vượt ngưỡng kích thước', () => {
    // Tạo sẵn file lớn hơn ngưỡng 2 MB
    writeFileSync(join(dir, 'app.log'), 'x'.repeat(3 * 1024 * 1024), 'utf8');

    const logger = createFileLogger(dir);
    logger.info('sau khi xoay');

    const archived = readdirSync(dir).filter((f) => f.startsWith('app-') && f.endsWith('.log'));
    expect(archived).toHaveLength(1);

    const current = readFileSync(join(dir, 'app.log'), 'utf8');
    expect(current).toContain('sau khi xoay');
    expect(current.length).toBeLessThan(1000);
  });

  it('không xoay khi file còn nhỏ', () => {
    const logger = createFileLogger(dir);
    logger.info('ngắn');
    logger.info('cũng ngắn');
    expect(readdirSync(dir).filter((f) => f.startsWith('app-'))).toHaveLength(0);
  });

  it('giữ tối đa 5 file lưu trữ, xoá bản cũ nhất', () => {
    // Đây là phần chặn log phình vô hạn — nếu hỏng thì `{userData}/logs/` cứ
    // lớn dần mà không có gì báo, và chỉ lộ ra khi user hết ổ đĩa.
    const logger = createFileLogger(dir);

    // Mỗi vòng: nhồi file vượt ngưỡng rồi ghi một dòng để kích hoạt xoay.
    for (let i = 0; i < 8; i += 1) {
      writeFileSync(join(dir, 'app.log'), 'x'.repeat(3 * 1024 * 1024), 'utf8');
      logger.info(`vòng ${String(i)}`);
    }

    const archived = readdirSync(dir).filter((f) => f.startsWith('app-') && f.endsWith('.log'));

    // 8 lần xoay nhưng chỉ còn 5 bản: 4 bản lưu trữ + app.log hiện tại.
    expect(archived.length).toBeLessThanOrEqual(5);
    expect(archived.length).toBeGreaterThan(0);
  });

  it('lỗi fs khác ENOENT phải nổi lên, không nuốt', () => {
    // `rotateIfNeeded` bắt ENOENT (file chưa có ở lần ghi đầu) là đúng, nhưng
    // bắt hết mọi lỗi thì hỏng quyền ghi cũng thành im lặng — CLAUDE.md cấm
    // try/catch nuốt lỗi. Thư mục không tồn tại là ca kiểm được ổn định.
    const logger = createFileLogger(dir);
    logger.info('có file rồi');

    rmSync(dir, { recursive: true, force: true });

    expect(() => logger.info('thư mục biến mất')).toThrow();
  });
});
