import { ParseError, type DocumentParser } from './types.js';

/**
 * Chọn parser theo đuôi file.
 *
 * Thêm format mới = đăng ký thêm một `DocumentParser`, không sửa hàm nào ở
 * đây — đúng yêu cầu "thêm format mới = thêm file, không sửa core".
 */

export type ParserRegistry = {
  /** Parser xử lý được đuôi này, `undefined` nếu không có */
  find(filePath: string): DocumentParser | undefined;
  /** Như `find` nhưng ném `ParseError` thay vì trả `undefined` */
  require(filePath: string): DocumentParser;
  /** Mọi đuôi file được hỗ trợ, đã sắp xếp */
  extensions(): string[];
};

/** Lấy đuôi file dạng chữ thường kèm dấu chấm. Không có đuôi → chuỗi rỗng. */
export const extensionOf = (filePath: string): string => {
  const name = filePath.replace(/\\/g, '/').split('/').pop() ?? '';
  const dot = name.lastIndexOf('.');
  // `dot <= 0` loại cả file không đuôi lẫn dotfile (".gitignore")
  return dot <= 0 ? '' : name.slice(dot).toLowerCase();
};

export const createRegistry = (parsers: readonly DocumentParser[]): ParserRegistry => {
  const byExtension = new Map<string, DocumentParser>();

  for (const parser of parsers) {
    for (const extension of parser.extensions) {
      const key = extension.toLowerCase();
      const existing = byExtension.get(key);
      if (existing !== undefined) {
        throw new Error(
          `Đuôi ${key} đã được ${existing.format} đăng ký, ${parser.format} không thể nhận lại`,
        );
      }
      byExtension.set(key, parser);
    }
  }

  const find = (filePath: string): DocumentParser | undefined =>
    byExtension.get(extensionOf(filePath));

  return {
    find,

    require(filePath: string): DocumentParser {
      const parser = find(filePath);
      if (parser !== undefined) return parser;

      const supported = [...byExtension.keys()].sort().join(', ');
      throw new ParseError(
        'unsupported-format',
        `Không hỗ trợ định dạng này. Định dạng đọc được: ${supported}.`,
      );
    },

    extensions: () => [...byExtension.keys()].sort(),
  };
};
