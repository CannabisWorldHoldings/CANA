'use client';

import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';

/**
 * DisclosureModal — the L3 surface of the disclosure ladder
 * (glance → facts → THIS → full page).
 * Desktop ≥735px: centered dialog, 28px radius, measured curtain material
 * (theme-aware color-mix + blur). Mobile ≤734px: bottom sheet with a drag
 * handle, 90dvh cap — the measured Apple behavior class.
 * Focus is trapped, body scroll locks, Escape and backdrop close, and the
 * opener regains focus on close. Reduced motion is honored by the global
 * kill-switch in globals.css.
 */
export default function DisclosureModal({
  open,
  onClose,
  eyebrow,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  eyebrow?: string;
  title: string;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
      previousFocus?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center max-[734px]:items-end"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      style={{
        background: 'color-mix(in srgb, var(--brand-text) 32%, transparent)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="disclosure-modal-title"
        className="animate-rise-in flex w-full max-w-[720px] flex-col overflow-hidden bg-brand-background max-[734px]:max-h-[90dvh] max-[734px]:max-w-none max-[734px]:rounded-b-none min-[735px]:mx-6 min-[735px]:max-h-[85vh]"
        style={{ borderRadius: 'var(--owd-radius-tile)' }}
      >
        <div className="hidden justify-center pt-2.5 max-[734px]:flex" aria-hidden="true">
          <span className="h-1 w-9 rounded-full bg-brand-border" />
        </div>
        <div className="flex items-start justify-between gap-4 px-6 pt-5 min-[735px]:px-8 min-[735px]:pt-7">
          <div className="flex flex-col gap-1">
            {eyebrow ? <p className="owd-eyebrow text-brand-primary-text">{eyebrow}</p> : null}
            <h2 id="disclosure-modal-title" className="owd-h3 text-brand-text">
              {title}
            </h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-raised text-brand-text transition-colors hover:text-brand-primary-text"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="owd-body overflow-y-auto px-6 pb-[max(24px,env(safe-area-inset-bottom))] pt-4 text-brand-text min-[735px]:px-8 min-[735px]:pb-8">
          {children}
        </div>
      </div>
    </div>
  );
}
