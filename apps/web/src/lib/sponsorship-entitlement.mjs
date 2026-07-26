/**
 * SPONSORSHIP ENTITLEMENT — the gate between a paid placement and a rendered badge.
 *
 * Mechanism Matrix M-001. Competitor pattern (Leafly, evidence 2026-07-23):
 * the first five DC results are a sponsored block disclosed by ONE small
 * section header with no per-card badge, so a shopper cannot tell which card
 * was bought.
 *
 * Our inversion is stronger and therefore riskier: every sponsored card is
 * labeled individually, and organic ordering is provably unaffected. A claim
 * like that is only worth making if it cannot be faked — so a badge may only
 * render when a PERSISTED Demand Credit SPEND entitles it.
 *
 * FAIL-CLOSED: absent, expired, refunded, forged, or evidence-less entitlement
 * renders NOTHING. A card silently loses its badge rather than displaying an
 * unbacked sponsorship claim.
 *
 * This module is pure and synchronous so it can be unit-tested exhaustively and
 * called from server components without I/O.
 */
import { createHash } from 'node:crypto';
import { hashBody } from './demand-credits.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');

/**
 * Recompute a row's hash and compare it to the recorded one.
 *
 * MEDIUM defect (independent verifier, production): the previous check only
 * asserted that entryHash and prevHash were non-blank STRINGS. A row written
 * directly to the table with entryHash='x', prevHash='y' therefore rendered a
 * fully visible, gold-ringed "Sponsored placement" badge for a merchant who had
 * paid nothing. The comment claimed "chain-linked"; the code checked presence.
 *
 * The real hashing authority already existed in demand-credits.mjs and was
 * simply never called from here. It is now.
 *
 * Rows may arrive from Prisma (Date objects) or from a plain fixture (ISO
 * strings). hashBody serializes via JSON.stringify, which renders a Date as an
 * ISO string, so both shapes hash identically — but only when the value is
 * genuinely a date. Normalize before hashing so a legitimate row is never
 * rejected for a representation difference.
 */
function hashVerified(row) {
  if (!text(row?.entryHash) || !text(row?.prevHash)) return false;
  const norm = {
    ...row,
    expiresAt: row.expiresAt instanceof Date ? row.expiresAt.toISOString() : row.expiresAt ?? null,
    observedAt: row.observedAt instanceof Date ? row.observedAt.toISOString() : row.observedAt ?? null,
  };
  try {
    return hashBody(norm, row.prevHash) === row.entryHash;
  } catch {
    return false;
  }
}
const text = (v) => typeof v === 'string' && v.trim().length > 0;

/** Every state a sponsorship slot can be in. Rendering must handle all of them. */
export const SPONSORSHIP_STATES = Object.freeze({
  ACTIVE: 'ACTIVE',                       // entitled: render the labeled badge
  NONE: 'NONE',                           // organic card: render nothing
  LOADING: 'LOADING',                     // entitlement not yet resolved
  EXPIRED: 'EXPIRED',                     // campaign window has passed
  REFUNDED: 'REFUNDED',                   // spend was reversed
  UNAVAILABLE: 'UNAVAILABLE',             // ledger unreachable — fail closed
  INVALID_EVIDENCE: 'INVALID_EVIDENCE',   // entitlement does not verify
});

/** States that may render a visible sponsorship badge. Deliberately one. */
const RENDERABLE = new Set([SPONSORSHIP_STATES.ACTIVE]);

/**
 * Resolve a sponsorship entitlement from persisted ledger rows.
 *
 * @param {object} args
 * @param {string} args.merchantId
 * @param {Array}  args.entries      DemandCreditEntry rows for this merchant
 * @param {string} args.placement    which slot this card is rendering
 * @param {Date}   [args.now]
 * @param {boolean}[args.loading]    entitlement fetch still in flight
 * @param {boolean}[args.ledgerAvailable]
 * @returns {{state:string, label:string|null, reason:string, spendSeq:number|null,
 *            affectsOrganicOrder:false, evidence:object|null}}
 */
export function resolveSponsorship({
  merchantId,
  entries,
  placement,
  now = new Date(),
  loading = false,
  ledgerAvailable = true,
}) {
  const base = { label: null, spendSeq: null, affectsOrganicOrder: false, evidence: null };

  if (loading) {
    return { ...base, state: SPONSORSHIP_STATES.LOADING, reason: 'entitlement not yet resolved' };
  }
  // Fail closed: an unreachable ledger must never fall back to "assume paid".
  if (!ledgerAvailable) {
    return { ...base, state: SPONSORSHIP_STATES.UNAVAILABLE, reason: 'ledger unavailable — refusing to assert sponsorship without its record' };
  }
  if (!text(merchantId) || !Array.isArray(entries)) {
    return { ...base, state: SPONSORSHIP_STATES.INVALID_EVIDENCE, reason: 'missing merchant or entry set' };
  }

  // Only this merchant's SPEND rows for this exact placement.
  const spends = entries.filter(
    (e) => e && e.merchantId === merchantId && e.kind === 'SPEND' && e.placement === placement,
  );
  if (spends.length === 0) {
    return { ...base, state: SPONSORSHIP_STATES.NONE, reason: 'no paid placement for this slot' };
  }

  // Newest first: the most recent campaign governs the card.
  spends.sort((a, b) => b.seq - a.seq);
  const spend = spends[0];

  // A spend that ever claimed to alter ordering is not renderable, full stop.
  // D-4: match the ledger's strictness. `=== true` let affectsOrganicOrder:1
  // through; any non-false, non-null value is an attempted rank purchase.
  if (spend.affectsOrganicOrder !== false && spend.affectsOrganicOrder != null) {
    return { ...base, state: SPONSORSHIP_STATES.INVALID_EVIDENCE, reason: 'entitlement claims to affect organic order — refused' };
  }
  // Disclosure text is part of the entitlement, not a UI decoration.
  if (!text(spend.disclosureLabel)) {
    return { ...base, state: SPONSORSHIP_STATES.INVALID_EVIDENCE, reason: 'entitlement carries no disclosure label' };
  }
  // Forgery check: RECOMPUTE the hash. A presence check is not verification.
  if (!hashVerified(spend)) {
    return { ...base, state: SPONSORSHIP_STATES.INVALID_EVIDENCE,
      reason: 'entitlement hash does not verify against its content — forged or tampered row' };
  }

  // Refund check: cumulative refunds against this spend cancel the entitlement.
  const spentCents = Math.round(Math.abs(spend.amount) * 100);
  const refundRows = entries
    .filter((e) => e && e.merchantId === merchantId && e.kind === 'REFUND' && e.originalSeq === spend.seq);
  // D-2 (independent verifier, MEDIUM): the sum had no finiteness or sign guard.
  // A NEGATIVE refund revived a fully-refunded placement, and a NaN/undefined
  // amount silently nullified an entire refund set — both keeping the badge
  // ACTIVE. A refund row that is not a positive finite number is not evidence
  // of anything; fail closed rather than quietly discounting it.
  const badRefund = refundRows.find(
    (e) => typeof e.amount !== 'number' || !Number.isFinite(e.amount) || e.amount <= 0,
  );
  if (badRefund) {
    return { ...base, state: SPONSORSHIP_STATES.INVALID_EVIDENCE, spendSeq: spend.seq,
      reason: `refund at seq=${badRefund.seq} has a non-positive or non-finite amount (${JSON.stringify(badRefund.amount)})` };
  }
  const refundedCents = refundRows.reduce((s, e) => s + Math.round(e.amount * 100), 0);
  if (refundedCents >= spentCents && spentCents > 0) {
    return { ...base, state: SPONSORSHIP_STATES.REFUNDED, spendSeq: spend.seq, reason: 'placement was fully refunded' };
  }

  // Expiry: governed by the ISSUE that funded this campaign.
  //
  // D-1 (independent verifier, HIGH): forgery-checking the SPEND while trusting
  // the ISSUE was ASYMMETRIC. An unlinked forged ISSUE with a far-future expiry
  // could out-rank the real expired funding and revive a dead campaign into a
  // visible badge — the deception-positive direction. Every row that governs
  // entitlement must clear the same bar.
  const issues = entries
    .filter((e) => e && e.merchantId === merchantId && e.kind === 'ISSUE' && e.seq < spend.seq)
    .sort((a, b) => b.seq - a.seq);
  const unlinkedFunding = issues.find((e) => !hashVerified(e));
  if (unlinkedFunding) {
    return { ...base, state: SPONSORSHIP_STATES.INVALID_EVIDENCE, spendSeq: spend.seq,
      reason: `funding ISSUE at seq=${unlinkedFunding.seq} does not hash-verify — forged or tampered row` };
  }
  const funding = issues[0];
  if (!funding) {
    return { ...base, state: SPONSORSHIP_STATES.INVALID_EVIDENCE, spendSeq: spend.seq, reason: 'no funding ISSUE precedes this spend' };
  }
  const exp = funding.expiresAt instanceof Date ? funding.expiresAt : (funding.expiresAt ? new Date(funding.expiresAt) : null);
  if (!exp || Number.isNaN(exp.getTime())) {
    return { ...base, state: SPONSORSHIP_STATES.INVALID_EVIDENCE, spendSeq: spend.seq, reason: 'funding carries no valid expiry' };
  }
  if (exp.getTime() <= now.getTime()) {
    return { ...base, state: SPONSORSHIP_STATES.EXPIRED, spendSeq: spend.seq, reason: `campaign expired ${exp.toISOString()}` };
  }

  return {
    state: SPONSORSHIP_STATES.ACTIVE,
    label: spend.disclosureLabel.trim(),
    reason: 'entitled by a chain-linked, unexpired, unrefunded placement',
    spendSeq: spend.seq,
    affectsOrganicOrder: false,
    evidence: {
      spend_seq: spend.seq,
      entry_hash: spend.entryHash,
      placement: spend.placement,
      funded_by_seq: funding.seq,
      expires_at: exp.toISOString(),
      // Lets Brand/Sponsorship courts bind the badge on screen to the ledger row.
      entitlement_digest: sha(`${merchantId}|${spend.seq}|${spend.entryHash}`).slice(0, 24),
    },
  };
}

/** Only ACTIVE renders a badge. Everything else renders nothing. */
export function shouldRenderBadge(state) {
  return RENDERABLE.has(state);
}

/**
 * Deduplicate campaigns across a card list: one merchant must not occupy the
 * same placement slot on multiple cards, which would read as a sponsored block.
 * Returns the set of card ids permitted to show a badge.
 */
export function dedupeSponsoredCards(cards) {
  const seen = new Set();
  const allowed = new Set();
  for (const c of cards) {
    if (!c || c.sponsorshipState !== SPONSORSHIP_STATES.ACTIVE) continue;
    // D-3: length-prefixed so 'a|b'+'c' cannot collide with 'a'+'b|c'.
    const key = `${String(c.merchantId ?? '').length}:${c.merchantId}|${String(c.placement ?? '').length}:${c.placement}`;
    if (seen.has(key)) continue; // duplicate campaign display — suppress
    seen.add(key);
    allowed.add(c.id);
  }
  return allowed;
}
