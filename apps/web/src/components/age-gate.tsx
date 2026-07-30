'use client';

import { useEffect, useSyncExternalStore } from 'react';
import Link from 'next/link';
import BrandWordmark from '@/components/brand-wordmark';

const STORAGE_KEY = 'owd:age-attested-at';
const CHANGE_EVENT = 'owd:age-attested-change';
// Re-ask after 30 days so the attestation stays current.
const ATTESTATION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type GateState = 'unknown' | 'open' | 'attested';

function readGateState(): GateState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return 'open';
    const attestedAt = Number(raw);
    if (!Number.isFinite(attestedAt)) return 'open';
    return Date.now() - attestedAt < ATTESTATION_TTL_MS ? 'attested' : 'open';
  } catch {
    // Storage unavailable: still show the gate each visit.
    return 'open';
  }
}

let cachedState: GateState = 'unknown';

function getSnapshot(): GateState {
  const next = readGateState();
  if (next !== cachedState) cachedState = next;
  return cachedState;
}

function getServerSnapshot(): GateState {
  return 'unknown';
}

function subscribe(onStoreChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onStoreChange);
  window.addEventListener('storage', onStoreChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onStoreChange);
    window.removeEventListener('storage', onStoreChange);
  };
}

export default function AgeGate() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const open = state === 'open';

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!open) return null;

  const attest = () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(Date.now()));
    } catch {
      // Best effort: without storage the gate reappears next visit.
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="age-gate-title"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-md"
    >
      <div className="hero-aurora w-full max-w-md rounded-2xl border border-brand-border bg-brand-surface p-8 text-center shadow-2xl animate-rise-in">
        <BrandWordmark className="mx-auto mb-6 w-44" priority />
        <p className="kicker mb-4">Age verification</p>
        <h2
          id="age-gate-title"
          className="font-display text-2xl font-bold text-brand-text"
        >
          Are you 21 or older?
        </h2>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-brand-muted">
          This site provides information about cannabis retailers and products
          in Washington, D.C. You must be 21+ (or a registered medical
          patient) to enter. Nothing here is medical advice.
        </p>
        <div className="mt-7 flex flex-col gap-3">
          <button
            onClick={attest}
            className="w-full cursor-pointer rounded-lg bg-brand-primary-fill-strong px-6 py-3 text-sm font-bold text-white transition-transform hover:scale-[1.02] active:scale-[0.99]"
          >
            Yes, I&apos;m 21 or older
          </button>
          <a
            href="https://www.samhsa.gov/"
            rel="noopener noreferrer"
            className="w-full rounded-lg border border-brand-border px-6 py-3 text-sm font-semibold text-brand-muted transition-colors hover:border-brand-primary/40 hover:text-brand-text"
          >
            No, take me somewhere else
          </a>
        </div>
        <p className="mt-6 text-[11px] leading-relaxed text-brand-muted/80">
          By entering you confirm your age and accept the{' '}
          <Link href="/legal" className="underline hover:text-brand-primary-text">
            legal &amp; compliance notes
          </Link>
          . D.C. law: 21+, no public consumption, keep purchases within legal
          limits.
        </p>
      </div>
    </div>
  );
}
