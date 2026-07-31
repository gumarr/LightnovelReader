import type { AppInfo } from '@ln/shared';

/**
 * Phiên bản app và thư mục dữ liệu.
 *
 * Kênh `app:getInfo` có từ Phase 0 nhưng **chưa màn nào gọi** cho tới đây. Đưa
 * lên UI vì đây là thứ user phải đọc được khi báo lỗi: thiếu số phiên bản thì
 * mọi báo cáo lỗi đều mơ hồ.
 *
 * `userDataPath` cũng ở đây vì đó là chỗ chứa `.db` và settings — cần khi user
 * muốn sao lưu tiến độ đọc, hoặc khi cần xoá sạch để cài lại.
 */

export type AppInfoPanelProps = {
  info: AppInfo;
};

export const AppInfoPanel = ({ info }: AppInfoPanelProps): JSX.Element => (
  <section
    data-testid="settings-about"
    className="flex flex-col gap-2 rounded-lg border border-border p-3"
  >
    <h2 className="text-sm font-semibold text-fg">Về ứng dụng</h2>

    <dl className="flex flex-col gap-1 text-xs">
      <Row label="Phiên bản" value={info.version} testId="settings-version" />
      <Row label="Electron" value={info.electronVersion} />
      <Row label="Chromium" value={info.chromeVersion} />
      <Row label="Node" value={info.nodeVersion} />
      <Row label="Thư mục dữ liệu" value={info.userDataPath} mono />
    </dl>
  </section>
);

type RowProps = {
  label: string;
  value: string;
  mono?: boolean;
  testId?: string;
};

const Row = ({ label, value, mono = false, testId }: RowProps): JSX.Element => (
  <div className="flex items-baseline gap-3">
    <dt className="w-32 shrink-0 text-fg-muted">{label}</dt>
    {/* `title` để đọc được đường dẫn dài mà không phá bố cục hàng */}
    <dd
      title={value}
      {...(testId === undefined ? {} : { 'data-testid': testId })}
      className={`min-w-0 flex-1 truncate text-fg ${mono ? 'font-mono' : ''}`}
    >
      {value}
    </dd>
  </div>
);
