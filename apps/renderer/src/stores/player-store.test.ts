import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Segment, SegmentAudio, SegmentStatus, WordTiming } from '@ln/shared';
import type { AudioPreloader, AudioSink } from '../features/player/audio-element.js';
import { attachPlayer, detachPlayer, usePlayerStore } from './player-store.js';

/**
 * Máy trạng thái player. Không dựng `<audio>` thật — jsdom không phát audio nên
 * `sink` là bản giả, đúng lý do interface đó tồn tại.
 *
 * Trọng tâm: **đoạn hỏng thì bỏ qua, audio không đứt.** Phần lớn test ở đây
 * kiểm đúng lời hứa đó ở từng đường khác nhau.
 */

const timing = (w: string): WordTiming => ({ w, startMs: 0, endMs: 100, charStart: 0, charEnd: 1 });

const seg = (id: string, status: SegmentStatus, over: Partial<Segment> = {}): Segment => ({
  id,
  chapterId: 'ch-1',
  index: 0,
  text: 'Một câu có chữ.',
  anchor: { kind: 'pdf', page: 1, rects: [] },
  status,
  alignStatus: 'none',
  ...over,
});

const makeSink = () => {
  const calls: string[] = [];
  let position = 0;

  const sink: AudioSink = {
    play: vi.fn(async (_bytes: ArrayBuffer, startMs: number) => {
      calls.push(`play@${String(startMs)}`);
    }),
    resume: vi.fn(async () => {
      calls.push('resume');
    }),
    pause: vi.fn(() => {
      calls.push('pause');
    }),
    positionMs: () => position,
    seek: vi.fn((ms: number) => {
      position = ms;
      calls.push(`seek@${String(ms)}`);
    }),
    setRate: vi.fn((rate: number) => {
      calls.push(`rate=${String(rate)}`);
    }),
    dispose: vi.fn(() => {
      calls.push('dispose');
    }),
  };

  return { sink, calls };
};

const makePreloader = () => {
  const held = new Map<string, SegmentAudio>();
  const preloader: AudioPreloader = {
    hold: (id, audio) => held.set(id, audio),
    take: (id) => {
      const audio = held.get(id);
      held.delete(id);
      return audio;
    },
    clear: () => held.clear(),
  };
  return { preloader, held };
};

const audioFor = (segmentId: string): SegmentAudio => ({
  segmentId,
  bytes: new ArrayBuffer(8),
  durationMs: 1000,
  timings: [timing('một')],
  timingSource: 'phoneme',
});

const setup = (
  segments: Segment[],
  options: {
    canGenerate?: boolean;
    /** Segment nào `getSegmentAudio` trả về undefined (NOT_FOUND) */
    missingAudio?: string[];
  } = {},
) => {
  const { sink, calls } = makeSink();
  const { preloader, held } = makePreloader();

  const list = [...segments];
  const changed: string[] = [];
  const enqueued: string[][] = [];
  const fetched: string[] = [];

  const fetchAudio = vi.fn(async (segmentId: string) => {
    fetched.push(segmentId);
    if (options.missingAudio?.includes(segmentId) === true) return undefined;
    return audioFor(segmentId);
  });

  const enqueueUrgent = vi.fn(async (ids: string[]) => {
    enqueued.push(ids);
  });

  attachPlayer({
    sink,
    preloader,
    getSegments: () => list,
    canGenerate: () => options.canGenerate ?? true,
    onSegmentChanged: (id) => changed.push(id),
    fetchAudio,
    enqueueUrgent,
  });

  /** Đổi trạng thái một segment như hàng đợi làm */
  const setStatus = (id: string, status: SegmentStatus, errorMessage?: string): Segment => {
    const index = list.findIndex((s) => s.id === id);
    // `exactOptionalPropertyTypes`: chỉ gắn `errorMessage` khi thật sự có, chứ
    // không gán `undefined` — đúng cách repository thật dựng `Segment`.
    const next: Segment = {
      ...(list[index] as Segment),
      status,
      ...(errorMessage === undefined ? {} : { errorMessage }),
    };
    list[index] = next;
    return next;
  };

  return { sink, calls, preloader, held, changed, enqueued, fetched, fetchAudio, setStatus, list };
};

beforeEach(() => {
  detachPlayer();
  usePlayerStore.setState({
    state: 'idle',
    segmentId: null,
    timings: [],
    durationMs: 0,
    playbackRate: 1,
    skipped: [],
    error: null,
  });
});

describe('phát segment thường', () => {
  it('phát segment ready và báo cho trình đọc', async () => {
    const { calls, changed } = setup([seg('a', 'ready'), seg('b', 'ready')]);

    await usePlayerStore.getState().playFrom('a');

    expect(usePlayerStore.getState().state).toBe('playing');
    expect(usePlayerStore.getState().segmentId).toBe('a');
    expect(changed).toEqual(['a']);
    expect(calls).toContain('play@0');
  });

  it('nạp timing của segment đang phát cho subtitle', async () => {
    setup([seg('a', 'ready')]);
    await usePlayerStore.getState().playFrom('a');

    expect(usePlayerStore.getState().timings).toEqual([timing('một')]);
    expect(usePlayerStore.getState().durationMs).toBe(1000);
  });

  it('hết segment thì tự sang segment kế — nghe liên tục', async () => {
    const { changed } = setup([seg('a', 'ready'), seg('b', 'ready')]);

    await usePlayerStore.getState().playFrom('a');
    await usePlayerStore.getState().handleEnded();

    expect(usePlayerStore.getState().segmentId).toBe('b');
    expect(usePlayerStore.getState().state).toBe('playing');
    expect(changed).toEqual(['a', 'b']);
  });

  it('hết chương thì dừng sạch, không treo', async () => {
    const { calls } = setup([seg('a', 'ready')]);

    await usePlayerStore.getState().playFrom('a');
    await usePlayerStore.getState().handleEnded();

    expect(usePlayerStore.getState().state).toBe('idle');
    expect(usePlayerStore.getState().segmentId).toBeNull();
    expect(calls).toContain('pause');
  });

  it('nạp trước segment kế ngay khi bắt đầu phát — xoá khoảng hụt giữa hai câu', async () => {
    const { held } = setup([seg('a', 'ready'), seg('b', 'ready')]);

    await usePlayerStore.getState().playFrom('a');

    expect(held.has('b')).toBe(true);
  });

  it('dùng bytes nạp sẵn thì KHÔNG gọi IPC lần nữa — kể cả để lấy timing', async () => {
    // Kho giữ cả SegmentAudio; gọi thêm một lượt là thêm đúng quãng trễ mà việc
    // nạp trước sinh ra để xoá bỏ
    const { fetched } = setup([seg('a', 'ready'), seg('b', 'ready')]);

    await usePlayerStore.getState().playFrom('a');
    expect(fetched).toEqual(['a', 'b']); // a để phát, b nạp trước

    await usePlayerStore.getState().handleEnded();

    // Phát `b` không thêm lượt gọi nào cho `b`
    expect(fetched.filter((id) => id === 'b')).toHaveLength(1);
    expect(usePlayerStore.getState().timings).toEqual([timing('một')]);
  });

  it('nạp trước bỏ qua đoạn hỏng để giữ đúng thứ sẽ phát thật', async () => {
    const { held } = setup([seg('a', 'ready'), seg('b', 'error'), seg('c', 'ready')]);

    await usePlayerStore.getState().playFrom('a');

    expect(held.has('c')).toBe(true);
    expect(held.has('b')).toBe(false);
  });
});

describe('BỎ QUA đoạn hỏng — không làm gián đoạn', () => {
  it('bấm phát vào đoạn lỗi thì nhảy thẳng tới đoạn phát được', async () => {
    const { changed } = setup([seg('a', 'error'), seg('b', 'ready')]);

    await usePlayerStore.getState().playFrom('a');

    expect(usePlayerStore.getState().state).toBe('playing');
    expect(usePlayerStore.getState().segmentId).toBe('b');
    expect(changed).toEqual(['b']);
  });

  it('gặp đoạn lỗi giữa chương thì đi tiếp, KHÔNG dừng và KHÔNG báo lỗi chặn', async () => {
    const { calls } = setup([seg('a', 'ready'), seg('b', 'error'), seg('c', 'ready')]);

    await usePlayerStore.getState().playFrom('a');
    await usePlayerStore.getState().handleEnded();

    const state = usePlayerStore.getState();
    expect(state.state).toBe('playing');
    expect(state.segmentId).toBe('c');
    // `error` là lỗi CHẶN NGHE — đoạn hỏng lẻ không được vào đây
    expect(state.error).toBeNull();
    expect(calls.filter((c) => c === 'pause')).toHaveLength(0);
  });

  it('ghi lại đoạn đã bỏ qua để hiện cho user, kèm lý do thật', async () => {
    setup([
      seg('a', 'ready'),
      seg('b', 'error', { errorMessage: 'Piper từ chối' }),
      seg('c', 'ready'),
    ]);

    await usePlayerStore.getState().playFrom('a');
    await usePlayerStore.getState().handleEnded();

    expect(usePlayerStore.getState().skipped).toEqual([
      { segmentId: 'b', index: 1, reason: 'Piper từ chối' },
    ]);
  });

  it('mười đoạn hỏng liên tiếp vẫn phát tiếp được, không cần mười lượt', async () => {
    const segments = [
      seg('start', 'ready'),
      ...Array.from({ length: 10 }, (_, i) => seg(`bad-${String(i)}`, 'error')),
      seg('good', 'ready'),
    ];
    setup(segments);

    await usePlayerStore.getState().playFrom('start');
    await usePlayerStore.getState().handleEnded();

    expect(usePlayerStore.getState().segmentId).toBe('good');
    expect(usePlayerStore.getState().state).toBe('playing');
    expect(usePlayerStore.getState().skipped).toHaveLength(10);
  });

  it('đoạn không có chữ để đọc cũng bỏ qua, không xếp hàng đợi', async () => {
    const { enqueued } = setup([
      seg('a', 'ready'),
      seg('b', 'pending', { text: '...' }),
      seg('c', 'ready'),
    ]);

    await usePlayerStore.getState().playFrom('a');
    await usePlayerStore.getState().handleEnded();

    expect(usePlayerStore.getState().segmentId).toBe('c');
    expect(enqueued.flat()).not.toContain('b');
  });

  it('file .ogg hỏng lúc giải mã cũng chỉ là bỏ qua, nhạc không đứt', async () => {
    // DB nói `ready`, IPC trả bytes — chỉ Chromium mới biết file cụt
    setup([seg('a', 'ready'), seg('b', 'ready')]);

    await usePlayerStore.getState().playFrom('a');
    await usePlayerStore.getState().handleAudioError('File audio hỏng, không giải mã được.');

    const state = usePlayerStore.getState();
    expect(state.state).toBe('playing');
    expect(state.segmentId).toBe('b');
    expect(state.error).toBeNull();
    expect(state.skipped[0]?.reason).toBe('File audio hỏng, không giải mã được.');
  });

  it('audio bị Storage Manager xoá dưới chân player thì bỏ qua, không dừng', async () => {
    // DB vẫn `ready` nhưng getSegmentAudio trả NOT_FOUND
    setup([seg('a', 'ready'), seg('b', 'ready')], { missingAudio: ['a'] });

    await usePlayerStore.getState().playFrom('a');

    const state = usePlayerStore.getState();
    expect(state.state).toBe('playing');
    expect(state.segmentId).toBe('b');
    expect(state.skipped[0]).toEqual({
      segmentId: 'a',
      index: 0,
      reason: 'file audio không còn',
    });
  });

  it('đuôi chương toàn đoạn hỏng thì dừng sạch và vẫn ghi lại đã bỏ gì', async () => {
    setup([seg('a', 'ready'), seg('b', 'error'), seg('c', 'error')]);

    await usePlayerStore.getState().playFrom('a');
    await usePlayerStore.getState().handleEnded();

    expect(usePlayerStore.getState().state).toBe('idle');
    expect(usePlayerStore.getState().skipped.map((s) => s.segmentId)).toEqual(['b', 'c']);
  });

  it('cả chương không có gì phát được thì về idle, không treo ở waiting', async () => {
    setup([seg('a', 'error'), seg('b', 'error')]);

    await usePlayerStore.getState().playFrom('a');

    expect(usePlayerStore.getState().state).toBe('idle');
    expect(usePlayerStore.getState().segmentId).toBeNull();
  });
});

describe('chờ audio chưa sinh xong', () => {
  it('segment pending thì xếp ưu tiên rồi chờ, nói rõ đang chờ', async () => {
    const { enqueued } = setup([seg('a', 'pending')]);

    await usePlayerStore.getState().playFrom('a');

    expect(usePlayerStore.getState().state).toBe('waiting');
    expect(usePlayerStore.getState().segmentId).toBe('a');
    expect(enqueued[0]).toEqual(['a']);
  });

  it('segment đang generate thì chỉ chờ, KHÔNG xếp lại', async () => {
    const { enqueued } = setup([seg('a', 'generating')]);

    await usePlayerStore.getState().playFrom('a');

    expect(usePlayerStore.getState().state).toBe('waiting');
    expect(enqueued.flat()).not.toContain('a');
  });

  it('hàng đợi báo xong thì phát ngay, không cần user bấm lại', async () => {
    const { setStatus } = setup([seg('a', 'pending')]);

    await usePlayerStore.getState().playFrom('a');
    expect(usePlayerStore.getState().state).toBe('waiting');

    const ready = setStatus('a', 'ready');
    await usePlayerStore.getState().handleSegmentUpdate(ready);

    expect(usePlayerStore.getState().state).toBe('playing');
    expect(usePlayerStore.getState().segmentId).toBe('a');
  });

  it('thứ đang chờ hỏng hẳn thì bỏ qua và đi tiếp — không bắt chờ mãi', async () => {
    const { setStatus } = setup([seg('a', 'pending'), seg('b', 'ready')]);

    await usePlayerStore.getState().playFrom('a');
    const failed = setStatus('a', 'error', 'hết lượt thử');
    await usePlayerStore.getState().handleSegmentUpdate(failed);

    const state = usePlayerStore.getState();
    expect(state.state).toBe('playing');
    expect(state.segmentId).toBe('b');
    expect(state.skipped[0]?.reason).toBe('hết lượt thử');
  });

  it('phát ngay cả khi danh sách segment CHƯA kịp cập nhật', async () => {
    // Lỗi thật (PROGRESS 4.53): main đẩy `queue:segmentUpdated`, `reader-store`
    // nhận và React render lại, nhưng player được gọi trong cùng lượt đó nên
    // `getSegments()` vẫn trả danh sách cũ. Tin nó là đứng chờ mãi dù audio đã có.
    const { list } = setup([seg('a', 'pending')]);

    await usePlayerStore.getState().playFrom('a');
    expect(usePlayerStore.getState().state).toBe('waiting');

    // Cố ý KHÔNG sửa `list` — mô phỏng đúng ca danh sách còn cũ
    await usePlayerStore.getState().handleSegmentUpdate({
      ...(list[0] as Segment),
      status: 'ready',
    });

    expect(usePlayerStore.getState().state).toBe('playing');
    expect(usePlayerStore.getState().segmentId).toBe('a');
  });

  it('bỏ qua cập nhật của segment KHÁC cái đang chờ', async () => {
    const { setStatus } = setup([seg('a', 'pending'), seg('b', 'ready')]);

    await usePlayerStore.getState().playFrom('a');
    await usePlayerStore.getState().handleSegmentUpdate(setStatus('b', 'ready'));

    expect(usePlayerStore.getState().state).toBe('waiting');
    expect(usePlayerStore.getState().segmentId).toBe('a');
  });

  it('cập nhật queued/generating thì vẫn chờ tiếp', async () => {
    const { setStatus } = setup([seg('a', 'pending')]);

    await usePlayerStore.getState().playFrom('a');
    await usePlayerStore.getState().handleSegmentUpdate(setStatus('a', 'generating'));

    expect(usePlayerStore.getState().state).toBe('waiting');
  });

  it('không tạo được audio (chưa chọn giọng) thì bỏ qua chứ không chờ vô hạn', async () => {
    setup([seg('a', 'pending'), seg('b', 'ready')], { canGenerate: false });

    await usePlayerStore.getState().playFrom('a');

    expect(usePlayerStore.getState().state).toBe('playing');
    expect(usePlayerStore.getState().segmentId).toBe('b');
  });

  it('không tạo được audio và không có đoạn nào ready thì về idle', async () => {
    setup([seg('a', 'pending'), seg('b', 'pending')], { canGenerate: false });

    await usePlayerStore.getState().playFrom('a');

    expect(usePlayerStore.getState().state).toBe('idle');
  });
});

describe('xếp trước hàng đợi', () => {
  it('xếp vài segment phía trước để hàng đợi đi trước đầu phát', async () => {
    const segments = [
      seg('a', 'ready'),
      ...Array.from({ length: 8 }, (_, i) => seg(`p${String(i)}`, 'pending')),
    ];
    const { enqueued } = setup(segments);

    await usePlayerStore.getState().playFrom('a');

    // PLAYBACK_LOOKAHEAD_SEGMENTS = 5
    expect(enqueued.flat()).toEqual(['p0', 'p1', 'p2', 'p3', 'p4']);
  });

  it('không xếp gì khi mọi segment phía trước đã có audio', async () => {
    const { enqueued } = setup([seg('a', 'ready'), seg('b', 'ready')]);

    await usePlayerStore.getState().playFrom('a');

    expect(enqueued).toEqual([]);
  });

  it('không xếp khi chưa chọn giọng', async () => {
    const { enqueued } = setup([seg('a', 'ready'), seg('b', 'pending')], { canGenerate: false });

    await usePlayerStore.getState().playFrom('a');

    expect(enqueued).toEqual([]);
  });
});

describe('điều khiển', () => {
  it('toggle tạm dừng rồi phát tiếp, không nạp lại từ đầu', async () => {
    const { calls, fetched } = setup([seg('a', 'ready')]);

    await usePlayerStore.getState().playFrom('a');
    const loadsAfterPlay = fetched.length;

    await usePlayerStore.getState().toggle();
    expect(usePlayerStore.getState().state).toBe('paused');
    expect(calls).toContain('pause');

    await usePlayerStore.getState().toggle();
    expect(usePlayerStore.getState().state).toBe('playing');
    expect(calls).toContain('resume');
    // Phát tiếp KHÔNG được tải lại file — mất vị trí đang nghe
    expect(fetched).toHaveLength(loadsAfterPlay);
  });

  it('toggle lúc idle thì phát từ đầu chương', async () => {
    setup([seg('a', 'ready'), seg('b', 'ready')]);

    await usePlayerStore.getState().toggle();

    expect(usePlayerStore.getState().segmentId).toBe('a');
    expect(usePlayerStore.getState().state).toBe('playing');
  });

  it('toggle lúc đang chờ thì thành tạm dừng, nút không chết', async () => {
    setup([seg('a', 'pending')]);

    await usePlayerStore.getState().playFrom('a');
    await usePlayerStore.getState().toggle();

    expect(usePlayerStore.getState().state).toBe('paused');
  });

  it('đang chờ mà user tạm dừng thì cập nhật của hàng đợi không tự phát nữa', async () => {
    const { setStatus } = setup([seg('a', 'pending')]);

    await usePlayerStore.getState().playFrom('a');
    await usePlayerStore.getState().toggle();
    await usePlayerStore.getState().handleSegmentUpdate(setStatus('a', 'ready'));

    expect(usePlayerStore.getState().state).toBe('paused');
  });

  it('next nhảy sang segment kế và bỏ qua đoạn hỏng', async () => {
    setup([seg('a', 'ready'), seg('b', 'error'), seg('c', 'ready')]);

    await usePlayerStore.getState().playFrom('a');
    await usePlayerStore.getState().next();

    expect(usePlayerStore.getState().segmentId).toBe('c');
  });

  it('previous lùi về đoạn phát được, bỏ qua đoạn hỏng theo chiều ngược', async () => {
    setup([seg('a', 'ready'), seg('b', 'error'), seg('c', 'ready')]);

    await usePlayerStore.getState().playFrom('c');
    await usePlayerStore.getState().previous();

    expect(usePlayerStore.getState().segmentId).toBe('a');
  });

  it('previous ở đoạn đầu thì quay về đầu đoạn, không làm nút chết', async () => {
    const { calls } = setup([seg('a', 'ready')]);

    await usePlayerStore.getState().playFrom('a');
    await usePlayerStore.getState().previous();

    expect(calls).toContain('seek@0');
    expect(usePlayerStore.getState().segmentId).toBe('a');
  });

  it('previous khi phía trước toàn đoạn hỏng thì về đầu đoạn hiện tại', async () => {
    const { calls } = setup([seg('a', 'error'), seg('b', 'ready')]);

    await usePlayerStore.getState().playFrom('b');
    await usePlayerStore.getState().previous();

    expect(usePlayerStore.getState().segmentId).toBe('b');
    expect(calls).toContain('seek@0');
  });

  it('seek chuyển thẳng xuống sink', () => {
    const { calls } = setup([seg('a', 'ready')]);
    usePlayerStore.getState().seek(1234);
    expect(calls).toContain('seek@1234');
  });

  it('đổi tốc độ KHÔNG tải lại audio — dùng playbackRate', async () => {
    const { calls, fetched } = setup([seg('a', 'ready')]);

    await usePlayerStore.getState().playFrom('a');
    const before = fetched.length;

    await usePlayerStore.getState().setRate(1.5);

    expect(usePlayerStore.getState().playbackRate).toBe(1.5);
    expect(calls).toContain('rate=1.5');
    expect(fetched).toHaveLength(before);
  });

  it('kẹp tốc độ trong 0.5–2.0', async () => {
    setup([seg('a', 'ready')]);

    await usePlayerStore.getState().setRate(5);
    expect(usePlayerStore.getState().playbackRate).toBe(2);

    await usePlayerStore.getState().setRate(0.1);
    expect(usePlayerStore.getState().playbackRate).toBe(0.5);
  });

  it('tốc độ đã đặt được áp cho segment kế', async () => {
    const { calls } = setup([seg('a', 'ready'), seg('b', 'ready')]);

    await usePlayerStore.getState().setRate(1.5);
    await usePlayerStore.getState().playFrom('a');
    await usePlayerStore.getState().handleEnded();

    expect(calls.filter((c) => c === 'rate=1.5').length).toBeGreaterThanOrEqual(2);
  });

  it('reset nhả Blob URL và quên hết', async () => {
    const { calls, held } = setup([seg('a', 'ready'), seg('b', 'ready')]);

    await usePlayerStore.getState().playFrom('a');
    usePlayerStore.getState().reset();

    expect(calls).toContain('dispose');
    expect(held.size).toBe(0);
    expect(usePlayerStore.getState().state).toBe('idle');
    expect(usePlayerStore.getState().skipped).toEqual([]);
  });
});

describe('sự kiện tới muộn', () => {
  it('ended của lượt cũ tới sau khi đã tạm dừng thì không tự phát tiếp', async () => {
    setup([seg('a', 'ready'), seg('b', 'ready')]);

    await usePlayerStore.getState().playFrom('a');
    usePlayerStore.getState().pause();
    await usePlayerStore.getState().handleEnded();

    expect(usePlayerStore.getState().state).toBe('paused');
    expect(usePlayerStore.getState().segmentId).toBe('a');
  });

  it('lỗi audio tới khi đã tạm dừng thì không nhảy segment', async () => {
    setup([seg('a', 'ready'), seg('b', 'ready')]);

    await usePlayerStore.getState().playFrom('a');
    usePlayerStore.getState().pause();
    await usePlayerStore.getState().handleAudioError('hỏng');

    expect(usePlayerStore.getState().segmentId).toBe('a');
  });

  it('không có deps thì mọi lệnh im lặng, không ném', async () => {
    detachPlayer();

    await expect(usePlayerStore.getState().playFrom('a')).resolves.toBeUndefined();
    await expect(usePlayerStore.getState().next()).resolves.toBeUndefined();
    expect(() => {
      usePlayerStore.getState().reset();
    }).not.toThrow();
  });
});
