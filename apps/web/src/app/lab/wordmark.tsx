/**
 * ORDERWEEDDC wordmark — expressive cursive/ribbon lettering.
 * Glossy black -> glossy deep dark green, slightly extended lowercase "d".
 * Variants: primary (light bg), inverse (dark bg), neon, hollow.
 */
export type WordmarkVariant = 'primary' | 'inverse' | 'neon' | 'hollow';

export function Wordmark({
  variant = 'primary',
  className = '',
  height = 64,
}: { variant?: WordmarkVariant; className?: string; height?: number }) {
  const id = `wm-${variant}`;
  const stops: Record<WordmarkVariant, Array<[string, string]>> = {
    primary: [['0%', '#000000'], ['42%', '#04140d'], ['72%', '#063d24'], ['100%', '#0a5c37']],
    inverse: [['0%', '#ffffff'], ['38%', '#d8efe2'], ['74%', '#3fbe80'], ['100%', '#0a5c37']],
    neon:    [['0%', '#0a5c37'], ['45%', '#12d67f'], ['100%', '#5cf5b0']],
    hollow:  [['0%', 'transparent'], ['100%', 'transparent']],
  };
  const isHollow = variant === 'hollow';
  return (
    <svg
      viewBox="0 0 620 132" height={height} role="img"
      aria-label="orderweeddc" className={className}
      style={{ display: 'block', width: 'auto', overflow: 'visible' }}
    >
      <defs>
        <linearGradient id={id} x1="0%" y1="0%" x2="100%" y2="18%">
          {stops[variant].map(([o, c]) => <stop key={o} offset={o} stopColor={c} />)}
        </linearGradient>
        <linearGradient id={`${id}-gloss`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.42" />
          <stop offset="46%" stopColor="#ffffff" stopOpacity="0.06" />
          <stop offset="47%" stopColor="#000000" stopOpacity="0.10" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {/* Cursive/ribbon wordmark. Italic + tight tracking reads as handwritten
          ribbon; the trailing "d" is extended via a separate tspan + flourish. */}
      <text
        x="6" y="92"
        fontFamily='"Space Grotesk", ui-sans-serif, system-ui'
        fontSize="94" fontWeight={700} fontStyle="italic"
        letterSpacing="-5.5"
        fill={isHollow ? 'none' : `url(#${id})`}
        stroke={isHollow ? 'currentColor' : 'none'}
        strokeWidth={isHollow ? 2.25 : 0}
      >
        orderwee<tspan letterSpacing="-1.5">d</tspan><tspan letterSpacing="-4">dc</tspan>
      </text>
      {!isHollow && (
        <text
          x="6" y="92" aria-hidden="true"
          fontFamily='"Space Grotesk", ui-sans-serif, system-ui'
          fontSize="94" fontWeight={700} fontStyle="italic"
          letterSpacing="-5.5" fill={`url(#${id}-gloss)`}
        >
          orderwee<tspan letterSpacing="-1.5">d</tspan><tspan letterSpacing="-4">dc</tspan>
        </text>
      )}
      {/* Ribbon flourish: the extended lowercase d sweeping under the mark. */}
      <path
        d="M474 104 C 430 124, 300 128, 176 118 C 108 112, 46 104, 20 96"
        fill="none"
        stroke={isHollow ? 'currentColor' : `url(#${id})`}
        strokeWidth={isHollow ? 2.25 : 5.5}
        strokeLinecap="round"
        opacity={isHollow ? 0.85 : 0.95}
      />
    </svg>
  );
}
