import Link from 'next/link';
import { MapPin } from 'lucide-react';
import { DataStatusBadge } from '@/components/data-status-badge';
import { selectMerchantFactChip } from '@/lib/card-logic.mjs';

type EvidenceProps = {
  dataStatus: string;
  isDemonstration: boolean;
  verifiedAt?: Date | null;
  freshnessExpiresAt?: Date | null;
};

/**
 * MerchantCard — the merchant IS the image (approved card species).
 * 4:5 photo-led composition at rail scale; name + neighborhood + EXACTLY ONE
 * fact chip (evidence state > verified deal > distance — card-logic law).
 * No photography → the honest typographic variant on the existing listing
 * surface; never a stock storefront, never a generated one.
 * Presentation-only: every field arrives verified by the caller.
 */
export default function MerchantCard({
  href,
  name,
  neighborhood,
  photoUrl,
  photoAlt,
  evidence,
  activeDealTitle,
  distanceLabel,
  type = 'storefront',
}: {
  href: string;
  name: string;
  neighborhood?: string;
  photoUrl?: string;
  photoAlt?: string;
  evidence?: EvidenceProps;
  activeDealTitle?: string;
  distanceLabel?: string;
  type?: 'storefront' | 'delivery';
}) {
  const chip = selectMerchantFactChip({
    evidenceState: evidence?.dataStatus,
    activeDealTitle,
    distanceLabel,
  });

  return (
    <Link
      href={href}
      className="group block w-[280px] overflow-hidden bg-brand-surface transition-transform duration-[var(--owd-dur-std)] ease-[var(--owd-ease-standard)] hover:-translate-y-0.5 min-[834px]:w-[320px]"
      style={{ borderRadius: 'var(--owd-radius-card)' }}
    >
      <div className="relative aspect-[4/5] overflow-hidden bg-brand-raised">
        {photoUrl ? (
          /* SmartImage (P0.5) replaces this with an art-directed <picture>. */
          <img
            src={photoUrl}
            alt={photoAlt ?? `${name} photography`}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-[var(--owd-dur-slow)] ease-[var(--owd-ease-standard)] group-hover:scale-[1.02]"
          />
        ) : (
          <div
            className={`listing-visual ${type === 'delivery' ? 'listing-visual--delivery' : 'listing-visual--storefront'}`}
            aria-hidden="true"
          >
            <span>{type === 'delivery' ? 'Delivery service' : 'Storefront'}</span>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1.5 px-4 pb-4 pt-3">
        <p className="owd-body font-semibold leading-snug text-brand-text">{name}</p>
        {neighborhood ? (
          <p className="owd-body-reduced flex items-center gap-1 text-brand-muted">
            <MapPin size={12} aria-hidden="true" />
            {neighborhood}
          </p>
        ) : null}
        {chip ? (
          <div className="mt-1">
            {chip.kind === 'evidence' && evidence ? (
              <DataStatusBadge
                dataStatus={evidence.dataStatus}
                isDemonstration={evidence.isDemonstration}
                verifiedAt={evidence.verifiedAt}
                freshnessExpiresAt={evidence.freshnessExpiresAt}
                compact
              />
            ) : (
              <span className="tint-chip">{chip.value}</span>
            )}
          </div>
        ) : null}
      </div>
    </Link>
  );
}
