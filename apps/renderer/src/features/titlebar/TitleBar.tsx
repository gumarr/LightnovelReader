import { ThemeToggle } from '@/features/theme/ThemeToggle';
import { WindowControls } from './WindowControls';

export type TitleBarProps = {
  title: string;
};

/**
 * Titlebar tự vẽ (cửa sổ frameless). Vùng giữa kéo được để di chuyển cửa sổ;
 * các nút phải mang class `no-drag` nếu không sẽ không bấm được.
 */
export const TitleBar = ({ title }: TitleBarProps): JSX.Element => (
  <header
    className="drag-region flex shrink-0 items-stretch border-b border-border bg-bg-elevated"
    style={{ height: 'var(--titlebar-height)' }}
  >
    <div className="flex flex-1 items-center gap-2 px-3">
      <span className="select-none text-sm font-medium text-fg">{title}</span>
    </div>

    <ThemeToggle />
    <WindowControls />
  </header>
);
