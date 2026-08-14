import Link from 'next/link';
import { gateProductPrice } from '@/lib/card-logic.mjs';

/**
 * ProductCard — real product on a quiet surface (approved card species).
 * 300×380 anatomy: image on --brand-surface, name, brand, and a price that
 * renders ONLY when the card-logic gate proves it is sourced, verified and
 * fresh (never a placeholder, never a guess). Carrier count is a fact line,
 * not a marketing claim.
 */
export default function ProductCard({
  href,
  name,
  brandName,
  category,
  photoUrl,
  photoAlt,
  priceCents,
  priceSourceVerified,
  priceFreshnessExpiresAt,
  carrierCount,
}: {
  href: string;
  name: string;
  brandName?: string;
  category?: string;
  photoUrl?: string;
  photoAlt?: string;
  priceCents?: number;
  priceSourceVerified?: boolean;
  priceFreshnessExpiresAt?: string;
  carrierCount?: number;
}) {
  const price = gateProductPrice({
    priceCents,
    sourceVerified: priceSourceVerified,
    freshnessExpiresAt: priceFreshnessExpiresAt,
  });

  return (
    <Link
      href={href}
      className="group block w-[240px] overflow-hidden bg-brand-surface transition-transform duration-[var(--owd-dur-std)] ease-[var(--owd-ease-standard)] hover:-translate-y-0.5 min-[834px]:w-[280px]"
      style={{ borderRadius: 'var(--owd-radius-card)' }}
    >
      <div className="relative flex aspect-square items-center justify-center overflow-hidden bg-brand-raised p-6">
        {photoUrl ? (
          /* SmartImage (P0.5) replaces this with an art-directed <picture>. */
          <img
            src={photoUrl}
            alt={photoAlt ?? `${name} product photo`}
            loading="lazy"
            className="h-full w-full object-contain transition-transform duration-[var(--owd-dur-slow)] ease-[var(--owd-ease-standard)] group-hover:scale-[1.03]"
          />
        ) : (
          <span className="owd-caption text-brand-muted">No photography yet</span>
        )}
      </div>
      <div className="flex flex-col gap-1 px-4 pb-4 pt-3">
        {category ? <p className="owd-caption text-brand-muted">{category}</p> : null}
        <p className="owd-body font-semibold leading-snug text-brand-text">{name}</p>
        {brandName ? <p className="owd-body-reduced text-brand-muted">{brandName}</p> : null}
        {price.show ? (
          <p className="owd-price mt-1 text-brand-text">
            {price.label}
            <span className="owd-price-qualifier text-brand-muted"> on a verified menu</span>
          </p>
        ) : null}
        {Number.isInteger(carrierCount) && (carrierCount as number) > 0 ? (
          <p className="owd-caption text-brand-muted">
            {carrierCount === 1 ? 'Carried by 1 verified shop' : `Carried by ${carrierCount} verified shops`}
          </p>
        ) : null}
      </div>
    </Link>
  );
}
