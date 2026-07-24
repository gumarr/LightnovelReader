import { useEffect, useState } from 'react';

/** Nút thu nhỏ / phóng to / đóng của titlebar tự vẽ */
export const WindowControls = (): JSX.Element => {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    void window.api.window.getState().then((result) => {
      if (result.ok) setIsMaximized(result.data.isMaximized);
    });

    return window.api.window.onStateChanged((state) => setIsMaximized(state.isMaximized));
  }, []);

  return (
    <div className="no-drag flex h-full items-stretch">
      <ControlButton label="Thu nhỏ" onClick={() => void window.api.window.minimize()}>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <rect x="0" y="4.5" width="10" height="1" fill="currentColor" />
        </svg>
      </ControlButton>

      <ControlButton
        label={isMaximized ? 'Khôi phục' : 'Phóng to'}
        onClick={() => void window.api.window.toggleMaximize()}
      >
        {isMaximized ? <RestoreIcon /> : <MaximizeIcon />}
      </ControlButton>

      <ControlButton
        label="Đóng"
        danger
        onClick={() => void window.api.window.close()}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0 0 L10 10 M10 0 L0 10" stroke="currentColor" strokeWidth="1" />
        </svg>
      </ControlButton>
    </div>
  );
};

type ControlButtonProps = {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
};

const ControlButton = ({ label, onClick, danger, children }: ControlButtonProps): JSX.Element => (
  <button
    type="button"
    aria-label={label}
    title={label}
    onClick={onClick}
    className={`flex w-12 items-center justify-center text-fg-muted transition-colors hover:text-fg ${
      danger === true ? 'hover:bg-danger hover:text-accent-fg' : 'hover:bg-bg-subtle'
    }`}
  >
    {children}
  </button>
);

const MaximizeIcon = (): JSX.Element => (
  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
    <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" />
  </svg>
);

const RestoreIcon = (): JSX.Element => (
  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
    <rect x="0.5" y="2.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1" />
    <path d="M2.5 2.5 V0.5 H9.5 V7.5 H7.5" fill="none" stroke="currentColor" strokeWidth="1" />
  </svg>
);
