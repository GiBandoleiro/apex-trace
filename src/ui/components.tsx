/** Shared interface building blocks. */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { audio } from '@/audio/AudioEngine';
import { formatCoins } from '@/utils/math';

/* ------------------------------------------------------------------ */
/* Icons (inline SVG so nothing extra loads)                           */
/* ------------------------------------------------------------------ */

type IconProps = { size?: number; className?: string };

export const CoinIcon: React.FC<IconProps> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
    <circle cx="12" cy="12" r="9" fill="#ffc14d" />
    <circle cx="12" cy="12" r="6.2" fill="#e0932a" />
    <path d="M12 8.2v7.6M9.6 10.2h4.8M9.6 13.8h4.8" stroke="#fff3d8" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);

export const XpIcon: React.FC<IconProps> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
    <path d="M12 2.6l2.9 6.1 6.6.9-4.8 4.6 1.2 6.6L12 17.6 6.1 20.8l1.2-6.6L2.5 9.6l6.6-.9z" fill="#4db2ff" />
  </svg>
);

export const BackIcon: React.FC<IconProps> = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
    <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const LockIcon: React.FC<IconProps> = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
    <rect x="4.5" y="10" width="15" height="10.5" rx="2.4" fill="currentColor" />
    <path d="M8 10V7.6a4 4 0 118 0V10" stroke="currentColor" strokeWidth="2" fill="none" />
  </svg>
);

/* ------------------------------------------------------------------ */
/* Button                                                              */
/* ------------------------------------------------------------------ */

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  block?: boolean;
  silent?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'default',
  size = 'md',
  block,
  silent,
  className = '',
  onClick,
  children,
  ...rest
}) => {
  const classes = [
    'btn',
    variant !== 'default' ? `btn--${variant}` : '',
    size !== 'md' ? `btn--${size}` : '',
    block ? 'btn--block' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      className={classes}
      onClick={(e) => {
        if (!silent) audio.ui('click');
        onClick?.(e);
      }}
      onPointerEnter={() => !silent && audio.ui('hover')}
      {...rest}
    >
      {children}
    </button>
  );
};

/* ------------------------------------------------------------------ */
/* Structure                                                           */
/* ------------------------------------------------------------------ */

export const Panel: React.FC<
  React.HTMLAttributes<HTMLDivElement> & { pad?: boolean }
> = ({ pad = true, className = '', children, ...rest }) => (
  <div className={`panel ${pad ? 'panel--pad' : ''} ${className}`} {...rest}>
    {children}
  </div>
);

export const TopBar: React.FC<{
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: React.ReactNode;
}> = ({ title, subtitle, onBack, right }) => (
  <header className="topbar">
    {onBack && (
      <Button variant="ghost" className="btn--icon" onClick={onBack} aria-label="Back">
        <BackIcon />
      </Button>
    )}
    <div className="topbar__title">
      <h1 className="display title">{title}</h1>
      {subtitle && <p className="subtitle">{subtitle}</p>}
    </div>
    {right}
  </header>
);

export const Wallet: React.FC<{ coins: number; level: number; xpProgress: number }> = ({
  coins,
  level,
  xpProgress,
}) => (
  <div className="wallet">
    <div className="chip" title="Coins">
      <CoinIcon />
      {formatCoins(coins)}
    </div>
    <div className="chip" title="Driver level">
      <XpIcon />
      <span>
        LV {level}
        <span style={{ color: 'var(--text-faint)', marginLeft: 6, fontSize: 12 }}>
          {Math.round(xpProgress * 100)}%
        </span>
      </span>
    </div>
  </div>
);

/* ------------------------------------------------------------------ */
/* Data display                                                        */
/* ------------------------------------------------------------------ */

export const StatBar: React.FC<{
  label: string;
  value: number;
  max?: number;
  /** Optional preview value, drawn as a green delta. */
  preview?: number;
}> = ({ label, value, max = 110, preview }) => {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const previewPct =
    preview !== undefined ? Math.max(0, Math.min(100, (preview / max) * 100)) : pct;
  const gain = previewPct > pct;

  return (
    <div className="stat">
      <span className="stat__label">{label}</span>
      <div className="stat__track">
        {gain && (
          <div
            className="stat__delta"
            style={{ left: `${pct}%`, width: `${previewPct - pct}%` }}
          />
        )}
        <div className="stat__fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="stat__value" style={gain ? { color: 'var(--good)' } : undefined}>
        {Math.round(preview ?? value)}
      </span>
    </div>
  );
};

export const Stars: React.FC<{ value: number; max?: number }> = ({ value, max = 5 }) => (
  <span className="stars" aria-label={`Difficulty ${value} of ${max}`}>
    {Array.from({ length: max }, (_, i) =>
      i < value ? <React.Fragment key={i}>★</React.Fragment> : <span key={i}>★</span>,
    )}
  </span>
);

export const StatTile: React.FC<{ label: string; value: React.ReactNode }> = ({
  label,
  value,
}) => (
  <div className="stat-tile">
    <span className="label">{label}</span>
    <span className="stat-tile__value">{value}</span>
  </div>
);

export const Segmented = <T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}): React.ReactElement => (
  <div className="segmented" role="tablist">
    {options.map((o) => (
      <button
        key={o.value}
        role="tab"
        aria-selected={o.value === value}
        className={`segmented__item ${o.value === value ? 'segmented__item--active' : ''}`}
        onClick={() => {
          audio.ui('click');
          onChange(o.value);
        }}
      >
        {o.label}
      </button>
    ))}
  </div>
);

export const Slider: React.FC<{
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}> = ({ label, value, min = 0, max = 1, step = 0.05, format, onChange }) => (
  <div className="field">
    <div className="row" style={{ justifyContent: 'space-between' }}>
      <span className="label">{label}</span>
      <span className="num" style={{ fontSize: 14 }}>
        {format ? format(value) : `${Math.round(value * 100)}%`}
      </span>
    </div>
    <input
      className="slider"
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
    />
  </div>
);

export const Toggle: React.FC<{
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}> = ({ label, hint, value, onChange }) => (
  <button
    className="row"
    style={{
      justifyContent: 'space-between',
      width: '100%',
      background: 'transparent',
      border: 'none',
      padding: '10px 0',
      textAlign: 'left',
    }}
    onClick={() => {
      audio.ui('click');
      onChange(!value);
    }}
  >
    <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span style={{ fontSize: 15, fontWeight: 500 }}>{label}</span>
      {hint && <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>{hint}</span>}
    </span>
    <span
      style={{
        width: 50,
        height: 28,
        borderRadius: 99,
        background: value ? 'var(--accent)' : 'rgba(255,255,255,0.14)',
        position: 'relative',
        transition: 'background 160ms',
        flexShrink: 0,
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 3,
          left: value ? 25 : 3,
          width: 22,
          height: 22,
          borderRadius: '50%',
          background: '#fff',
          transition: 'left 160ms cubic-bezier(0.22,1,0.36,1)',
        }}
      />
    </span>
  </button>
);

/* ------------------------------------------------------------------ */
/* Overlays                                                            */
/* ------------------------------------------------------------------ */

export const Modal: React.FC<{
  open: boolean;
  onClose?: () => void;
  children: React.ReactNode;
}> = ({ open, onClose, children }) => {
  useEffect(() => {
    if (!open || !onClose) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <Panel className="modal" onClick={(e) => e.stopPropagation()}>
        {children}
      </Panel>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Animated number                                                     */
/* ------------------------------------------------------------------ */

export const CountUp: React.FC<{ value: number; duration?: number; format?: (v: number) => string }> = ({
  value,
  duration = 900,
  format,
}) => {
  const [shown, setShown] = useState(0);
  const startRef = useRef(0);
  const fromRef = useRef(0);

  useEffect(() => {
    fromRef.current = shown;
    startRef.current = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - startRef.current) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(fromRef.current + (value - fromRef.current) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration]);

  return <>{format ? format(shown) : Math.round(shown).toLocaleString('en-US')}</>;
};

/* ------------------------------------------------------------------ */
/* Track thumbnail                                                     */
/* ------------------------------------------------------------------ */

const thumbCache = new Map<string, string>();

export const useTrackThumbnail = (
  trackId: string,
  render: (id: string, size: number) => string,
  size = 240,
): string => {
  return useMemo(() => {
    const key = `${trackId}:${size}`;
    const cached = thumbCache.get(key);
    if (cached) return cached;
    const url = render(trackId, size);
    thumbCache.set(key, url);
    return url;
  }, [trackId, size, render]);
};
