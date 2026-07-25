import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Segment } from '@ln/shared';
import { SegmentList } from './SegmentList';

const segments = (count: number): Segment[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `s${i + 1}`,
    chapterId: 'ch-1',
    index: i,
    text: `Đoạn văn thứ ${i + 1}.`,
    anchor: { kind: 'pdf' as const, page: i + 1, rects: [] },
    status: 'pending' as const,
    alignStatus: 'none' as const,
  }));

const rows = (): HTMLElement[] => screen.queryAllByTestId('segment-row');

describe('hiển thị', () => {
  it('liệt kê segment kèm số thứ tự', () => {
    render(<SegmentList segments={segments(3)} activeSegmentId={null} onSelect={vi.fn()} />);

    expect(rows()).toHaveLength(3);
    expect(screen.getByText('Đoạn văn thứ 1.')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('chương rỗng hiện lời nhắc', () => {
    render(<SegmentList segments={[]} activeSegmentId={null} onSelect={vi.fn()} />);

    expect(rows()).toHaveLength(0);
    expect(screen.getByText(/chưa có đoạn nào/)).toBeInTheDocument();
  });

  it('đánh dấu segment đang chọn', () => {
    render(<SegmentList segments={segments(3)} activeSegmentId="s2" onSelect={vi.fn()} />);

    expect(rows()[1]?.dataset['active']).toBe('true');
    expect(rows()[0]?.dataset['active']).toBe('false');
  });
});

describe('ảo hoá', () => {
  it('1353 segment không dựng 1353 node', () => {
    // Chương lớn nhất đo trên sách thật. jsdom báo clientHeight = 0 nên chỉ
    // render phần đệm — điều cần khẳng định là KHÔNG render hết.
    render(<SegmentList segments={segments(1353)} activeSegmentId={null} onSelect={vi.fn()} />);

    expect(rows().length).toBeLessThan(50);
  });

  it('vùng cuộn cao đúng tổng số segment', () => {
    render(<SegmentList segments={segments(100)} activeSegmentId={null} onSelect={vi.fn()} />);

    // 100 dòng × 64px — thanh cuộn phải phản ánh cả chương, không chỉ phần thấy
    const spacer = screen.getByTestId('segment-scroll').firstElementChild as HTMLElement;
    expect(spacer.style.height).toBe('6400px');
  });

  it('số thứ tự vẫn đúng khi cuộn xuống giữa danh sách', async () => {
    const { container } = render(
      <SegmentList segments={segments(500)} activeSegmentId={null} onSelect={vi.fn()} />,
    );

    const scroll = screen.getByTestId('segment-scroll');
    // jsdom không tự cập nhật scrollTop qua sự kiện; đặt tay rồi bắn event
    Object.defineProperty(scroll, 'scrollTop', { value: 3200, writable: true });
    Object.defineProperty(scroll, 'clientHeight', { value: 640, writable: true });

    await act(async () => {
      scroll.dispatchEvent(new Event('scroll', { bubbles: true }));
    });

    // Dòng đầu lát cắt phải là số 48 trở đi (3200/64 = 50, trừ 3 đệm)
    const first = container.querySelector('[data-testid="segment-row"] span');
    expect(Number(first?.textContent)).toBeGreaterThan(40);
  });
});

describe('chọn segment', () => {
  it('bấm một dòng gọi onSelect với đúng id', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<SegmentList segments={segments(3)} activeSegmentId={null} onSelect={onSelect} />);

    await user.click(rows()[1]!);
    expect(onSelect).toHaveBeenCalledWith('s2');
  });
});
