import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { VoiceStylePicker } from './VoiceStylePicker';

/**
 * Ô chọn phong cách đọc của giọng VieNeu (P6.2).
 *
 * Trọng tâm: ba lựa chọn đều bấm được, và ô hiện đúng cái đang chọn — đổi
 * phong cách mà UI không phản hồi thì user bấm lại nhiều lần rồi tưởng hỏng.
 */

describe('VoiceStylePicker', () => {
  it('hiện đủ ba phong cách', () => {
    render(<VoiceStylePicker value="doc_truyen" onChange={vi.fn()} />);

    expect(screen.getByTestId('voice-style-doc_truyen')).toBeInTheDocument();
    expect(screen.getByTestId('voice-style-tu_nhien')).toBeInTheDocument();
    expect(screen.getByTestId('voice-style-tin_tuc')).toBeInTheDocument();
  });

  it('đánh dấu phong cách đang chọn', () => {
    render(<VoiceStylePicker value="tin_tuc" onChange={vi.fn()} />);

    expect(screen.getByTestId('voice-style-tin_tuc')).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('voice-style-doc_truyen')).toHaveAttribute('data-active', 'false');
  });

  it('bấm một phong cách khác thì báo lên', async () => {
    const onChange = vi.fn();
    render(<VoiceStylePicker value="doc_truyen" onChange={onChange} />);

    await userEvent.click(screen.getByTestId('voice-style-tin_tuc'));

    expect(onChange).toHaveBeenCalledWith('tin_tuc');
  });

  it('mặc định kể chuyện vì đây là app đọc Light Novel', () => {
    render(<VoiceStylePicker value="doc_truyen" onChange={vi.fn()} />);

    expect(screen.getByTestId('voice-style-picker')).toHaveAttribute('data-style', 'doc_truyen');
    expect(screen.getByTestId('voice-style-doc_truyen')).toHaveAttribute('data-active', 'true');
  });

  it('nói rõ đổi phong cách không phải tạo lại audio đã có', () => {
    // Không nói thì user tưởng đổi xong phải generate lại cả chương.
    render(<VoiceStylePicker value="doc_truyen" onChange={vi.fn()} />);

    expect(screen.getByTestId('voice-style-picker').textContent).toContain(
      'không phải tạo lại audio',
    );
  });
});
