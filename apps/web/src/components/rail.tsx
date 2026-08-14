'use client';

import { useRef } from 'react';
import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * Rail — the horizontal discovery primitive (approved rail contract).
 * - scroll-snap with a structural right-edge peek: the next card is always
 *   partially visible, which IS the scroll affordance.
 * - 20px gaps (12px dense) from the token layer; frosted 36px paddles on
 *   pointer devices ≥1024px; touch scrolls natively below that.
 * - Labeled list semantics for assistive tech; paddles advance one "page"
 *   (the visible width), matching the studied store behavior.
 * - Below `minItems` the rail renders nothing: pages degrade honestly
 *   (callers decide whether an EmptyRecovery module takes the slot).
 */
export default function Rail({
  label,
  sublabel,
  itemCount,
  minItems = 4,
  dense = false,
  children,
}: {
  label: string;
  sublabel?: string;
  itemCount: number;
  minItems?: number;
  dense?: boolean;
  children: ReactNode;
}) {
  const scrollerRef = useRef<HTMLUListElement | null>(null);

  if (!Number.isInteger(itemCount) || itemCount < Math.max(1, minItems)) {
    return null;
  }

  const advance = (direction: 1 | -1) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    scroller.scrollBy({ left: direction * scroller.clientWidth, behavior: 'smooth' });
  };

  return (
    <section aria-label={label} className="relative">
      <div className="owd-container-commerce flex items-end justify-between gap-4">
        <h2 className="owd-h3 text-brand-text">
          {label}
          {sublabel ? <span className="owd-quiet font-normal"> {sublabel}</span> : null}
        </h2>
        <div className="hidden shrink-0 items-center gap-2 pb-1 min-[1024px]:flex">
          <button
            type="button"
            aria-label={`Scroll ${label} backward`}
            onClick={() => advance(-1)}
            className="frosted-nav flex h-9 w-9 items-center justify-center rounded-full text-brand-text transition-colors hover:text-brand-primary-text"
          >
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={`Scroll ${label} forward`}
            onClick={() => advance(1)}
            className="frosted-nav flex h-9 w-9 items-center justify-center rounded-full text-brand-text transition-colors hover:text-brand-primary-text"
          >
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        </div>
      </div>
      <ul
        ref={scrollerRef}
        className="mt-4 flex snap-x snap-mandatory overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{
          gap: dense ? 'var(--owd-rail-gap-dense)' : 'var(--owd-rail-gap)',
          paddingInlineStart: 'max(var(--owd-gutter-min-mobile), calc((100vw - var(--owd-content-commerce)) / 2))',
          paddingInlineEnd: '18vw',
          scrollPaddingInlineStart: 'max(var(--owd-gutter-min-mobile), calc((100vw - var(--owd-content-commerce)) / 2))',
        }}
      >
        {children}
      </ul>
    </section>
  );
}

/** List-item wrapper every rail card sits in: snap alignment + no shrink. */
export function RailItem({ children }: { children: ReactNode }) {
  return <li className="shrink-0 snap-start">{children}</li>;
}
