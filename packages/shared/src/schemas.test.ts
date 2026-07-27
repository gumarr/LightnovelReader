import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  appSettingsSchema,
  segmentAnchorSchema,
  segmentSchema,
  wordTimingsFileSchema,
} from './schemas.js';
import type { AppSettings, Segment, SegmentAnchor, WordTiming } from './types.js';
import { SEGMENT_MAX_CHARS } from './constants.js';

describe('schema khớp với type thủ công', () => {
  it('appSettingsSchema suy ra đúng AppSettings', () => {
    expectTypeOf<ReturnType<typeof appSettingsSchema.parse>>().toEqualTypeOf<AppSettings>();
  });

  it('segmentAnchorSchema suy ra đúng SegmentAnchor', () => {
    expectTypeOf<ReturnType<typeof segmentAnchorSchema.parse>>().toEqualTypeOf<SegmentAnchor>();
  });

  it('wordTimingsFileSchema suy ra đúng WordTiming[]', () => {
    expectTypeOf<ReturnType<typeof wordTimingsFileSchema.parse>>().toEqualTypeOf<WordTiming[]>();
  });
});

describe('wordTimingsFileSchema', () => {
  const timing: WordTiming = { w: 'chào', startMs: 0, endMs: 320, charStart: 0, charEnd: 4 };

  it('chấp nhận mảng timing hợp lệ đọc từ timings.json', () => {
    expect(wordTimingsFileSchema.parse([timing])).toHaveLength(1);
  });

  it('chấp nhận mảng rỗng — segment chưa align', () => {
    expect(wordTimingsFileSchema.parse([])).toEqual([]);
  });

  it('từ chối timing âm — file timings.json hỏng phải bị bắt sớm', () => {
    expect(wordTimingsFileSchema.safeParse([{ ...timing, startMs: -1 }]).success).toBe(false);
  });

  it('từ chối phần tử thiếu field', () => {
    expect(wordTimingsFileSchema.safeParse([{ w: 'chào' }]).success).toBe(false);
  });
});

describe('segmentSchema', () => {
  const validSegment: Segment = {
    id: 'seg-1',
    chapterId: 'chap-1',
    index: 0,
    text: 'Xin chào thế giới.',
    anchor: { kind: 'pdf', page: 1, rects: [{ x: 0, y: 0, width: 100, height: 12 }] },
    status: 'pending',
    alignStatus: 'none',
  };

  it('chấp nhận segment hợp lệ', () => {
    expect(segmentSchema.parse(validSegment)).toMatchObject({ id: 'seg-1' });
  });

  it('từ chối text vượt SEGMENT_MAX_CHARS — chặn audio quá dài làm aligner degrade', () => {
    const tooLong = { ...validSegment, text: 'x'.repeat(SEGMENT_MAX_CHARS + 1) };
    expect(segmentSchema.safeParse(tooLong).success).toBe(false);
  });

  it('chấp nhận text đúng bằng ngưỡng', () => {
    const atLimit = { ...validSegment, text: 'x'.repeat(SEGMENT_MAX_CHARS) };
    expect(segmentSchema.safeParse(atLimit).success).toBe(true);
  });

  it('từ chối status ngoài tập hợp', () => {
    expect(segmentSchema.safeParse({ ...validSegment, status: 'done' }).success).toBe(false);
  });
});

describe('segmentAnchorSchema', () => {
  it('phân biệt anchor pdf và docx theo kind', () => {
    expect(segmentAnchorSchema.safeParse({ kind: 'pdf', page: 3, rects: [] }).success).toBe(true);
    expect(
      segmentAnchorSchema.safeParse({ kind: 'docx', nodePath: '/body/p[2]', offset: 10 }).success,
    ).toBe(true);
  });

  it('từ chối anchor pdf thiếu page', () => {
    expect(segmentAnchorSchema.safeParse({ kind: 'pdf', rects: [] }).success).toBe(false);
  });

  it('từ chối kind lạ', () => {
    expect(segmentAnchorSchema.safeParse({ kind: 'epub', page: 1 }).success).toBe(false);
  });
});

describe('appSettingsSchema', () => {
  const base: AppSettings = {
    theme: 'system',
    audioDir: 'D:\\audio',
    bitrate: 24,
    voiceVi: 'vi_VN-vais1000-medium',
    voiceEn: '',
    storageWarnBytes: 0,
    alignmentEnabled: true,
    viewerPaneRatio: 0.66,
    subtitleFontSize: 18,
    playbackRate: 1,
  };

  it('chấp nhận settings hợp lệ', () => {
    expect(appSettingsSchema.parse(base).bitrate).toBe(24);
  });

  it('chỉ cho phép bitrate 16/24/32', () => {
    expect(appSettingsSchema.safeParse({ ...base, bitrate: 20 }).success).toBe(false);
    for (const bitrate of [16, 24, 32]) {
      expect(appSettingsSchema.safeParse({ ...base, bitrate }).success).toBe(true);
    }
  });

  it('kẹp playbackRate trong 0.5–3.0', () => {
    expect(appSettingsSchema.safeParse({ ...base, playbackRate: 0.4 }).success).toBe(false);
    expect(appSettingsSchema.safeParse({ ...base, playbackRate: 3.5 }).success).toBe(false);
    expect(appSettingsSchema.safeParse({ ...base, playbackRate: 2 }).success).toBe(true);
    // Hai mốc nhanh thêm ở P3.3
    expect(appSettingsSchema.safeParse({ ...base, playbackRate: 2.5 }).success).toBe(true);
    expect(appSettingsSchema.safeParse({ ...base, playbackRate: 3 }).success).toBe(true);
  });

  it('settings đã lưu ở bản cũ (≤ 2×) vẫn đọc được sau khi nới trần', () => {
    // Nới trần là thay đổi an toàn một chiều: không cần migration. Hạ trần thì
    // ngược lại — sẽ làm settings đang lưu 2.5× không parse được.
    for (const playbackRate of [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]) {
      expect(appSettingsSchema.safeParse({ ...base, playbackRate }).success).toBe(true);
    }
  });

  it('từ chối audioDir rỗng — path audio phải luôn xác định', () => {
    expect(appSettingsSchema.safeParse({ ...base, audioDir: '' }).success).toBe(false);
  });

  it('kẹp viewerPaneRatio trong 0.2–0.8', () => {
    expect(appSettingsSchema.safeParse({ ...base, viewerPaneRatio: 0.1 }).success).toBe(false);
    expect(appSettingsSchema.safeParse({ ...base, viewerPaneRatio: 0.9 }).success).toBe(false);
  });
});
