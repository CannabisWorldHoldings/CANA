'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { Moon, Sun, SunMoon } from 'lucide-react';
import { nextThemeMode, resolveDaypart } from '@/lib/daypart-theme.mjs';

type ThemeMode = 'auto' | 'day' | 'night';

const STORAGE_KEY = 'owd:theme-mode';
const THEME_CHANGE_EVENT = 'owd:theme-mode-change';
let memoryThemeMode: ThemeMode = 'auto';

const LABELS: Record<ThemeMode, string> = {
  auto: 'Automatic theme based on local time',
  day: 'Day theme',
  night: 'Night theme',
};

function storedThemeMode(): ThemeMode {
  if (typeof window === 'undefined') return 'auto';
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === 'day' || stored === 'night' ? stored : 'auto';
  } catch {
    return memoryThemeMode;
  }
}

function subscribeToThemeMode(onChange: () => void) {
  window.addEventListener('storage', onChange);
  window.addEventListener(THEME_CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(THEME_CHANGE_EVENT, onChange);
  };
}

function persistThemeMode(mode: ThemeMode) {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    return;
  }
}

function serverThemeMode(): ThemeMode {
  return 'auto';
}

export default function DaypartThemeControl() {
  const mode = useSyncExternalStore<ThemeMode>(
    subscribeToThemeMode,
    storedThemeMode,
    serverThemeMode,
  );

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
    const candidate = nextThemeMode(mode);
    const next: ThemeMode =
      candidate === 'day' || candidate === 'night' ? candidate : 'auto';
    memoryThemeMode = next;
    persistThemeMode(next);
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
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
