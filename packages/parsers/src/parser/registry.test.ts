import { describe, expect, it } from 'vitest';
import { createRegistry, extensionOf } from './registry.js';
import { ParseError, type DocumentParser, type ParsedDocument } from './types.js';

const stub = (format: DocumentParser['format'], extensions: string[]): DocumentParser => ({
  format,
  extensions,
  parse: (): Promise<ParsedDocument> =>
    Promise.resolve({ format, pages: [], outline: [], totalPages: 0, hasRealPages: true }),
});

describe('extensionOf', () => {
  it('lấy đuôi thường gặp', () => {
    expect(extensionOf('sach.pdf')).toBe('.pdf');
    expect(extensionOf('sach.docx')).toBe('.docx');
  });

  it('chuyển về chữ thường', () => {
    expect(extensionOf('SACH.PDF')).toBe('.pdf');
  });

  it('xử lý đường dẫn Windows lẫn POSIX', () => {
    expect(extensionOf('D:\\Sach\\ln vol 1.pdf')).toBe('.pdf');
    expect(extensionOf('/home/user/ln.docx')).toBe('.docx');
  });

  it('lấy đuôi cuối khi tên có nhiều dấu chấm', () => {
    expect(extensionOf('ln.vol.1.pdf')).toBe('.pdf');
  });

  it('file không đuôi trả rỗng', () => {
    expect(extensionOf('README')).toBe('');
    expect(extensionOf('/path/to/file')).toBe('');
  });

  it('dotfile không tính là có đuôi', () => {
    expect(extensionOf('.gitignore')).toBe('');
  });

  it('tên có khoảng trắng và dấu tiếng Việt', () => {
    expect(extensionOf('Kiếm Vực Thần Đế - Quyển 1.pdf')).toBe('.pdf');
  });
});

describe('createRegistry', () => {
  const registry = createRegistry([stub('pdf', ['.pdf']), stub('docx', ['.docx'])]);

  it('tìm đúng parser theo đuôi', () => {
    expect(registry.find('a.pdf')?.format).toBe('pdf');
    expect(registry.find('a.docx')?.format).toBe('docx');
  });

  it('đuôi lạ trả undefined', () => {
    expect(registry.find('a.epub')).toBeUndefined();
    expect(registry.find('a.txt')).toBeUndefined();
  });

  it('liệt kê đuôi hỗ trợ đã sắp xếp', () => {
    expect(registry.extensions()).toEqual(['.docx', '.pdf']);
  });

  it('require ném ParseError có kind rõ ràng', () => {
    try {
      registry.require('a.epub');
      expect.unreachable('phải ném lỗi');
    } catch (error) {
      expect(error).toBeInstanceOf(ParseError);
      expect((error as ParseError).kind).toBe('unsupported-format');
      // Thông điệp phải nêu định dạng nào dùng được
      expect((error as ParseError).message).toContain('.pdf');
    }
  });

  it('require trả parser khi hỗ trợ', () => {
    expect(registry.require('a.pdf').format).toBe('pdf');
  });

  it('không phân biệt hoa thường khi đăng ký', () => {
    const upper = createRegistry([stub('pdf', ['.PDF'])]);
    expect(upper.find('a.pdf')?.format).toBe('pdf');
  });

  it('đăng ký trùng đuôi thì báo lỗi ngay', () => {
    expect(() => createRegistry([stub('pdf', ['.pdf']), stub('epub', ['.pdf'])])).toThrow(/đã được/);
  });

  it('registry rỗng vẫn dùng được', () => {
    const empty = createRegistry([]);
    expect(empty.find('a.pdf')).toBeUndefined();
    expect(empty.extensions()).toEqual([]);
  });
});
