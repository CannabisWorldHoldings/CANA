import { getAsset } from '@/lib/asset-registry.mjs';

/**
 * SmartImage — the image pipeline primitive (approved image strategy).
 * - `<picture>` art direction: a distinct mobile crop swaps in at ≤734px
 *   (the measured content boundary). Desktop and mobile receive different
 *   CROPS, not scaled copies — the measured Apple practice (100% rate).
 * - Layout is always reserved via aspect-ratio (zero-CLS law).
 * - Lazy by default; `priority` marks the LCP image (eager + fetchpriority).
 * - Registry-first: pass `assetId` to resolve a registered record (court law
 *   A14); raw `src` remains for attested merchant media and fixture states.
 * Server component — no hooks, no client bundle cost.
 */
export default function SmartImage({
  assetId,
  src,
  mobileSrc,
  alt,
  aspect,
  mobileAspect,
  priority = false,
  fit = 'cover',
  className,
  sizes,
}: {
  assetId?: string;
  src?: string;
  mobileSrc?: string;
  alt?: string;
  aspect?: [number, number];
  mobileAspect?: [number, number];
  priority?: boolean;
  fit?: 'cover' | 'contain';
  className?: string;
  sizes?: string;
}) {
  const record = assetId ? getAsset(assetId) : null;
  if (assetId && !record) {
    // Court law A14: an unknown asset id renders nothing rather than a broken
    // or unregistered image. The visual court flags the miss.
    return null;
  }
  const resolvedSrc = record?.path ?? src;
  if (!resolvedSrc) return null;

  const resolvedAlt = alt ?? record?.altGuidance ?? '';
  const ratio = aspect ?? record?.aspect ?? null;
  const style = ratio ? { aspectRatio: `${ratio[0]} / ${ratio[1]}` } : undefined;

  const img = (
    <img
      src={resolvedSrc}
      alt={resolvedAlt}
      loading={priority ? 'eager' : 'lazy'}
      decoding={priority ? 'sync' : 'async'}
      fetchPriority={priority ? 'high' : 'auto'}
      sizes={sizes}
      className={className}
      style={{
        ...style,
        width: '100%',
        height: '100%',
        objectFit: fit,
      }}
    />
  );

  if (!mobileSrc) {
    return ratio ? <span className="block overflow-hidden" style={style}>{img}</span> : img;
  }

  return (
    <picture>
      <source
        media="(max-width: 734px)"
        srcSet={mobileSrc}
        {...(mobileAspect ? { width: mobileAspect[0] * 100, height: mobileAspect[1] * 100 } : {})}
      />
      {ratio ? <span className="block overflow-hidden" style={style}>{img}</span> : img}
    </picture>
  );
}
