import { describe, expect, it } from 'vitest';
import { blockIndexOf, findBlockElement } from './docx-anchor';

describe('blockIndexOf', () => {
  it('đọc chỉ số từ nodePath', () => {
    expect(blockIndexOf({ kind: 'docx', nodePath: 'p:7', offset: 0 })).toBe(7);
  });

  it('chỉ số 0 là hợp lệ', () => {
    // Khối đầu tiên — dễ lẫn với "không tìm thấy" nếu viết bằng falsy check
    expect(blockIndexOf({ kind: 'docx', nodePath: 'p:0', offset: 0 })).toBe(0);
  });

  it('neo PDF không có chỉ số khối', () => {
    expect(blockIndexOf({ kind: 'pdf', page: 3, rects: [] })).toBeUndefined();
  });

  it('không có neo trả undefined', () => {
    expect(blockIndexOf(undefined)).toBeUndefined();
  });

  it('nodePath sai dạng trả undefined', () => {
    expect(blockIndexOf({ kind: 'docx', nodePath: 'p:abc', offset: 0 })).toBeUndefined();
    expect(blockIndexOf({ kind: 'docx', nodePath: '7', offset: 0 })).toBeUndefined();
    expect(blockIndexOf({ kind: 'docx', nodePath: 'div:2', offset: 0 })).toBeUndefined();
    expect(blockIndexOf({ kind: 'docx', nodePath: '', offset: 0 })).toBeUndefined();
  });

  it('chỉ số âm không lọt qua', () => {
    expect(blockIndexOf({ kind: 'docx', nodePath: 'p:-1', offset: 0 })).toBeUndefined();
  });
});

describe('findBlockElement', () => {
  const root = (html: string): HTMLElement => {
    const div = document.createElement('div');
    div.innerHTML = html;
    return div;
  };

  it('tra được khối theo data-block', () => {
    const element = findBlockElement(root('<p data-block="0">a</p><p data-block="1">b</p>'), 1);
    expect(element?.textContent).toBe('b');
  });

  it('không dựa vào thứ tự con — văn bản trần xen giữa không làm lệch', () => {
    // Sanitize bỏ thẻ nhưng giữ ruột, nên giữa các khối có thể còn text trần
    const element = findBlockElement(root('<p data-block="0">a</p>rác<p data-block="1">b</p>'), 1);
    expect(element?.textContent).toBe('b');
  });

  it('chỉ số không tồn tại trả null', () => {
    expect(findBlockElement(root('<p data-block="0">a</p>'), 9)).toBeNull();
  });
});
