import { describe, expect, it } from 'vitest';
import { err, errorMessage, isOk, ok } from './result.js';

describe('Result', () => {
  it('ok gói dữ liệu', () => {
    const r = ok(42);
    expect(r).toEqual({ ok: true, data: 42 });
    expect(isOk(r)).toBe(true);
  });

  it('err không kèm detail khi không truyền — tránh key undefined lọt qua IPC', () => {
    const r = err('NOT_FOUND', 'Không tìm thấy sách');
    expect(r).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'Không tìm thấy sách' } });
    expect('detail' in (r as { error: object }).error).toBe(false);
  });

  it('err giữ detail khi có', () => {
    const r = err('IO_ERROR', 'Lỗi đọc file', 'EACCES');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.detail).toBe('EACCES');
  });

  it('kết quả err phải serialize được qua structured clone của IPC', () => {
    const r = err('DB_ERROR', 'Lỗi DB', 'detail');
    expect(() => structuredClone(r)).not.toThrow();
    expect(structuredClone(r)).toEqual(r);
  });

  it('isOk thu hẹp kiểu để truy cập data', () => {
    const r = ok('xin chào');
    if (isOk(r)) expect(r.data.length).toBe(8);
    else expect.unreachable('phải là ok');
  });
});

describe('errorMessage', () => {
  it('lấy message từ Error', () => {
    expect(errorMessage(new Error('bùm'))).toBe('bùm');
  });

  it('trả nguyên chuỗi', () => {
    expect(errorMessage('lỗi thô')).toBe('lỗi thô');
  });

  it('không throw với giá trị lạ', () => {
    expect(errorMessage(null)).toBe('null');
    expect(errorMessage({ a: 1 })).toBe('[object Object]');
  });
});
