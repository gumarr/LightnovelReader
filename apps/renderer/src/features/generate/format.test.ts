import { describe, expect, it } from 'vitest';
import { PREFETCH_THRESHOLD, type QueueStatusInfo } from '@ln/shared';
import { nextChapterToPrefetch, queuePercent, queueStateLabel } from './format';

const status = (overrides: Partial<QueueStatusInfo> = {}): QueueStatusInfo => ({
  state: 'idle',
  queued: 0,
  running: 0,
  done: 0,
  error: 0,
  cancelled: 0,
  ...overrides,
});

describe('queuePercent', () => {
  it('hàng đợi rỗng là 0, không phải NaN', () => {
    // 0/0 cho NaN, mà NaN đi vào `width: NaN%` là thanh biến mất
    expect(queuePercent(status())).toBe(0);
  });

  it('xong một nửa là 50%', () => {
    expect(queuePercent(status({ done: 5, queued: 5 }))).toBe(50);
  });

  it('job đang chạy tính là chưa xong', () => {
    expect(queuePercent(status({ done: 0, running: 1 }))).toBe(0);
  });

  it('xong hết là 100%', () => {
    expect(queuePercent(status({ done: 10 }))).toBe(100);
  });

  it('job hỏng và bị huỷ tính là ĐÃ xử lý', () => {
    // Để chúng ngoài mẫu số thì thanh đứng mãi dưới 100% dù hàng đợi đã rỗng
    expect(queuePercent(status({ done: 8, error: 1, cancelled: 1 }))).toBe(100);
  });

  it('xếp thêm việc thì phần trăm tụt xuống, không nhảy lung tung', () => {
    const before = queuePercent(status({ done: 10 }));
    const after = queuePercent(status({ done: 10, queued: 10 }));

    expect(before).toBe(100);
    expect(after).toBe(50);
  });
});

describe('queueStateLabel', () => {
  it('nói rõ còn bao nhiêu đoạn khi đang chạy', () => {
    expect(queueStateLabel(status({ state: 'running', queued: 4, running: 1 }))).toBe(
      'Đang tạo · còn 5 đoạn',
    );
  });

  it('tạm dừng vẫn cho biết còn tồn bao nhiêu', () => {
    expect(queueStateLabel(status({ state: 'paused', queued: 3 }))).toBe(
      'Đã tạm dừng · còn 3 đoạn',
    );
  });

  it('tạm dừng mà hết việc thì không nói "còn 0 đoạn"', () => {
    expect(queueStateLabel(status({ state: 'paused' }))).toBe('Đã tạm dừng');
  });

  it('rỗi thì nói rõ là không có việc', () => {
    expect(queueStateLabel(status({ state: 'idle', done: 10 }))).toBe('Không có việc đang chạy');
  });

  it('đã xếp nhưng worker chưa chạy', () => {
    expect(queueStateLabel(status({ state: 'idle', queued: 2 }))).toBe('Chờ chạy · 2 đoạn');
  });
});

describe('nextChapterToPrefetch', () => {
  const ids = ['c1', 'c2', 'c3'];

  it('chưa tới 80% thì không prefetch', () => {
    // Segment 5/10 = 50%
    expect(nextChapterToPrefetch(ids, 'c1', 4, 10, PREFETCH_THRESHOLD)).toBeUndefined();
  });

  it('tới đúng 80% thì xếp chương kế', () => {
    // Segment thứ 8 (index 7) trong 10 = 80%
    expect(nextChapterToPrefetch(ids, 'c1', 7, 10, PREFETCH_THRESHOLD)).toBe('c2');
  });

  it('đọc segment cuối vẫn tính là 100%, không phải 90%', () => {
    // `+1` vì index đếm từ 0 — thiếu nó thì chương 10 segment không bao giờ
    // chạm 100% và chương cuối sách không được prefetch đúng lúc.
    expect(nextChapterToPrefetch(ids, 'c1', 9, 10, 1)).toBe('c2');
  });

  it('chương cuối sách không có gì để prefetch', () => {
    expect(nextChapterToPrefetch(ids, 'c3', 9, 10, PREFETCH_THRESHOLD)).toBeUndefined();
  });

  it('chưa chọn segment nào thì không prefetch', () => {
    // `findIndex` trả -1 khi chưa có segment nào đang đọc
    expect(nextChapterToPrefetch(ids, 'c1', -1, 10, PREFETCH_THRESHOLD)).toBeUndefined();
  });

  it('chưa mở chương nào thì không prefetch', () => {
    expect(nextChapterToPrefetch(ids, null, 9, 10, PREFETCH_THRESHOLD)).toBeUndefined();
  });

  it('chương rỗng không gây chia cho 0', () => {
    expect(nextChapterToPrefetch(ids, 'c1', 0, 0, PREFETCH_THRESHOLD)).toBeUndefined();
  });

  it('chương không thuộc sách đang mở thì bỏ qua', () => {
    expect(nextChapterToPrefetch(ids, 'c-la', 9, 10, PREFETCH_THRESHOLD)).toBeUndefined();
  });

  it('chương một segment: đọc nó là đã 100%', () => {
    expect(nextChapterToPrefetch(ids, 'c1', 0, 1, PREFETCH_THRESHOLD)).toBe('c2');
  });
});
