import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SegmentAudio } from '@ln/shared';
import { createAudioPreloader, createAudioSink } from './audio-element.js';

/**
 * jsdom **không phát audio**: `play()` không tồn tại sẵn, `currentTime` không tự
 * chạy, `ended` không bao giờ nổ. Nên ở đây không kiểm "có nghe thấy không" —
 * kiểm những thứ jsdom **có** làm được và là chỗ dễ hỏng nhất:
 *
 * - Blob URL có được thu hồi không (rò 30 KB mỗi câu là ~40 MB một chương)
 * - `preservesPitch` có được bật không (CLAUDE.md: đổi tốc độ ≠ regenerate)
 * - Lượt phát cũ trả về muộn có ghi đè lượt mới không
 */

const created: string[] = [];
const revoked: string[] = [];

beforeEach(() => {
  created.length = 0;
  revoked.length = 0;

  let counter = 0;
  URL.createObjectURL = vi.fn(() => {
    counter += 1;
    const url = `blob:test/${String(counter)}`;
    created.push(url);
    return url;
  });
  URL.revokeObjectURL = vi.fn((url: string) => {
    revoked.push(url);
  });
});

/**
 * Thẻ audio jsdom + `play`/`pause`/`load` giả.
 *
 * jsdom không cài đặt cả ba: `play` không tồn tại, `pause` và `load` ném
 * "Not implemented". Không phải lỗi của ta — chỉ là jsdom không phát audio, đúng
 * lý do `AudioSink` tồn tại như một interface.
 */
const makeElement = (): HTMLAudioElement => {
  const element = document.createElement('audio');
  element.play = vi.fn(async () => undefined);
  element.pause = vi.fn();
  element.load = vi.fn();
  return element;
};

const events = () => ({ onEnded: vi.fn(), onError: vi.fn() });

describe('createAudioSink — Blob URL', () => {
  it('tạo Blob URL khi phát', async () => {
    const sink = createAudioSink(makeElement(), events());
    await sink.play(new ArrayBuffer(8), 0);

    expect(created).toHaveLength(1);
    expect(revoked).toHaveLength(0);
  });

  it('THU HỒI url cũ khi phát segment mới — không rò 30 KB mỗi câu', async () => {
    const sink = createAudioSink(makeElement(), events());

    await sink.play(new ArrayBuffer(8), 0);
    await sink.play(new ArrayBuffer(8), 0);
    await sink.play(new ArrayBuffer(8), 0);

    expect(created).toHaveLength(3);
    // Hai url đầu đã nhả; url đang phát thì chưa
    expect(revoked).toEqual([created[0], created[1]]);
  });

  it('dispose nhả nốt url đang dùng', async () => {
    const sink = createAudioSink(makeElement(), events());

    await sink.play(new ArrayBuffer(8), 0);
    sink.dispose();

    expect(revoked).toEqual(created);
  });

  it('dispose lúc chưa phát gì thì không nhả nhầm', () => {
    const sink = createAudioSink(makeElement(), events());
    sink.dispose();

    expect(revoked).toHaveLength(0);
  });

  it('dispose bỏ luôn src để Chromium nhả bộ đệm giải mã', async () => {
    const element = makeElement();
    const sink = createAudioSink(element, events());

    await sink.play(new ArrayBuffer(8), 0);
    sink.dispose();

    expect(element.getAttribute('src')).toBeNull();
  });
});

describe('createAudioSink — tốc độ', () => {
  it('bật preservesPitch: đổi tốc độ KHÔNG cần regenerate audio', () => {
    const element = makeElement();
    const sink = createAudioSink(element, events());

    sink.setRate(1.5);

    expect(element.playbackRate).toBe(1.5);
    expect(element.preservesPitch).toBe(true);
  });
});

describe('createAudioSink — vị trí', () => {
  it('seek kẹp về 0 với giá trị âm', () => {
    const element = makeElement();
    const sink = createAudioSink(element, events());

    sink.seek(-500);
    expect(element.currentTime).toBe(0);
  });

  it('positionMs đổi giây sang mili-giây', () => {
    const element = makeElement();
    const sink = createAudioSink(element, events());

    element.currentTime = 2.5;
    expect(sink.positionMs()).toBe(2500);
  });
});

describe('createAudioSink — sự kiện', () => {
  it('ended của thẻ audio đi tới listener', () => {
    const element = makeElement();
    const handlers = events();
    createAudioSink(element, handlers);

    element.dispatchEvent(new Event('ended'));

    expect(handlers.onEnded).toHaveBeenCalledOnce();
  });

  it('error của thẻ audio đi tới listener kèm câu tiếng Việt', () => {
    const element = makeElement();
    const handlers = events();
    createAudioSink(element, handlers);

    element.dispatchEvent(new Event('error'));

    expect(handlers.onError).toHaveBeenCalledOnce();
    expect(handlers.onError.mock.calls[0]?.[0]).toMatch(/không phát được|hỏng|không đọc được/i);
  });

  it('error KHÔNG kèm MediaError vẫn báo được, không ném trong listener', () => {
    // Ném ở đây thì không ai bắt được, mà player mất luôn đường bỏ qua đoạn hỏng.
    // jsdom để `element.error` là `undefined`; chuẩn nói `null`. Phải chịu cả hai.
    const element = makeElement();
    const handlers = events();
    createAudioSink(element, handlers);

    for (const value of [null, undefined]) {
      Object.defineProperty(element, 'error', { value, configurable: true });
      expect(() => element.dispatchEvent(new Event('error'))).not.toThrow();
    }

    expect(handlers.onError).toHaveBeenCalledTimes(2);
    expect(handlers.onError).toHaveBeenLastCalledWith('Không phát được đoạn này.');
  });

  it('mỗi mã MediaError cho một câu riêng, không đọc qua global MediaError', () => {
    // `MediaError` là constructor toàn cục và **không có** ở mọi môi trường
    // (jsdom thiếu hẳn). Chạm vào trong listener là ReferenceError không ai bắt
    // được. Test này chạy được chính là bằng chứng source không chạm nó.
    const cases: [number, string][] = [
      [1, 'Lượt phát bị huỷ giữa chừng.'],
      [2, 'Không đọc được dữ liệu audio.'],
      [3, 'File audio hỏng, không giải mã được.'],
      [4, 'Định dạng audio không được hỗ trợ.'],
      [99, 'Không phát được đoạn này.'],
    ];

    for (const [code, expected] of cases) {
      const element = makeElement();
      const handlers = events();
      createAudioSink(element, handlers);

      Object.defineProperty(element, 'error', { value: { code }, configurable: true });
      element.dispatchEvent(new Event('error'));

      expect(handlers.onError).toHaveBeenCalledWith(expected);
    }
  });

  it('play bị chặn autoplay thì báo lỗi có hướng dẫn, không im lặng', async () => {
    const element = makeElement();
    element.play = vi.fn(async () => {
      throw new DOMException('blocked', 'NotAllowedError');
    });
    const handlers = events();
    const sink = createAudioSink(element, handlers);

    await sink.play(new ArrayBuffer(8), 0);

    expect(handlers.onError).toHaveBeenCalledWith(
      'Trình duyệt chặn phát tự động. Hãy bấm nút phát.',
    );
  });

  it('AbortError (nguồn bị thay giữa chừng) KHÔNG phải lỗi — chính ta vừa thay', async () => {
    const element = makeElement();
    element.play = vi.fn(async () => {
      throw new DOMException('aborted', 'AbortError');
    });
    const handlers = events();
    const sink = createAudioSink(element, handlers);

    await sink.play(new ArrayBuffer(8), 0);

    expect(handlers.onError).not.toHaveBeenCalled();
  });
});

describe('createAudioPreloader', () => {
  const audio = (segmentId: string): SegmentAudio => ({
    segmentId,
    bytes: new ArrayBuffer(4),
    durationMs: 500,
    timings: [],
    timingSource: 'estimate',
  });

  it('trả lại đúng segment đang giữ', () => {
    const preloader = createAudioPreloader();
    preloader.hold('a', audio('a'));

    expect(preloader.take('a')?.segmentId).toBe('a');
  });

  it('lấy ra rồi thì không còn giữ — không trả nhầm lần hai', () => {
    const preloader = createAudioPreloader();
    preloader.hold('a', audio('a'));

    preloader.take('a');
    expect(preloader.take('a')).toBeUndefined();
  });

  it('hỏi segment khác thì trả undefined, không trả nhầm audio', () => {
    const preloader = createAudioPreloader();
    preloader.hold('a', audio('a'));

    expect(preloader.take('b')).toBeUndefined();
    // Vẫn giữ `a` — hỏi nhầm không được làm mất thứ đang giữ
    expect(preloader.take('a')?.segmentId).toBe('a');
  });

  it('chỉ giữ MỘT segment — giữ cái mới là bỏ cái cũ', () => {
    const preloader = createAudioPreloader();
    preloader.hold('a', audio('a'));
    preloader.hold('b', audio('b'));

    expect(preloader.take('a')).toBeUndefined();
    expect(preloader.take('b')?.segmentId).toBe('b');
  });

  it('clear bỏ hết', () => {
    const preloader = createAudioPreloader();
    preloader.hold('a', audio('a'));
    preloader.clear();

    expect(preloader.take('a')).toBeUndefined();
  });
});
