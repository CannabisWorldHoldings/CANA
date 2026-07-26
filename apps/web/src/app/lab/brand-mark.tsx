/**
 * ORDERWEEDDC canonical brand mark.
 *
 * LOGO LAW: this component renders the APPROVED RIBBON ASSET ONLY.
 * It never typesets, redraws, or substitutes a font for the wordmark.
 * The prior `wordmark.tsx` (italic Space Grotesk + drawn flourish) violated
 * this law and is retained only as a rejected fixture.
 *
 * Every render exposes machine-readable provenance so Brand Fidelity Court
 * can verify the bytes on screen trace to the canonical source hash.
 */

export type BrandVariant = 'primary' | 'inverse';

/** Canonical asset registry. Hashes are the SHA-256 of the bound PNG bytes. */
export const BRAND_ASSETS = {
  primary: {
    id: 'orderweeddc-ribbon-primary',
    src: '/brand/orderweeddc-ribbon-primary.png',
    sha256: 'd6a4faf9b532bcda72b79bf9571140cfdfcd2c3d39301a8108acacc85929de0d',
    width: 1858,
    height: 387,
    aspect: 1858 / 387,
    use: 'light backgrounds — glossy black transitioning to deep dark green',
  },
  inverse: {
    id: 'orderweeddc-ribbon-inverse',
    src: '/brand/orderweeddc-ribbon-inverse.png',
    sha256: 'a426413d4c4a0f804de59882c7058f4e20d6a851b8c56d30957498e0131383c3',
    width: 1794,
    height: 350,
    aspect: 1794 / 350,
    use: 'dark backgrounds — silver/white transitioning to deep dark green',
  },
} as const;

/**
 * Renders the canonical mark. `width` drives layout; height is derived from the
 * asset's true aspect ratio so the ribbon can never be stretched or squashed.
 */
export function BrandMark({
  variant,
  theme,
  width = 420,
  maxWidthVw,
  className = '',
  priority = true,
}: {
  /** Explicit variant. Omit and pass `theme` to select automatically. */
  variant?: BrandVariant;
  /** Theme-driven selection: day -> primary, night -> inverse. */
  theme?: 'day' | 'night';
  width?: number;
  /** Cap width to a share of the viewport WITHOUT distorting aspect. */
  maxWidthVw?: number;
  className?: string;
  priority?: boolean;
}) {
  // Variant must follow the theme, or the mark disappears into the canvas.
  const resolved: BrandVariant = variant ?? (theme === 'night' ? 'inverse' : 'primary');
  const a = BRAND_ASSETS[resolved];
  const height = Math.round(width / a.aspect);
  return (
    <img
      src={a.src}
      alt="orderweeddc"
      aria-label="orderweeddc"
      width={width}
      height={height}
      className={className}
      loading={priority ? 'eager' : 'lazy'}
      decoding={priority ? 'sync' : 'async'}
      // Provenance for Brand Fidelity Court — asserts WHICH bytes are on screen.
      data-brand-asset-id={a.id}
      data-brand-source-sha256={a.sha256}
      data-brand-variant={resolved}
      data-brand-intrinsic={`${a.width}x${a.height}`}
      // Never distort the approved letterform.
      style={{
        display: 'block',
        // Width may shrink responsively; aspectRatio keeps the letterform exact
        // so the ribbon can never stretch (Brand Fidelity Court: ASPECT_DRIFT).
        width: maxWidthVw ? `min(${width}px, ${maxWidthVw}vw)` : width,
        height: 'auto',
        aspectRatio: `${a.width} / ${a.height}`,
        objectFit: 'contain',
      }}
    />
  );
}
