import { describe, expect, it } from 'vitest';
import { cumulativeOffsets, findIndexAt, scrollTopFor, visibleRange } from './windowing';

const uniform = (count: number, height: number): number[] =>
  cumulativeOffsets(new Array<number>(count).fill(height));

describe('cumulativeOffsets', () => {
  it('cộng dồn chiều cao', () => {
    expect(cumulativeOffsets([10, 20, 30])).toEqual([0, 10, 30, 60]);
  });

  it('mảng offset dài hơn danh sách đúng 1', () => {
    expect(cumulativeOffsets([5, 5])).toHaveLength(3);
  });

  it('danh sách rỗng cho [0]', () => {
    expect(cumulativeOffsets([])).toEqual([0]);
  });

  it('chiều cao âm coi như 0 — không được phá thứ tự tăng dần', () => {
    // Tìm nhị phân dựa vào mảng tăng dần; một giá trị âm là hỏng toàn bộ
    expect(cumulativeOffsets([10, -5, 10])).toEqual([0, 10, 10, 20]);
  });

  it('NaN coi như 0', () => {
    expect(cumulativeOffsets([10, Number.NaN, 10])).toEqual([0, 10, 10, 20]);
  });
});

describe('findIndexAt', () => {
  const offsets = cumulativeOffsets([100, 100, 100]);

  it('tìm đúng phần tử chứa toạ độ', () => {
    expect(findIndexAt(offsets, 0)).toBe(0);
    expect(findIndexAt(offsets, 150)).toBe(1);
    expect(findIndexAt(offsets, 250)).toBe(2);
  });

  it('đúng mốc là phần tử sau', () => {
    expect(findIndexAt(offsets, 100)).toBe(1);
  });

  it('vượt quá cuối trả phần tử cuối', () => {
    expect(findIndexAt(offsets, 99999)).toBe(2);
  });

  it('danh sách rỗng trả 0', () => {
    expect(findIndexAt([0], 50)).toBe(0);
  });

  it('cho cùng kết quả với quét tuyến tính trên chiều cao không đều', () => {
    // Trang PDF cao không đều nhau; tìm nhị phân phải khớp cách hiểu ngây thơ
    const heights = [30, 120, 45, 200, 15, 90];
    const cum = cumulativeOffsets(heights);

    for (let y = 0; y < 500; y += 7) {
      let expected = 0;
      for (let i = 0; i < heights.length; i += 1) {
        if ((cum[i] ?? 0) <= y) expected = i;
      }
      expect(findIndexAt(cum, y)).toBe(expected);
    }
  });
});

describe('visibleRange', () => {
  it('chỉ render phần tử trong tầm nhìn cộng đệm', () => {
    const range = visibleRange({
      offsets: uniform(100, 100),
      scrollTop: 0,
      viewportHeight: 300,
      overscan: 0,
    });

    expect(range.start).toBe(0);
    expect(range.end).toBe(4);
  });

  it('đệm mở rộng lát cắt hai phía', () => {
    const range = visibleRange({
      offsets: uniform(100, 100),
      scrollTop: 1000,
      viewportHeight: 300,
      overscan: 1,
    });

    expect(range.start).toBe(9);
    expect(range.end).toBe(15);
  });

  it('không render quá số phần tử có thật', () => {
    const range = visibleRange({
      offsets: uniform(3, 100),
      scrollTop: 0,
      viewportHeight: 5000,
      overscan: 5,
    });

    expect(range.start).toBe(0);
    expect(range.end).toBe(3);
  });

  it('tổng chiều cao đúng để thanh cuộn đúng tầm', () => {
    expect(visibleRange({ offsets: uniform(270, 800), scrollTop: 0, viewportHeight: 600 })
      .totalHeight).toBe(216000);
  });

  it('offsetTop khớp mốc của phần tử đầu lát cắt', () => {
    const range = visibleRange({
      offsets: uniform(50, 100),
      scrollTop: 1000,
      viewportHeight: 300,
      overscan: 0,
    });

    expect(range.offsetTop).toBe(range.start * 100);
  });

  it('cuộn âm (overscroll) không sinh chỉ số âm', () => {
    // Chromium trả scrollTop âm khi cuộn đà
    const range = visibleRange({ offsets: uniform(10, 100), scrollTop: -500, viewportHeight: 300 });
    expect(range.start).toBe(0);
  });

  it('cuộn vượt quá cuối vẫn nằm trong danh sách', () => {
    const range = visibleRange({
      offsets: uniform(10, 100),
      scrollTop: 999999,
      viewportHeight: 300,
    });

    expect(range.end).toBeLessThanOrEqual(10);
    expect(range.start).toBeLessThan(range.end);
  });

  it('danh sách rỗng không render gì', () => {
    const range = visibleRange({ offsets: [0], scrollTop: 0, viewportHeight: 300 });
    expect(range).toEqual({ start: 0, end: 0, totalHeight: 0, offsetTop: 0 });
  });

  it('1353 segment chỉ render một nhúm', () => {
    // Chương lớn nhất đo trên sách thật
    const range = visibleRange({
      offsets: uniform(1353, 60),
      scrollTop: 30000,
      viewportHeight: 800,
    });

    expect(range.end - range.start).toBeLessThan(20);
  });
});

describe('scrollTopFor', () => {
  const offsets = uniform(100, 100);

  it('không cuộn khi phần tử đã nằm trong khung', () => {
    // Đang đọc mà khung nhảy mỗi lần đổi segment thì không đọc nổi
    expect(scrollTopFor(offsets, 5, 800, 400)).toBeUndefined();
  });

  it('cuộn khi phần tử nằm dưới khung', () => {
    expect(scrollTopFor(offsets, 50, 500, 0)).toBeDefined();
  });

  it('canh giữa khung nhìn', () => {
    // Phần tử 50 ở [5000, 5100), khung cao 500 → canh giữa là 5000 - 200
    expect(scrollTopFor(offsets, 50, 500, 0)).toBe(4800);
  });

  it('phần tử cao hơn khung thì canh mép trên', () => {
    const tall = cumulativeOffsets([100, 2000, 100]);
    expect(scrollTopFor(tall, 1, 500, 0, 24)).toBe(76);
  });

  it('không cuộn quá cuối danh sách', () => {
    const result = scrollTopFor(offsets, 99, 500, 0);
    expect(result).toBeLessThanOrEqual(100 * 100 - 500);
  });

  it('không trả giá trị âm', () => {
    expect(scrollTopFor(offsets, 0, 500, 5000)).toBeGreaterThanOrEqual(0);
  });

  it('chỉ số ngoài danh sách trả undefined', () => {
    expect(scrollTopFor(offsets, -1, 500, 0)).toBeUndefined();
    expect(scrollTopFor(offsets, 100, 500, 0)).toBeUndefined();
  });
});
