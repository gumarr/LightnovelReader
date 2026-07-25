import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { BookHtml, Segment } from '@ln/shared';
import { DocxViewer } from './DocxViewer';

const content = (html: string, blockCount = 3): BookHtml => ({
  bookId: 'book-1',
  html,
  blockCount,
});

const HTML =
  '<h1 data-block="0">Chương 1</h1>' +
  '<p data-block="1">Đoạn thứ nhất.</p>' +
  '<p data-block="2">Đoạn thứ hai.</p>';

const segment = (nodePath: string): Segment => ({
  id: 's1',
  chapterId: 'ch-1',
  index: 0,
  text: 'Đoạn thứ hai.',
  anchor: { kind: 'docx', nodePath, offset: 0 },
  status: 'pending',
  alignStatus: 'none',
});

const blocks = (): HTMLElement => screen.getByTestId('docx-content');

describe('hiển thị', () => {
  it('render HTML của sách', () => {
    render(<DocxViewer content={content(HTML)} activeSegment={undefined} />);

    expect(screen.getByText('Chương 1')).toBeInTheDocument();
    expect(screen.getByText('Đoạn thứ nhất.')).toBeInTheDocument();
  });

  it('giữ nguyên thẻ heading — định dạng là thứ DOCX viewer phải có', () => {
    render(<DocxViewer content={content(HTML)} activeSegment={undefined} />);
    expect(blocks().querySelector('h1')?.textContent).toBe('Chương 1');
  });

  it('sách rỗng không làm vỡ giao diện', () => {
    render(<DocxViewer content={content('', 0)} activeSegment={undefined} />);
    expect(blocks()).toBeEmptyDOMElement();
  });
});

describe('highlight khối đang đọc', () => {
  it('tô đúng khối theo nodePath', () => {
    render(<DocxViewer content={content(HTML)} activeSegment={segment('p:2')} />);

    const active = blocks().querySelector('.ln-active-block');
    expect(active?.textContent).toBe('Đoạn thứ hai.');
  });

  it('không tô gì khi chưa chọn segment', () => {
    render(<DocxViewer content={content(HTML)} activeSegment={undefined} />);
    expect(blocks().querySelector('.ln-active-block')).toBeNull();
  });

  it('đổi segment thì gỡ dấu cũ', () => {
    // Không gỡ thì đọc một lúc là cả sách sáng hết
    const { rerender } = render(
      <DocxViewer content={content(HTML)} activeSegment={segment('p:1')} />,
    );
    rerender(<DocxViewer content={content(HTML)} activeSegment={segment('p:2')} />);

    expect(blocks().querySelectorAll('.ln-active-block')).toHaveLength(1);
    expect(blocks().querySelector('.ln-active-block')?.textContent).toBe('Đoạn thứ hai.');
  });

  it('neo trỏ ra ngoài số khối thì không tô, không lỗi', () => {
    render(<DocxViewer content={content(HTML)} activeSegment={segment('p:99')} />);
    expect(blocks().querySelector('.ln-active-block')).toBeNull();
  });

  it('neo PDF trong sách DOCX thì bỏ qua', () => {
    const mismatched: Segment = {
      ...segment('p:1'),
      anchor: { kind: 'pdf', page: 1, rects: [] },
    };

    render(<DocxViewer content={content(HTML)} activeSegment={mismatched} />);
    expect(blocks().querySelector('.ln-active-block')).toBeNull();
  });
});
