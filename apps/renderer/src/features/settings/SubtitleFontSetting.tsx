/**
 * Cỡ chữ phụ đề, kèm **xem thử ngay tại chỗ**.
 *
 * Có preview vì con số px không nói lên điều gì: user không biết 18 khác 24 thế
 * nào cho tới khi nhìn thấy. Không bắt họ vào trình đọc rồi quay ra chỉnh, vào
 * lại xem — vòng đó là ba lần chuyển màn cho một lần thử.
 *
 * Câu mẫu có **tên riêng Nhật** giống `VOICE_PREVIEW_TEXT`: đó là mặt chữ user
 * thật sự nhìn khi đọc LN dịch, và dấu tiếng Việt là thứ mất nét trước tiên khi
 * cỡ chữ nhỏ.
 */

const PREVIEW_TEXT = 'Chiều hôm ấy ở Tokyo, Asuka khẽ mỉm cười.';

export type SubtitleFontSettingProps = {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (size: number) => void;
};

export const SubtitleFontSetting = ({
  value,
  min,
  max,
  step,
  onChange,
}: SubtitleFontSettingProps): JSX.Element => (
  <section className="flex flex-col gap-3 rounded-lg border border-border bg-bg-elevated p-3">
    <div>
      <h2 className="text-sm font-semibold text-fg">Phụ đề</h2>
      <p className="mt-0.5 text-xs text-fg-muted">
        Cỡ chữ của khung phụ đề trong trình đọc. Không đổi cỡ chữ của sách.
      </p>
    </div>

    <div className="flex items-center gap-3">
      <label htmlFor="subtitle-font-size" className="w-32 shrink-0 text-xs text-fg-muted">
        Cỡ chữ
      </label>
      <input
        id="subtitle-font-size"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        data-testid="subtitle-font-range"
        className="min-w-0 flex-1 accent-accent"
      />
      <span
        data-testid="subtitle-font-value"
        className="w-12 shrink-0 text-right text-xs tabular-nums text-fg"
      >
        {value} px
      </span>
    </div>

    {/*
      Preview dùng đúng biến màu của phụ đề thật (`--subtitle-past`) chứ không
      phải `text-fg`: nhìn thử mà khác màu thì kết luận rút ra từ nó cũng sai.
    */}
    <p
      data-testid="subtitle-font-preview"
      style={{ fontSize: `${String(value)}px` }}
      className="rounded border border-border bg-bg px-3 py-2 leading-relaxed text-subtitle-past"
    >
      {PREVIEW_TEXT}
    </p>
  </section>
);
