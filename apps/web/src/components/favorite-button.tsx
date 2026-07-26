'use client';

import { useSyncExternalStore } from 'react';

type Props = {
  retailerId: string;
};

const STORAGE_KEY = 'owd:saved-retailers';
const CHANGE_EVENT = 'owd:saved-retailers-change';
const EMPTY: string[] = [];

let snapshotRaw: string | null = null;
let snapshotIds: string[] = EMPTY;

function parseIds(raw: string | null): string[] {
  if (!raw) return EMPTY;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === 'string')
      : EMPTY;
  } catch {
    return EMPTY;
  }
}

function getSnapshot(): string[] {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    raw = null;
  }
  if (raw !== snapshotRaw) {
    snapshotRaw = raw;
    snapshotIds = parseIds(raw);
  }
  return snapshotIds;
}

function getServerSnapshot(): string[] {
  return EMPTY;
}

function subscribe(onStoreChange: () => void): () => void {
  window.addEventListener('storage', onStoreChange);
  window.addEventListener(CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener('storage', onStoreChange);
    window.removeEventListener(CHANGE_EVENT, onStoreChange);
  };
}

function writeSavedIds(ids: string[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Storage unavailable (private mode/quota); saving is best-effort only.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export default function FavoriteButton({ retailerId }: Props) {
  const savedIds = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
  const isFavorited = savedIds.includes(retailerId);

  const toggleFavorite = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const next = isFavorited
      ? savedIds.filter((id) => id !== retailerId)
      : [...savedIds, retailerId];
    writeSavedIds(next);
  };

  return (
    <button
      onClick={toggleFavorite}
      title={isFavorited ? 'Remove from Bookmarks' : 'Add to Bookmarks'}
      aria-pressed={isFavorited}
      className={`text-xs font-bold px-2 py-1 rounded-full border transition-all cursor-pointer flex items-center gap-1 ${
        isFavorited
          ? 'bg-amber-500/10 border-amber-500/30 text-amber-600'
          : 'bg-brand-background border-brand-border text-slate-400 hover:border-brand-primary hover:text-brand-primary-text'
      }`}
    >
      <span aria-hidden="true">{isFavorited ? '★' : '☆'}</span>
      <span>{isFavorited ? 'Saved' : 'Save'}</span>
    </button>
  );
}
