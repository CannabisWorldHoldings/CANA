import Link from 'next/link';
import { dealTemporalState } from '@/lib/card-logic.mjs';

/**
 * DealCard — the gold system (approved card species).
 * CLEAN_CREATIVE_LAW (recovered T5): the deal lives in TYPOGRAPHY, never
 * baked into imagery. Anatomy: gold eyebrow, typographic offer lockup,
 * merchant line, terms line, and a temporal state that never lies —
 * EXPIRED renders muted and says so; countdowns are never negative.
 */
export default function DealCard({
  href,
  title,
  merchantName,
  termsSummary,
  isActive,
  expiresAt,
}: {
  href: string;
  title: string;
  merchantName: string;
  termsSummary?: string;
  isActive: boolean;
  expiresAt?: string;
}) {
  const temporal = dealTemporalState({ isActive, expiresAt });
  const live = temporal.state === 'ACTIVE' || temporal.state === 'EXPIRING_SOON';

  return (
    <Link
      href={href}
      aria-disabled={!live}
      className={`group flex w-[280px] flex-col justify-between overflow-hidden bg-brand-surface p-5 transition-transform duration-[var(--owd-dur-std)] ease-[var(--owd-ease-standard)] min-[834px]:w-[320px] ${
        live ? 'hover:-translate-y-0.5' : 'opacity-60'
      }`}
      style={{ borderRadius: 'var(--owd-radius-card)', minHeight: '300px' }}
    >
      <div className="flex flex-col gap-3">
        <p className="owd-eyebrow" style={{ color: 'var(--brand-gold-onwhite)' }}>
          {temporal.state === 'EXPIRING_SOON' && typeof temporal.hoursLeft === 'number'
            ? temporal.hoursLeft < 1
              ? 'Ends within the hour'
              : `Ends in ${temporal.hoursLeft}h`
            : temporal.state === 'EXPIRED'
              ? 'Expired'
              : temporal.state === 'INACTIVE'
                ? 'Not currently active'
                : 'Verified deal'}
        </p>
        <p className="owd-h3 leading-tight text-brand-text">{title}</p>
        {termsSummary ? (
          <p className="owd-body-reduced leading-relaxed text-brand-muted">{termsSummary}</p>
        ) : null}
      </div>
      <div className="owd-hairline-t mt-4 flex items-center justify-between gap-3 pt-3">
        <p className="owd-body-reduced font-semibold text-brand-text">{merchantName}</p>
        <span className="owd-caption text-brand-muted">Full terms on the deal page</span>
      </div>
    </Link>
  );
}
