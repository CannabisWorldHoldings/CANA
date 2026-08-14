import Link from 'next/link';

/**
 * EditorialCard — learning has its own species (approved card contract).
 * 16:9 imagery, topic eyebrow, 21px title, and a VISIBLE date — education
 * without a citation date fails the court.
 */
export default function EditorialCard({
  href,
  title,
  topic,
  publishedAt,
  imageUrl,
  imageAlt,
}: {
  href: string;
  title: string;
  topic?: string;
  publishedAt: string;
  imageUrl?: string;
  imageAlt?: string;
}) {
  const date = new Date(publishedAt);
  const dateLabel = Number.isNaN(date.getTime())
    ? null
    : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <Link
      href={href}
      className="group block w-[300px] overflow-hidden transition-transform duration-[var(--owd-dur-std)] ease-[var(--owd-ease-standard)] hover:-translate-y-0.5 min-[834px]:w-[340px]"
    >
      <div
        className="relative aspect-video overflow-hidden bg-brand-raised"
        style={{ borderRadius: 'var(--owd-radius-card)' }}
      >
        {imageUrl ? (
          /* SmartImage (P0.5) replaces this with an art-directed <picture>. */
          <img
            src={imageUrl}
            alt={imageAlt ?? ''}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-[var(--owd-dur-slow)] ease-[var(--owd-ease-standard)] group-hover:scale-[1.02]"
          />
        ) : null}
      </div>
      <div className="flex flex-col gap-1 pt-3">
        {topic ? <p className="owd-caption font-semibold text-brand-primary-text">{topic}</p> : null}
        <p className="owd-body font-semibold leading-snug text-brand-text group-hover:text-brand-primary-text">
          {title}
        </p>
        {dateLabel ? <p className="owd-caption text-brand-muted">{dateLabel}</p> : null}
      </div>
    </Link>
  );
}
