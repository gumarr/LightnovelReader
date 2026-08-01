import type { VoiceStyle } from '@ln/shared';
import { VOICE_STYLES } from '@ln/shared';

/**
 * Chọn phong cách đọc cho giọng VieNeu (P6.2).
 *
 * **Chỉ hiện khi có giọng VieNeu đã cài.** Phong cách là khái niệm riêng của
 * engine đó; hiện sẵn cho người chỉ dùng Piper là một ô bấm vào không đổi gì —
 * đúng loại "cài đặt chết" mà PROGRESS mục 4.71 cảnh báo.
 *
 * Đặt ở màn Giọng đọc chứ không phải Cài đặt chung: đây là thuộc tính của giọng,
 * và user đang ở đúng chỗ để nghe thử ngay sau khi đổi.
 */

export type VoiceStylePickerProps = {
  value: VoiceStyle;
  onChange: (style: VoiceStyle) => void;
};

const STYLE_LABEL: Record<VoiceStyle, string> = {
  doc_truyen: 'Kể chuyện',
  tu_nhien: 'Tự nhiên',
  tin_tuc: 'Tin tức',
};

const STYLE_HINT: Record<VoiceStyle, string> = {
  doc_truyen: 'Nhịp chậm, biểu cảm — hợp đọc Light Novel',
  tu_nhien: 'Giọng nói chuyện thường ngày',
  tin_tuc: 'Rõ ràng, đều nhịp như bản tin',
};

export const VoiceStylePicker = ({ value, onChange }: VoiceStylePickerProps): JSX.Element => (
  <div
    data-testid="voice-style-picker"
    data-style={value}
    className="rounded-lg border border-border bg-bg-elevated p-3"
  >
    <p className="text-sm font-medium text-fg">Phong cách đọc</p>
    <p className="mt-0.5 text-xs text-fg-muted">
      Chỉ áp dụng cho giọng tự nhiên. Đổi xong bấm <strong className="text-fg">Nghe thử</strong> để
      so — không phải tạo lại audio đã có.
    </p>

    <div className="mt-2 flex flex-wrap gap-2">
      {VOICE_STYLES.map((style) => {
        const active = style === value;
        return (
          <button
            key={style}
            type="button"
            onClick={() => {
              onChange(style);
            }}
            data-testid={`voice-style-${style}`}
            data-active={active}
            title={STYLE_HINT[style]}
            className="rounded border px-2.5 py-1 text-xs transition-colors"
            style={
              active
                ? {
                    backgroundColor: 'rgb(var(--accent))',
                    borderColor: 'rgb(var(--accent))',
                    color: 'rgb(var(--accent-fg))',
                  }
                : { borderColor: 'rgb(var(--border))', color: 'rgb(var(--fg))' }
            }
          >
            {STYLE_LABEL[style]}
          </button>
        );
      })}
    </div>
  </div>
);
