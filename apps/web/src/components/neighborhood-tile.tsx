import Link from 'next/link';
import { neighborhoodCountsLine } from '@/lib/card-logic.mjs';

/**
 * NeighborhoodTile — real local photography with an honest counts line
 * (approved card species). 3:2 photographic tile; the name sits on a
 * measured veil; the verified-count chip follows the media-overlay law
 * (small, frosted, off-subject) and never inflates: zero renders as
 * "Verification in progress".
 */
export default function NeighborhoodTile({
  href,
  name,
  verifiedCount,
  photoUrl,
  photoAlt,
}: {
  href: string;
  name: string;
  verifiedCount: number;
  photoUrl?: string;
  photoAlt?: string;
}) {
  return (
    <Link
      href={href}
      className="group relative block w-[300px] overflow-hidden bg-brand-raised transition-transform duration-[var(--owd-dur-std)] ease-[var(--owd-ease-standard)] hover:-translate-y-0.5 min-[834px]:w-[360px]"
      style={{ borderRadius: 'var(--owd-radius-card)' }}
    >
      <div className="relative aspect-[3/2] overflow-hidden">
        {photoUrl ? (
          /* SmartImage (P0.5) replaces this with an art-directed <picture>. */
          <img
            src={photoUrl}
            alt={photoAlt ?? `${name}, Washington, D.C.`}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-[var(--owd-dur-slow)] ease-[var(--owd-ease-standard)] group-hover:scale-[1.02]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-brand-raised">
            <span className="owd-caption text-brand-muted">Local photography coming</span>
          </div>
        )}
        <div
          className="absolute inset-x-0 bottom-0 h-2/5"
          style={{
            background:
              'linear-gradient(0deg, rgba(3, 10, 6, 0.72) 0%, rgba(3, 10, 6, 0.25) 60%, transparent 100%)',
          }}
          aria-hidden="true"
        />
        <p className="owd-h3 absolute bottom-3 left-4 right-4 text-white">{name}</p>
        <span className="media-overlay right-3 top-3 text-brand-text">
          {neighborhoodCountsLine({ verifiedCount })}
        </span>
      </div>
    </Link>
  );
}
