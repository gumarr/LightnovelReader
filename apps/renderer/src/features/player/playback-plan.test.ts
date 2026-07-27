import { describe, expect, it } from 'vitest';
import type { Segment, SegmentStatus } from '@ln/shared';
import {
  decideSegment,
  findNextPlayable,
  findPreloadTarget,
  segmentsToPrioritise,
  tailSkips,
} from './playback-plan.js';

type Row = Pick<Segment, 'id' | 'status' | 'text' | 'errorMessage'>;

const seg = (status: SegmentStatus, over: Partial<Row> = {}): Row => ({
  id: over.id ?? `s-${status}`,
  status,
  text: 'Một câu có chữ.',
  ...over,
});

describe('decideSegment', () => {
  it('segment ready thì phát', () => {
    expect(decideSegment(seg('ready'), true).action).toBe('play');
  });

  it('segment lỗi thì BỎ QUA, không thử lại', () => {
    // Hàng đợi đã cháy hết số lượt retry mới đặt `error`; xếp lại là bắt user
    // chờ đúng chuỗi thất bại đó lần nữa, ngay giữa lúc đang nghe
    const decision = decideSegment(seg('error', { errorMessage: 'Piper từ chối' }), true);

    expect(decision.action).toBe('skip');
    expect(decision.reason).toBe('Piper từ chối');
  });

  it('segment lỗi không có thông điệp vẫn bỏ qua với lý do mặc định', () => {
    expect(decideSegment(seg('error'), true)).toEqual({ action: 'skip', reason: 'đoạn lỗi' });
  });

  it('đoạn chỉ có dấu câu thì bỏ qua, không xếp hàng đợi', () => {
    // 5/195 đoạn trên sách DOCX thật rơi vào ca này (PROGRESS P2.7)
    for (const text of ['...', '   ', '— — —', '?!', '「」']) {
      const decision = decideSegment(seg('pending', { text }), true);
      expect(decision.action).toBe('skip');
      expect(decision.reason).toBe('đoạn không có chữ để đọc');
    }
  });

  it('đoạn có chữ số cũng là có chữ để đọc', () => {
    expect(decideSegment(seg('pending', { text: '1945.' }), true).action).toBe('request');
  });

  it('đoạn có chữ tiếng Việt có dấu được nhận đúng', () => {
    expect(decideSegment(seg('pending', { text: 'Ừ.' }), true).action).toBe('request');
  });

  it('pending có chữ thì xếp ưu tiên', () => {
    expect(decideSegment(seg('pending'), true).action).toBe('request');
  });

  it('đang trong hàng đợi thì chỉ chờ, không xếp lại', () => {
    expect(decideSegment(seg('queued'), true).action).toBe('wait');
    expect(decideSegment(seg('generating'), true).action).toBe('wait');
  });

  it('tắt tạo audio thì mọi segment chưa có audio đều bỏ qua', () => {
    // Chờ một hàng đợi sẽ không chạy là treo player vĩnh viễn
    for (const status of ['pending', 'queued', 'generating'] as const) {
      const decision = decideSegment(seg(status), false);
      expect(decision.action).toBe('skip');
      expect(decision.reason).toBe('chưa bật tạo audio');
    }
  });

  it('tắt tạo audio vẫn phát được segment đã có audio', () => {
    expect(decideSegment(seg('ready'), false).action).toBe('play');
  });
});

describe('findNextPlayable — không làm gián đoạn', () => {
  it('nhảy qua đoạn lỗi tới đoạn phát được, trong MỘT lượt gọi', () => {
    const segments = [
      seg('ready', { id: 'a' }),
      seg('error', { id: 'b' }),
      seg('error', { id: 'c' }),
      seg('ready', { id: 'd' }),
    ];

    const next = findNextPlayable(segments, 1, true);

    expect(next?.index).toBe(3);
    expect(next?.decision.action).toBe('play');
    expect(next?.skipped.map((s) => s.index)).toEqual([1, 2]);
  });

  it('mười đoạn hỏng liên tiếp vẫn chỉ là một lần gọi', () => {
    const segments = [
      ...Array.from({ length: 10 }, (_, i) => seg('error', { id: `bad-${String(i)}` })),
      seg('ready', { id: 'good' }),
    ];

    const next = findNextPlayable(segments, 0, true);

    expect(next?.index).toBe(10);
    expect(next?.skipped).toHaveLength(10);
  });

  it('bỏ qua cả đoạn rỗng lẫn đoạn lỗi lẫn đoạn không tạo được', () => {
    const segments = [
      seg('error', { id: 'a' }),
      seg('pending', { id: 'b', text: '...' }),
      seg('ready', { id: 'c' }),
    ];

    const next = findNextPlayable(segments, 0, true);
    expect(next?.index).toBe(2);
    expect(next?.skipped.map((s) => s.reason)).toEqual(['đoạn lỗi', 'đoạn không có chữ để đọc']);
  });

  it('dừng lại ở đoạn đang tạo audio — đó là thứ đáng chờ', () => {
    const segments = [seg('ready', { id: 'a' }), seg('generating', { id: 'b' }), seg('ready')];

    const next = findNextPlayable(segments, 1, true);
    expect(next?.index).toBe(1);
    expect(next?.decision.action).toBe('wait');
  });

  it('dừng lại ở đoạn cần xếp hàng đợi', () => {
    const segments = [seg('ready', { id: 'a' }), seg('pending', { id: 'b' })];

    const next = findNextPlayable(segments, 1, true);
    expect(next?.decision.action).toBe('request');
  });

  it('hết chương thì trả undefined', () => {
    expect(findNextPlayable([seg('ready')], 1, true)).toBeUndefined();
  });

  it('cuối chương toàn đoạn hỏng cũng trả undefined, không treo', () => {
    const segments = [seg('ready', { id: 'a' }), seg('error'), seg('error')];
    expect(findNextPlayable(segments, 1, true)).toBeUndefined();
  });

  it('chương rỗng trả undefined', () => {
    expect(findNextPlayable([], 0, true)).toBeUndefined();
  });

  it('from âm được kẹp về 0 chứ không bỏ sót segment đầu', () => {
    expect(findNextPlayable([seg('ready')], -5, true)?.index).toBe(0);
  });

  it('from quá cuối mảng trả undefined', () => {
    expect(findNextPlayable([seg('ready')], 99, true)).toBeUndefined();
  });

  it('tắt tạo audio thì chỉ dừng ở segment đã có audio', () => {
    const segments = [seg('pending', { id: 'a' }), seg('queued', { id: 'b' }), seg('ready')];

    const next = findNextPlayable(segments, 0, false);
    expect(next?.index).toBe(2);
    expect(next?.skipped).toHaveLength(2);
  });
});

describe('tailSkips', () => {
  it('dựng lại phần đuôi mà findNextPlayable nuốt mất', () => {
    const segments = [
      seg('ready', { id: 'a' }),
      seg('error', { id: 'b', errorMessage: 'Piper từ chối' }),
      seg('pending', { id: 'c', text: '...' }),
    ];

    // findNextPlayable trả undefined ở đây, mảng skipped của nó mất theo
    expect(findNextPlayable(segments, 1, true)).toBeUndefined();

    expect(tailSkips(segments, 1, true)).toEqual([
      { index: 1, reason: 'Piper từ chối' },
      { index: 2, reason: 'đoạn không có chữ để đọc' },
    ]);
  });

  it('dừng lại nếu gặp đoạn phát được — gọi sai chỗ thì không báo nhầm', () => {
    const segments = [seg('error', { id: 'a' }), seg('ready', { id: 'b' })];
    expect(tailSkips(segments, 0, true)).toEqual([{ index: 0, reason: 'đoạn lỗi' }]);
  });

  it('from quá cuối mảng trả mảng rỗng', () => {
    expect(tailSkips([seg('error')], 9, true)).toEqual([]);
  });
});

describe('findPreloadTarget', () => {
  it('nạp trước segment ready kế tiếp', () => {
    const segments = [seg('ready', { id: 'a' }), seg('ready', { id: 'b' })];
    expect(findPreloadTarget(segments, 0, true)).toBe(1);
  });

  it('bỏ qua đoạn hỏng để nạp đúng thứ sẽ phát thật', () => {
    const segments = [seg('ready', { id: 'a' }), seg('error'), seg('ready', { id: 'c' })];
    expect(findPreloadTarget(segments, 0, true)).toBe(2);
  });

  it('không nạp trước segment đang generate — chưa có file để tải', () => {
    const segments = [seg('ready', { id: 'a' }), seg('generating', { id: 'b' })];
    expect(findPreloadTarget(segments, 0, true)).toBeUndefined();
  });

  it('cuối chương thì không nạp gì', () => {
    expect(findPreloadTarget([seg('ready')], 0, true)).toBeUndefined();
  });
});

describe('segmentsToPrioritise', () => {
  it('chỉ xếp segment pending có chữ', () => {
    const segments = [
      seg('ready', { id: 'a' }),
      seg('pending', { id: 'b' }),
      seg('error', { id: 'c' }),
      seg('queued', { id: 'd' }),
      seg('pending', { id: 'e', text: '...' }),
      seg('pending', { id: 'f' }),
    ];

    expect(segmentsToPrioritise(segments, 0, 10)).toEqual(['b', 'f']);
  });

  it('xếp trước nhiều segment để hàng đợi đi trước đầu phát', () => {
    const segments = Array.from({ length: 20 }, (_, i) =>
      seg('pending', { id: `s${String(i)}` }),
    );

    expect(segmentsToPrioritise(segments, 0, 4)).toEqual(['s0', 's1', 's2', 's3']);
  });

  it('trần limit chặn "bấm phát" biến thành "generate cả chương"', () => {
    const segments = Array.from({ length: 500 }, (_, i) =>
      seg('pending', { id: `s${String(i)}` }),
    );

    expect(segmentsToPrioritise(segments, 0, 3)).toHaveLength(3);
  });

  it('bắt đầu từ vị trí đang phát, không xếp lại phần đã qua', () => {
    const segments = [
      seg('pending', { id: 'a' }),
      seg('pending', { id: 'b' }),
      seg('pending', { id: 'c' }),
    ];

    expect(segmentsToPrioritise(segments, 1, 10)).toEqual(['b', 'c']);
  });

  it('không còn gì để xếp thì trả mảng rỗng', () => {
    expect(segmentsToPrioritise([seg('ready'), seg('error')], 0, 5)).toEqual([]);
  });

  it('limit 0 trả mảng rỗng', () => {
    expect(segmentsToPrioritise([seg('pending')], 0, 0)).toEqual([]);
  });
});
