import { describe, expect, it } from 'vitest';
import { dehyphenate } from './dehyphenate.js';

describe('nối từ bị ngắt cuối dòng', () => {
  it('nối từ tiếng Việt bị ngắt', () => {
    expect(dehyphenate('nhân-\nvật')).toBe('nhânvật');
  });

  it('nối từ tiếng Anh bị ngắt', () => {
    expect(dehyphenate('extraordi-\nnary')).toBe('extraordinary');
  });

  it('bỏ luôn dấu xuống dòng, không để lại khoảng trắng thừa', () => {
    expect(dehyphenate('Cô ấy là một thiếu-\nnữ xinh đẹp.')).toBe('Cô ấy là một thiếunữ xinh đẹp.');
  });

  it('xử lý khoảng trắng thừa quanh chỗ ngắt', () => {
    expect(dehyphenate('thiếu-  \n   nữ')).toBe('thiếunữ');
  });

  it('nhận cả CRLF', () => {
    expect(dehyphenate('thiếu-\r\nnữ')).toBe('thiếunữ');
  });

  it('nhận hyphen U+2010', () => {
    expect(dehyphenate('thiếu‐\nnữ')).toBe('thiếunữ');
  });

  it('xử lý nhiều chỗ ngắt trong cùng khối text', () => {
    expect(dehyphenate('kiếm-\nthuật rất cao-\nsiêu')).toBe('kiếmthuật rất caosiêu');
  });

  it('giữ nguyên dấu thanh tiếng Việt sau khi nối', () => {
    expect(dehyphenate('phượng-\nhoàng')).toBe('phượnghoàng');
  });
});

describe('không nối nhầm', () => {
  it('không đụng gạch nối giữa dòng', () => {
    expect(dehyphenate('một từ-ghép bình thường')).toBe('một từ-ghép bình thường');
  });

  it('không nối khi dòng sau bắt đầu bằng chữ hoa', () => {
    // Gần như luôn là đầu dòng mới độc lập, nối vào sẽ hỏng câu
    expect(dehyphenate('Nguyễn-\nAnh')).toBe('Nguyễn-\nAnh');
  });

  it('không coi em-dash là dấu ngắt từ', () => {
    expect(dehyphenate('anh ấy nói—\nrồi im lặng')).toBe('anh ấy nói—\nrồi im lặng');
  });

  it('không coi en-dash là dấu ngắt từ', () => {
    expect(dehyphenate('trang 10–\n20')).toBe('trang 10–\n20');
  });

  it('không nối gạch đầu dòng hội thoại', () => {
    expect(dehyphenate('Hắn quay đi\n- Ta không nói nữa.')).toBe('Hắn quay đi\n- Ta không nói nữa.');
  });

  it('không nối khi có dòng trống ở giữa', () => {
    expect(dehyphenate('thiếu-\n\nnữ')).toBe('thiếu-\n\nnữ');
  });

  it('không nối khi trước gạch nối không phải chữ', () => {
    expect(dehyphenate('123-\nnữ')).toBe('123-\nnữ');
  });

  it('giữ nguyên text không có gạch nối', () => {
    const input = 'Một đoạn văn bình thường.\nDòng thứ hai.';
    expect(dehyphenate(input)).toBe(input);
  });
});

describe('danh sách từ ghép giữ gạch nối', () => {
  it('giữ gạch nối cho từ ghép có trong danh sách', () => {
    expect(dehyphenate('Hà-\nnội', { keepHyphenWords: ['hà-nội'] })).toBe('Hà-nội');
  });

  it('khớp không phân biệt hoa thường', () => {
    expect(dehyphenate('Hà-\nnội', { keepHyphenWords: ['Hà-Nội'] })).toBe('Hà-nội');
  });

  it('khớp gạch nối nằm giữa từ nhiều thành phần', () => {
    expect(dehyphenate('in-tơ-\nnét', { keepHyphenWords: ['in-tơ-nét'] })).toBe('in-tơ-nét');
    expect(dehyphenate('in-\ntơ-nét', { keepHyphenWords: ['in-tơ-nét'] })).toBe('in-tơ-nét');
  });

  it('từ không trong danh sách vẫn bị nối', () => {
    expect(dehyphenate('thiếu-\nnữ', { keepHyphenWords: ['hà-nội'] })).toBe('thiếunữ');
  });

  it('không khớp nhầm khi cặp chỉ trùng một phần thành phần', () => {
    // 'a-b' không được khớp với 'xa-bc'
    expect(dehyphenate('a-\nb', { keepHyphenWords: ['xa-bc'] })).toBe('ab');
  });
});
