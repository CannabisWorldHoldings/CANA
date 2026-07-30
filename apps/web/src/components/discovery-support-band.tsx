import Link from 'next/link';
import {
  BadgePercent,
  BookOpenCheck,
  LifeBuoy,
  Scale,
} from 'lucide-react';
import { PUBLIC_SUPPORT_EMAIL } from '@/lib/product-brand';

const PATHS = [
  {
    href: '/deals',
    label: 'Check current deals',
    detail: 'See terms, expiry, and data status before relying on an offer.',
    icon: BadgePercent,
  },
  {
    href: '/compare',
    label: 'Compare evidence',
    detail: 'Put freshness, sourcing, and sponsorship disclosures side by side.',
    icon: Scale,
  },
  {
    href: '/education',
    label: 'Learn D.C. rules',
    detail: 'Understand patient access and local compliance in plain language.',
    icon: BookOpenCheck,
  },
];

export default function DiscoverySupportBand() {
  return (
    <section className="border-t border-brand-border bg-brand-surface px-4 py-12 sm:px-6 lg:px-8">
      <div className="support-band-panel mx-auto max-w-7xl overflow-hidden rounded-3xl border border-brand-primary/20">
        <div className="grid gap-8 p-6 sm:p-8 lg:grid-cols-[1.1fr_1.9fr] lg:p-10">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-brand-primary/25 bg-brand-primary/10 px-3 py-1 text-[11px] font-bold text-brand-primary">
              <LifeBuoy size={13} aria-hidden="true" />
              Support without tracking
            </span>
            <h2 className="mt-4 font-display text-2xl font-bold text-brand-text sm:text-3xl">
              Get a clear answer before you go.
            </h2>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-brand-muted">
              We route people to evidence, not paid rankings. If a listing looks
              wrong, send the record and source to{' '}
              <a
                href={`mailto:${PUBLIC_SUPPORT_EMAIL}?subject=ORDERWEEDDC%20support`}
                className="font-bold text-brand-primary hover:underline"
              >
                {PUBLIC_SUPPORT_EMAIL}
              </a>
              .
            </p>
            <Link
              href="/help"
              className="mt-5 inline-flex rounded-xl bg-brand-primary px-5 py-3 text-xs font-bold text-white transition-all hover:brightness-110 active:scale-[0.98]"
            >
              Open the help center →
            </Link>
          </div>

          <nav
            aria-label="Fast paths"
            className="grid gap-3 sm:grid-cols-3"
          >
            {PATHS.map(({ href, label, detail, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className="group rounded-2xl border border-brand-border bg-brand-background/70 p-5 transition-all hover:-translate-y-0.5 hover:border-brand-primary/40"
              >
                <Icon
                  size={20}
                  className="text-brand-primary"
                  aria-hidden="true"
                />
                <span className="mt-4 block text-sm font-bold text-brand-text group-hover:text-brand-primary">
                  {label}
                </span>
                <span className="mt-2 block text-xs leading-relaxed text-brand-muted">
                  {detail}
                </span>
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </section>
  );
}
