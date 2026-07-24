import { THEME_LABELS, nextThemeMode } from '@/lib/theme';
import { useTheme } from './use-theme';

/** Nút xoay vòng theme: Sáng → Tối → Theo hệ thống */
export const ThemeToggle = (): JSX.Element => {
  const { mode, resolved, setMode } = useTheme();
  const label = `Giao diện: ${THEME_LABELS[mode]}`;

  return (
    <button
      type="button"
      aria-label={label}
      title={`${label} — bấm để đổi`}
      data-theme-mode={mode}
      data-theme-resolved={resolved}
      onClick={() => setMode(nextThemeMode(mode))}
      className="no-drag flex h-full w-10 items-center justify-center text-fg-muted transition-colors hover:bg-bg-subtle hover:text-fg"
    >
      {mode === 'system' ? <SystemIcon /> : resolved === 'dark' ? <MoonIcon /> : <SunIcon />}
    </button>
  );
};

const SunIcon = (): JSX.Element => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none">
    <circle cx="8" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.3" />
    <path
      d="M8 1v1.8M8 13.2V15M15 8h-1.8M2.8 8H1M12.9 3.1l-1.3 1.3M4.4 11.6l-1.3 1.3M12.9 12.9l-1.3-1.3M4.4 4.4L3.1 3.1"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
    />
  </svg>
);

const MoonIcon = (): JSX.Element => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none">
    <path
      d="M13.5 9.7A5.8 5.8 0 0 1 6.3 2.5a5.8 5.8 0 1 0 7.2 7.2Z"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinejoin="round"
    />
  </svg>
);

const SystemIcon = (): JSX.Element => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none">
    <rect x="1.5" y="2.5" width="13" height="9" rx="1" stroke="currentColor" strokeWidth="1.3" />
    <path d="M5.5 14h5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);
