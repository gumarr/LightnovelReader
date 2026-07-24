import { describe, expect, it } from 'vitest';
import { isAbsolute, join, relative, sep } from 'node:path';
import {
  assertSafeId,
  bookAudioDir,
  bookFilePath,
  coverPath,
  dbPath,
  isSafeId,
  libraryDir,
  segmentAudioPath,
  segmentTimingsPath,
  voiceDir,
} from './paths.js';

const USER_DATA = join('C:', 'Users', 'test', 'AppData', 'Roaming', 'ln-reader');
const AUDIO_DIR = join('E:', 'ln-audio');

describe('isSafeId', () => {
  it.each(['abc123', 'seg-1', 'book_2', 'a', 'A'.repeat(64)])('chấp nhận %s', (id) => {
    expect(isSafeId(id)).toBe(true);
  });

  it.each([
    ['', 'rỗng'],
    ['..', 'thư mục cha'],
    ['../evil', 'traversal'],
    ['a/b', 'dấu gạch chéo'],
    ['a\\b', 'dấu gạch ngược'],
    ['a:b', 'dấu hai chấm — ADS trên NTFS'],
    ['a b', 'khoảng trắng'],
    ['a.b', 'dấu chấm'],
    ['A'.repeat(65), 'quá dài'],
  ])('từ chối %j (%s)', (id) => {
    expect(isSafeId(id)).toBe(false);
  });
});

describe('assertSafeId', () => {
  it('không throw với id hợp lệ', () => {
    expect(() => assertSafeId('seg-1', 'segmentId')).not.toThrow();
  });

  it('nêu rõ tên tham số trong thông báo lỗi', () => {
    expect(() => assertSafeId('../x', 'bookId')).toThrow(/bookId/);
  });
});

describe('đường dẫn dẫn xuất từ userData', () => {
  it('dbPath nằm trong userData', () => {
    expect(dbPath(USER_DATA)).toBe(join(USER_DATA, 'ln-reader.db'));
  });

  it('bookFilePath thêm dấu chấm nếu ext thiếu', () => {
    expect(bookFilePath(USER_DATA, 'book1', 'pdf')).toBe(join(libraryDir(USER_DATA), 'book1.pdf'));
    expect(bookFilePath(USER_DATA, 'book1', '.pdf')).toBe(join(libraryDir(USER_DATA), 'book1.pdf'));
  });

  it('coverPath dùng đuôi .jpg', () => {
    expect(coverPath(USER_DATA, 'book1').endsWith('.jpg')).toBe(true);
  });

  it('voiceDir tách theo voiceId', () => {
    expect(voiceDir(USER_DATA, 'vi_VN-vais1000-medium')).toContain('vi_VN-vais1000-medium');
  });
});

describe('đường dẫn audio', () => {
  it('theo đúng bố cục {audioDir}/{bookId}/{segmentId}.ogg', () => {
    expect(segmentAudioPath(AUDIO_DIR, 'book1', 'seg1')).toBe(
      join(AUDIO_DIR, 'book1', 'seg1.ogg'),
    );
  });

  it('timings dùng cùng thư mục với audio, khác đuôi', () => {
    expect(segmentTimingsPath(AUDIO_DIR, 'book1', 'seg1')).toBe(
      join(AUDIO_DIR, 'book1', 'seg1.json'),
    );
  });

  it('audioDir nằm ngoài userData vẫn hoạt động — user đổi được thư mục', () => {
    const custom = join('D:', 'Data', 'audio');
    expect(segmentAudioPath(custom, 'book1', 'seg1').startsWith(custom)).toBe(true);
  });

  it('bookAudioDir gom audio theo sách', () => {
    expect(bookAudioDir(AUDIO_DIR, 'book1')).toBe(join(AUDIO_DIR, 'book1'));
  });
});

describe('chống path traversal', () => {
  it.each([
    ['bookId', () => bookAudioDir(AUDIO_DIR, '../..')],
    ['bookId trong segmentAudioPath', () => segmentAudioPath(AUDIO_DIR, '..', 'seg1')],
    ['segmentId', () => segmentAudioPath(AUDIO_DIR, 'book1', '../../etc')],
    ['segmentId trong timings', () => segmentTimingsPath(AUDIO_DIR, 'book1', '..')],
    ['bookId trong bookFilePath', () => bookFilePath(USER_DATA, '../evil', 'pdf')],
    ['bookId trong coverPath', () => coverPath(USER_DATA, '../evil')],
  ])('từ chối %s không hợp lệ', (_label, fn) => {
    expect(fn).toThrow(/không hợp lệ/);
  });

  it('mọi path audio sinh ra đều nằm trong audioDir', () => {
    for (const bookId of ['book1', 'b-2', 'B_3']) {
      for (const segId of ['seg1', 's-2']) {
        const p = segmentAudioPath(AUDIO_DIR, bookId, segId);
        const rel = relative(AUDIO_DIR, p);
        expect(rel.startsWith(`..${sep}`)).toBe(false);
        expect(isAbsolute(rel)).toBe(false);
      }
    }
  });
});
