import { describe, expect, it } from 'vitest';
import { estimateWordTimings, seekMsForChar, splitWords, wordIndexAt } from './timings.js';
import type { WordTiming } from './types.js';

describe('splitWords', () => {
  it('tách theo khoảng trắng và giữ đúng vị trí ký tự', () => {
    const words = splitWords('Chào bạn nhé');

    expect(words).toEqual([
      { w: 'Chào', charStart: 0, charEnd: 4 },
      { w: 'bạn', charStart: 5, charEnd: 8 },
      { w: 'nhé', charStart: 9, charEnd: 12 },
    ]);
  });

  it('vị trí ký tự cắt lại đúng từ trong chuỗi gốc', () => {
    const text = '  Hôm   nay trời đẹp  ';

    for (const word of splitWords(text)) {
      expect(text.slice(word.charStart, word.charEnd)).toBe(word.w);
    }
  });

  it('gộp nhiều khoảng trắng liên tiếp thành một ranh giới', () => {
    expect(splitWords('a\t\tb\n c').map((w) => w.w)).toEqual(['a', 'b', 'c']);
  });

  it('bắt được từ cuối cùng khi không có khoảng trắng đuôi', () => {
    const words = splitWords('một hai');
    expect(words.at(-1)).toEqual({ w: 'hai', charStart: 4, charEnd: 7 });
  });

  it('giữ nguyên dấu nối và dấu nháy trong một từ', () => {
    // `\w+` sẽ cắt hai từ này làm đôi — highlight nhảy giữa thân từ
    expect(splitWords("Wi-Fi John's").map((w) => w.w)).toEqual(['Wi-Fi', "John's"]);
  });

  it('giữ nguyên chữ có dấu tiếng Việt', () => {
    expect(splitWords('nghiêng ngả').map((w) => w.w)).toEqual(['nghiêng', 'ngả']);
  });

  it('chuỗi rỗng hoặc toàn khoảng trắng cho mảng rỗng', () => {
    expect(splitWords('')).toEqual([]);
    expect(splitWords('   \n\t ')).toEqual([]);
  });
});

describe('estimateWordTimings', () => {
  it('mốc liền mạch, không để hở giữa hai từ', () => {
    const timings = estimateWordTimings('một hai ba bốn', 4000);

    for (let i = 0; i < timings.length - 1; i += 1) {
      expect((timings[i] as WordTiming).endMs).toBe((timings[i + 1] as WordTiming).startMs);
    }
  });

  it('từ đầu bắt đầu ở 0 và từ cuối kết thúc đúng durationMs', () => {
    const timings = estimateWordTimings('một hai ba', 3333);

    expect(timings[0]?.startMs).toBe(0);
    expect(timings.at(-1)?.endMs).toBe(3333);
  });

  it('từ dài được nhiều thời gian hơn từ ngắn', () => {
    const [short, long] = estimateWordTimings('Ừ nghiêng', 2000);

    const shortMs = (short as WordTiming).endMs - (short as WordTiming).startMs;
    const longMs = (long as WordTiming).endMs - (long as WordTiming).startMs;
    expect(longMs).toBeGreaterThan(shortMs);
  });

  it('từ một ký tự vẫn không ngắn tới mức tỉ lệ thuần theo độ dài', () => {
    // Không có `WORD_BASE_WEIGHT` thì tỉ lệ là 1:8; có rồi thì phải đỡ hơn nhiều
    const [short, long] = estimateWordTimings('a abcdefgh', 10_000);

    const shortMs = (short as WordTiming).endMs - (short as WordTiming).startMs;
    const longMs = (long as WordTiming).endMs - (long as WordTiming).startMs;
    expect(longMs / shortMs).toBeLessThan(4);
  });

  it('charStart/charEnd trỏ đúng vào text gốc', () => {
    const text = 'Chào bạn nhé';

    for (const timing of estimateWordTimings(text, 1200)) {
      expect(text.slice(timing.charStart, timing.charEnd)).toBe(timing.w);
    }
  });

  it('durationMs bằng 0 hoặc âm cho mảng rỗng, không phải mảng mốc 0', () => {
    expect(estimateWordTimings('có chữ đây', 0)).toEqual([]);
    expect(estimateWordTimings('có chữ đây', -5)).toEqual([]);
  });

  it('text rỗng cho mảng rỗng dù có durationMs', () => {
    expect(estimateWordTimings('   ', 5000)).toEqual([]);
  });

  it('một từ duy nhất chiếm trọn segment', () => {
    expect(estimateWordTimings('một', 800)).toEqual([
      { w: 'một', startMs: 0, endMs: 800, charStart: 0, charEnd: 3 },
    ]);
  });

  it('sinh ra mảng mà wordIndexAt tra được ở mọi mốc trong khoảng', () => {
    const timings = estimateWordTimings('một hai ba bốn năm', 5000);

    // Không mốc nào trong [0, duration) rơi vào khe trống
    for (let ms = 0; ms < 5000; ms += 50) {
      expect(wordIndexAt(timings, ms)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('wordIndexAt', () => {
  const timings: WordTiming[] = [
    { w: 'một', startMs: 0, endMs: 400, charStart: 0, charEnd: 3 },
    { w: 'hai', startMs: 400, endMs: 900, charStart: 4, charEnd: 7 },
    { w: 'ba', startMs: 900, endMs: 1500, charStart: 8, charEnd: 10 },
  ];

  it('trả đúng từ tại mốc giữa khoảng', () => {
    expect(wordIndexAt(timings, 200)).toBe(0);
    expect(wordIndexAt(timings, 600)).toBe(1);
    expect(wordIndexAt(timings, 1200)).toBe(2);
  });

  it('mốc trùng startMs thuộc về từ bắt đầu tại đó', () => {
    expect(wordIndexAt(timings, 0)).toBe(0);
    expect(wordIndexAt(timings, 400)).toBe(1);
    expect(wordIndexAt(timings, 900)).toBe(2);
  });

  it('mảng rỗng trả -1', () => {
    expect(wordIndexAt([], 100)).toBe(-1);
  });

  it('trước từ đầu tiên trả -1', () => {
    const delayed: WordTiming[] = [{ w: 'a', startMs: 300, endMs: 800, charStart: 0, charEnd: 1 }];
    expect(wordIndexAt(delayed, 100)).toBe(-1);
  });

  it('quá endMs của từ cuối trả -1 — không giữ highlight ở khoảng lặng đuôi', () => {
    expect(wordIndexAt(timings, 1500)).toBe(2);
    expect(wordIndexAt(timings, 1501)).toBe(-1);
    expect(wordIndexAt(timings, 9000)).toBe(-1);
  });

  it('giữ từ vừa đọc khi rơi vào khe im lặng giữa hai từ phoneme', () => {
    // Timing từ phoneme có khe thật: 400→600 không thuộc từ nào
    const gapped: WordTiming[] = [
      { w: 'một', startMs: 0, endMs: 400, charStart: 0, charEnd: 3 },
      { w: 'hai', startMs: 600, endMs: 1000, charStart: 4, charEnd: 7 },
    ];

    expect(wordIndexAt(gapped, 500)).toBe(0);
  });

  it('cho cùng kết quả với quét tuyến tính trên mảng dài', () => {
    const long = estimateWordTimings(
      Array.from({ length: 60 }, (_, i) => `từ${i}`).join(' '),
      30_000,
    );

    const linear = (ms: number): number => {
      let index = -1;
      for (let i = 0; i < long.length; i += 1) {
        if ((long[i] as WordTiming).startMs <= ms) index = i;
      }
      const last = long.at(-1) as WordTiming;
      return index === long.length - 1 && ms > last.endMs ? -1 : index;
    };

    for (let ms = -100; ms <= 30_500; ms += 137) {
      expect(wordIndexAt(long, ms)).toBe(linear(ms));
    }
  });
});

describe('seekMsForChar', () => {
  const timings: WordTiming[] = [
    { w: 'một', startMs: 0, endMs: 400, charStart: 0, charEnd: 3 },
    { w: 'hai', startMs: 400, endMs: 900, charStart: 4, charEnd: 7 },
    { w: 'ba', startMs: 900, endMs: 1500, charStart: 8, charEnd: 10 },
  ];

  it('trả mốc bắt đầu của từ chứa ký tự đó', () => {
    expect(seekMsForChar(timings, 1)).toBe(0);
    expect(seekMsForChar(timings, 5)).toBe(400);
    expect(seekMsForChar(timings, 9)).toBe(900);
  });

  it('bấm vào khoảng trắng trả về từ đứng trước', () => {
    expect(seekMsForChar(timings, 3)).toBe(0);
    expect(seekMsForChar(timings, 7)).toBe(400);
  });

  it('ký tự sau từ cuối trả về từ cuối', () => {
    expect(seekMsForChar(timings, 50)).toBe(900);
  });

  it('mảng rỗng trả undefined', () => {
    expect(seekMsForChar([], 0)).toBeUndefined();
  });

  it('ký tự trước từ đầu tiên trả undefined', () => {
    const offset: WordTiming[] = [{ w: 'a', startMs: 100, endMs: 500, charStart: 4, charEnd: 5 }];
    expect(seekMsForChar(offset, 0)).toBeUndefined();
  });

  it('nhiều mảnh cùng một từ gốc trả mốc của mảnh ĐẦU', () => {
    // Hệ quả P3.5: `Tokyo` = [11,17) đọc thành `Tô`/`ki`/`ô`, ba timing cùng
    // khoảng gốc. Trả mảnh cuối thì bấm vào tên sẽ nhảy vào giữa lúc đang đọc
    // dở chính cái tên đó.
    const jp: WordTiming[] = [
      { w: 'tới', startMs: 400, endMs: 700, charStart: 7, charEnd: 10 },
      { w: 'Tô', startMs: 700, endMs: 900, charStart: 11, charEnd: 17 },
      { w: 'ki', startMs: 900, endMs: 1100, charStart: 11, charEnd: 17 },
      { w: 'ô', startMs: 1100, endMs: 1300, charStart: 11, charEnd: 17 },
    ];
    expect(seekMsForChar(jp, 11)).toBe(700);
    // Bấm vào giữa tên cũng về đầu tên, không về mảnh đang phủ ký tự đó
    expect(seekMsForChar(jp, 14)).toBe(700);
  });
});
