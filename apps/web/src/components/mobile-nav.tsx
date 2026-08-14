'use client';

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { Menu, X } from 'lucide-react';

type NavLink = { href: string; label: string };

/**
 * Full-height navigation sheet (approved mobile chrome contract).
 * - Trigger lives in the 48px bar; the sheet fills the viewport below it
 *   (100dvh − 48px) with large 28px/600 rows — a designed place, not a
 *   shrunken dropdown.
 * - Body scroll locks while open; Escape closes; safe-area respected.
 * - `secondaryLinks` render as a quieter group; `utility` hosts controls
 *   relocated out of the header (e.g. the daypart theme toggle).
 */
export default function MobileNav({
  links,
  secondaryLinks = [],
  utility,
}: {
  links: NavLink[];
  secondaryLinks?: NavLink[];
  utility?: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="min-[834px]:hidden">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={open ? 'Close navigation menu' : 'Open navigation menu'}
        className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full text-brand-text transition-colors hover:text-brand-primary-text"
      >
        {open ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
      </button>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Navigation menu"
          className="fixed inset-x-0 top-12 bottom-0 z-40 overflow-y-auto overscroll-contain bg-brand-background animate-fade-in"
          style={{ height: 'calc(100dvh - 48px)' }}
        >
          <nav
            aria-label="Mobile navigation"
            className="mx-auto flex min-h-full w-[87.5%] max-w-md flex-col pb-[max(28px,env(safe-area-inset-bottom))] pt-3"
          >
            <ul className="flex flex-col">
              {links.map((link) => (
                <li key={`${link.href}-${link.label}`} className="owd-hairline-b">
                  <Link
                    href={link.href}
                    onClick={() => setOpen(false)}
                    className="block py-3.5 text-[28px] font-semibold tracking-[-0.01em] text-brand-text transition-colors hover:text-brand-primary-text"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
            {secondaryLinks.length > 0 && (
              <ul className="mt-6 flex flex-col gap-1">
                {secondaryLinks.map((link) => (
                  <li key={`${link.href}-${link.label}`}>
                    <Link
                      href={link.href}
                      onClick={() => setOpen(false)}
                      className="owd-body block py-2 text-brand-muted transition-colors hover:text-brand-text"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {utility ? (
              <div className="mt-auto flex items-center justify-between gap-4 pt-8">
                {utility}
              </div>
            ) : null}
          </nav>
        </div>
      )}
    </div>
  );
}
