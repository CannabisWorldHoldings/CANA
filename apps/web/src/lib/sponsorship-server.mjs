/**
 * Server-side sponsorship resolution shared by every production surface.
 *
 * Mechanism Matrix M-001. Wiring each page separately invited drift: the
 * homepage was gated while /neighborhoods, /products and /compare still made
 * sponsorship CLAIMS from the raw retailer.isSponsored boolean. A merchant flag
 * an admin can set is not evidence of a paid placement, and three surfaces
 * saying different things about the same merchant is worse than one saying
 * nothing.
 *
 * One helper, one contract, used everywhere.
 */
import { resolveSponsorship, dedupeSponsoredCards, SPONSORSHIP_STATES } from './sponsorship-entitlement.mjs';

export { SPONSORSHIP_STATES };

/**
 * Resolve entitlements for a set of merchants from the persisted ledger.
 *
 * FAIL CLOSED: if the ledger read throws, every merchant resolves UNAVAILABLE,
 * which renders nothing. An outage silently removes badges rather than silently
 * asserting unpaid sponsorship.
 *
 * @returns {{ for: (id:string) => object|null, isActive: (id:string) => boolean,
 *             label: (id:string) => string|null, available: boolean }}
 */
export async function resolveSponsorshipFor(prisma, merchantIds, placement = 'FEATURED_CARD') {
  const ids = [...new Set((merchantIds || []).filter((i) => typeof i === 'string' && i.length))];
  let rows = [];
  let available = true;
  if (ids.length) {
    try {
      rows = await prisma.demandCreditEntry.findMany({
        where: { merchantId: { in: ids } },
        orderBy: { seq: 'asc' },
      });
    } catch {
      available = false;
    }
  }

  const byId = new Map(
    ids.map((id) => [id, resolveSponsorship({ merchantId: id, entries: rows, placement, ledgerAvailable: available })]),
  );
  // One merchant may not occupy the same slot on multiple cards.
  const allowed = dedupeSponsoredCards(
    ids.map((id) => ({ id, merchantId: id, placement, sponsorshipState: byId.get(id)?.state })),
  );

  const forId = (id) => {
    const s = byId.get(id);
    if (!s) return null;
    if (s.state === SPONSORSHIP_STATES.ACTIVE && !allowed.has(id)) {
      return { ...s, state: SPONSORSHIP_STATES.NONE, label: null, evidence: null, reason: 'duplicate campaign suppressed' };
    }
    return s;
  };

  return {
    for: forId,
    isActive: (id) => forId(id)?.state === SPONSORSHIP_STATES.ACTIVE,
    /**
     * Human-readable disclosure for prose surfaces (comparison tables, meta
     * lines). Returns null when there is no entitlement, so callers render the
     * organic wording rather than inventing a sponsorship claim.
     */
    label: (id) => {
      const s = forId(id);
      return s?.state === SPONSORSHIP_STATES.ACTIVE ? s.label : null;
    },
    available,
  };
}
