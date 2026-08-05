'use client';
import { useEffect, useState } from 'react';
export type Theme = 'day' | 'night';

/** Lab shell: enforces exact canvas law (#FFFFFF / #000000) and a persistent toggle. */
export function Lab({ theme: initial = 'day', children, label }: {
  theme?: Theme;
  /** Children may be a render function receiving the live theme. */
  children: React.ReactNode | ((theme: Theme) => React.ReactNode);
  label: string;
}) {
  const [theme, setTheme] = useState<Theme>(initial);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('theme');
    const saved = window.localStorage.getItem('owd-lab-theme');
    const targetTheme = (q === 'day' || q === 'night') ? q : ((saved === 'day' || saved === 'night') ? saved : null);
    if (targetTheme && targetTheme !== theme) {
      queueMicrotask(() => setTheme(targetTheme as Theme));
    }
  }, [theme]);

  useEffect(() => {
    window.localStorage.setItem('owd-lab-theme', theme);
    // Canvas law: html AND body must be exactly white or exactly black.
    const c = theme === 'night' ? '#000000' : '#FFFFFF';
    document.documentElement.style.background = c;
    document.body.style.background = c;
  }, [theme]);
  const night = theme === 'night';
  return (
    <div
      data-theme={theme}
      style={{ background: night ? '#000000' : '#FFFFFF', color: night ? '#F4FBF7' : '#07120C', minHeight: '100vh' }}
    >
      <button
        onClick={() => setTheme(night ? 'day' : 'night')}
        aria-label={`Switch to ${night ? 'day' : 'night'} mode`}
        style={{
          position: 'fixed', top: 16, right: 16, zIndex: 90,
          padding: '9px 15px', borderRadius: 999, cursor: 'pointer',
          fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
          background: night ? '#0a5c37' : '#07120C', color: '#fff',
          border: `1px solid ${night ? '#12d67f55' : '#00000022'}`,
        }}
      >
        {night ? 'Night' : 'Day'} · {label}
      </button>
      {typeof children === 'function' ? children(theme) : children}
    </div>
  );
}
