import {
  assertRegisteredImage,
  getAssetByPath,
  resolveAssetUse,
} from '@/lib/asset-registry.mjs';
import type { CSSProperties } from 'react';

type AssetContext =
  | 'chrome'
  | 'footer'
  | 'og'
  | 'campaign'
  | 'hero-ambience'
  | 'category-navigation'
  | 'campaign-ambience'
  | 'district-feature'
  | 'demonstration'
  | 'styleguide';

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
  context,
  src,
  mobileSrc,
  alt,
  aspect,
  mobileAspect,
  priority = false,
  fit = 'cover',
  className,
  sizes,
  fill = false,
  pendingRightsCapability = null,
  representsRealEntity = false,
}: {
  assetId?: string;
  context: AssetContext;
  src?: string;
  mobileSrc?: string;
  alt?: string;
  aspect?: [number, number];
  mobileAspect?: [number, number];
  priority?: boolean;
  fit?: 'cover' | 'contain';
  className?: string;
  sizes?: string;
  fill?: boolean;
  pendingRightsCapability?: object | null;
  representsRealEntity?: boolean;
}) {
  const sourceRecord = !assetId && src ? getAssetByPath(src) : null;
  const record = assetId
    ? resolveAssetUse(assetId, context, { pendingRightsCapability, representsRealEntity })
    : sourceRecord
      ? resolveAssetUse(sourceRecord.id, context, {
          pendingRightsCapability,
          representsRealEntity,
        })
      : null;
  if ((assetId || sourceRecord) && !record) return null;
  const resolvedSrc = record?.path ?? src;
  if (!resolvedSrc) return null;
  assertRegisteredImage(resolvedSrc);
  const mobileRecord = mobileSrc ? getAssetByPath(mobileSrc) : null;
  const authorizedMobileRecord = mobileRecord
    ? resolveAssetUse(mobileRecord.id, context, {
        pendingRightsCapability,
        representsRealEntity,
      })
    : null;
  if (mobileRecord && !authorizedMobileRecord) return null;
  const resolvedMobileSrc = authorizedMobileRecord?.path ?? mobileSrc;
  if (resolvedMobileSrc) assertRegisteredImage(resolvedMobileSrc);

  const resolvedAlt = alt ?? record?.altGuidance ?? '';
  const ratio = aspect ?? record?.aspect ?? null;
  const reservedStyle = ratio ? { aspectRatio: `${ratio[0]} / ${ratio[1]}` } : undefined;
  const frameStyle: CSSProperties = fill
    ? { position: 'absolute', inset: 0, overflow: 'hidden' }
    : { display: 'block', overflow: 'hidden', ...reservedStyle };

  const img = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={resolvedSrc}
      alt={resolvedAlt}
      loading={priority ? 'eager' : 'lazy'}
      decoding={priority ? 'sync' : 'async'}
      fetchPriority={priority ? 'high' : 'auto'}
      sizes={sizes}
      className={className}
      style={{
        width: '100%',
        height: '100%',
        objectFit: fit,
      }}
    />
  );

  const frameProps = {
    className: `smart-image${fill ? ' smart-image--fill' : ''}`,
    style: frameStyle,
    'data-asset-id': record?.id,
    'data-asset-context': record ? context : undefined,
    'data-asset-rights': record?.rights,
  };

  if (!resolvedMobileSrc) return <span {...frameProps}>{img}</span>;

  return (
    <picture {...frameProps}>
      <source
        media="(max-width: 734px)"
        srcSet={resolvedMobileSrc}
        {...(mobileAspect ? { width: mobileAspect[0] * 100, height: mobileAspect[1] * 100 } : {})}
      />
      {img}
    </picture>
  );
}
