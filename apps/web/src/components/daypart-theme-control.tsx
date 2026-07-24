'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun, SunMoon } from 'lucide-react';
import {
  isThemeMode,
  nextThemeMode,
  resolveDaypart,
} from '@/lib/daypart-theme.mjs';

type ThemeMode = 'auto' | 'day' | 'night';

const STORAGE_KEY = 'owd:theme-mode';

const LABELS: Record<ThemeMode, string> = {
  auto: 'Automatic theme based on local time',
  day: 'Day theme',
  night: 'Night theme',
};

export default function DaypartThemeControl() {
  const [mode, setMode] = useState<ThemeMode>('auto');

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (isThemeMode(stored)) setMode(stored as ThemeMode);
    } catch {}
  }, []);

  useEffect(() => {
    const applyTheme = () => {
      document.documentElement.dataset.daypart = resolveDaypart(mode);
      document.documentElement.dataset.themeMode = mode;
    };

    applyTheme();
    const timer =
      mode === 'auto' ? window.setInterval(applyTheme, 60_000) : undefined;

    return () => {
      if (timer) window.clearInterval(timer);
      delete document.documentElement.dataset.daypart;
      delete document.documentElement.dataset.themeMode;
    };
  }, [mode]);

  const cycleMode = () => {
    const next = nextThemeMode(mode) as ThemeMode;
    setMode(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {}
  };

  const Icon = mode === 'day' ? Sun : mode === 'night' ? Moon : SunMoon;

  return (
    <button
      type="button"
      onClick={cycleMode}
      aria-label={`${LABELS[mode]}. Activate the next theme mode.`}
      title={LABELS[mode]}
      className="inline-flex h-10 items-center gap-2 rounded-lg border border-brand-border bg-brand-surface px-3 text-brand-muted transition-colors hover:border-brand-primary/40 hover:text-brand-text"
    >
      <Icon size={16} aria-hidden="true" />
      <span className="hidden text-[11px] font-bold xl:inline">
        {mode === 'auto' ? 'Auto' : mode === 'day' ? 'Day' : 'Night'}
      </span>
    </button>
  );
}
