import { SPONSORSHIP_STATES, shouldRenderBadge } from '@/lib/sponsorship-entitlement.mjs';

/**
 * PER-CARD SPONSORSHIP BADGE — Mechanism Matrix M-001.
 *
 * Leafly discloses a sponsored block with one small section header and no
 * per-card badge, so a shopper cannot tell which card was bought. This
 * component is the inversion: the disclosure travels with the card.
 *
 * The badge NEVER renders from a boolean prop. It renders only from a resolved
 * entitlement backed by a persisted Demand Credit SPEND. Every non-ACTIVE state
 * renders nothing visible, so a card degrades to organic rather than showing an
 * unbacked sponsorship claim.
 *
 * Provenance attributes let the sponsorship court bind the pixel on screen to
 * the ledger row that paid for it.
 */
export type SponsorshipView = {
  state: string;
  label: string | null;
  reason: string;
  spendSeq: number | null;
  affectsOrganicOrder: false;
  evidence: {
    spend_seq: number;
    entry_hash: string;
    placement: string;
    funded_by_seq: number;
    expires_at: string;
    entitlement_digest: string;
  } | null;
};

export function SponsorshipBadge({
  sponsorship,
  className = '',
}: {
  sponsorship: SponsorshipView | null | undefined;
  className?: string;
}) {
  const state = sponsorship?.state ?? SPONSORSHIP_STATES.NONE;

  // LOADING: reserve space so the card does not shift when the badge resolves.
  if (state === SPONSORSHIP_STATES.LOADING) {
    return (
      <span
        data-sponsorship-state={state}
        aria-hidden="true"
        className={`inline-block h-[22px] w-[92px] animate-pulse rounded-full bg-brand-border/40 ${className}`}
      />
    );
  }

  // Every other non-ACTIVE state renders NOTHING visible. The state is still
  // emitted as a data attribute so courts and tests can assert the card was
  // evaluated and deliberately not badged — silence that can be verified.
  if (!shouldRenderBadge(state)) {
    return (
      <span
        data-sponsorship-state={state}
        data-sponsorship-reason={sponsorship?.reason ?? 'no entitlement'}
        hidden
      />
    );
  }

  const ev = sponsorship!.evidence!;
  return (
    <span
      // Provenance: binds this badge to the exact ledger row that entitles it.
      data-sponsorship-state={state}
      data-sponsorship-spend-seq={ev.spend_seq}
      data-sponsorship-entry-hash={ev.entry_hash}
      data-sponsorship-placement={ev.placement}
      data-sponsorship-entitlement={ev.entitlement_digest}
      data-sponsorship-affects-order="false"
      className={`inline-flex items-center gap-1.5 rounded-full border border-brand-primary/40 bg-brand-primary/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-brand-primary-text ${className}`}
      title="Paid placement. Sponsorship never changes the order of results."
    >
      <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true" fill="currentColor">
        <circle cx="6" cy="6" r="5" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <path d="M6 3.2v3.4M6 8.2v.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
      <span>{sponsorship!.label}</span>
      {/* Screen-reader clarification: the visual label alone can read as an
          endorsement, so state the ordering guarantee in the accessible name. */}
      <span className="sr-only">
        . This is a paid placement. It does not affect the order of results.
      </span>
    </span>
  );
}
