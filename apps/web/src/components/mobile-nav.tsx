'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Menu, X } from 'lucide-react';

type NavLink = { href: string; label: string };

export default function MobileNav({ links }: { links: NavLink[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="md:hidden">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={open ? 'Close navigation menu' : 'Open navigation menu'}
        className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg border border-[#cbd1cc] text-brand-text transition-colors hover:border-[#11643d]"
      >
        {open ? <X size={18} /> : <Menu size={18} />}
      </button>
      {open && (
        <nav
          aria-label="Mobile navigation"
          className="absolute inset-x-0 top-full z-50 bg-white animate-fade-in"
        >
          <ul className="mx-auto max-w-7xl space-y-1 px-4 py-4">
            {links.map((link) => (
              <li key={`${link.href}-${link.label}`}>
                <Link
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="block rounded-lg px-4 py-3 text-sm font-semibold text-brand-text transition-colors hover:bg-brand-raised hover:text-brand-primary-text"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}
