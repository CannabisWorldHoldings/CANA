import { createHash } from 'node:crypto';

/**
 * MERCHANT GROWTH OS — the evidence layer behind the merchant-facing growth page.
 *
 * WHY THIS EXISTS AS A PURE MODULE. The merchant dashboard renders counts
 * (menu entries, deals, referrals) and nothing else: none of the visibility
 * audit, the attribution ledger, or proof-of-value ever reached the merchant who
 * is being asked to pay. Those are exactly the numbers a merchant would make a
 * spending decision on, so they are the numbers most dangerous to get wrong.
 *
 * Keeping the computation pure — no Prisma, no request, no rendering — means the
 * claims a merchant sees can be attacked directly in tests, which is the only
 * reason to trust them.
 *
 * THE LAWS THIS MODULE ENFORCES:
 *
 *  L1  EVIDENCE OR SILENCE. An attributed action counts only when its evidence
 *      chain re-hashes to its recorded digest AND the chain contains real links.
 *      A row is not evidence because it exists.
 *  L2  ONE ACTION, ONE COUNT. Duplicate evidence digests are collapsed. Counting
 *      a replay would deflate cost-per-action and flatter the merchant.
 *  L3  OWNERSHIP. Only rows belonging to THIS merchant, with merchant-held
 *      relationship, may appear in a merchant-facing figure.
 *  L4  DEMONSTRATION IS NEVER A RESULT. If the retailer is demonstration data,
 *      every commercial figure is withheld — not shown with a caveat.
 *  L5  NO UNEARNED CLAIM. The module returns counts and costs it can derive, and
 *      an explicit list of what it does NOT claim. Ranking, traffic, leads,
 *      conversion lift and revenue are never asserted.
 *  L6  DERIVED, NEVER STORED. Spend and balance are summed from the chain.
 */

const sha = (s) => createHash('sha256').update(s).digest('hex');
const text = (v) => typeof v === 'string' && v.trim() !== '';

/** Money in integer cents so float dust cannot accumulate into a false figure. */
const toCents = (n) => Math.round(Number(n) * 100);
const fromCents = (c) => c / 100;

/**
 * Parse an evidence chain and return its links, or null when it is not evidence.
 *
 * The order matters and is the fix from an earlier CRITICAL: the digest is
 * verified only AFTER the content is validated. Hashing attacker-controlled bytes
 * and then trusting the match proves only that the attacker can run sha256.
 */
export function evidenceLinks(row) {
  if (!text(row?.evidenceChain) || !text(row?.evidenceChainSha256)) return null;
  let parsed;
  try { parsed = JSON.parse(row.evidenceChain); } catch { return null; }
  if (!Array.isArray(parsed) || parsed.length === 0) return null;
  const linkOk = (l) => l && typeof l === 'object' && !Array.isArray(l)
    && Object.prototype.hasOwnProperty.call(l, 'step')
    && Object.prototype.hasOwnProperty.call(l, 'ref')
    && text(l.step) && text(l.ref);
  if (!parsed.every(linkOk)) return null;
  if (sha(row.evidenceChain) !== row.evidenceChainSha256) return null;
  return parsed;
}

/** L3 — a row must demonstrably belong to this merchant. */
export function ownedBy(row, merchantId) {
  if (!text(row?.merchantId) || row.merchantId !== merchantId) return false;
  if (text(row.relationshipOwner) && row.relationshipOwner !== 'MERCHANT') return false;
  return true;
}

/** L4 — demonstration status is judged on several independent signals. */
export function demonstrationReasons(retailer, menu = { total: 0, demonstration: 0 }) {
  const reasons = [];
  if (retailer?.isDemonstration === true) reasons.push('Retailer.isDemonstration=true');
  if (text(retailer?.dataStatus) && /demonstration|demo|synthetic|sample/i.test(retailer.dataStatus)) {
    reasons.push(`Retailer.dataStatus=${retailer.dataStatus}`);
  }
  if (menu.total > 0 && menu.demonstration === menu.total) {
    reasons.push('every MenuEntry.isDemonstration=true');
  }
  return reasons;
}

export const NOT_CLAIMED = Object.freeze([
  'ranking position', 'traffic', 'impressions', 'popularity',
  'leads', 'conversion lift', 'revenue', 'return on ad spend',
]);

/**
 * Build the merchant growth view.
 *
 * @param {object} a
 * @param {object} a.retailer       - id, name, dataStatus, isDemonstration
 * @param {Array}  a.ledger         - DemandCreditEntry rows for this merchant
 * @param {object} [a.audit]        - visibility audit report (score, counts, top_actions)
 * @param {object} [a.menu]         - { total, demonstration }
 * @param {Date}   [a.now]
 */
export function buildGrowthView({ retailer, ledger = [], audit = null, menu = { total: 0, demonstration: 0 }, now = new Date() }) {
  const merchantId = String(retailer?.id ?? '');
  const demoReasons = demonstrationReasons(retailer, menu);
  const isDemonstration = demoReasons.length > 0;

  // ---- L3 then L1 then L2, in that order, each counted separately so a
  // rejection can never be credited to the wrong guard. Lumping them is what
  // previously let an ownership rejection satisfy an evidence assertion.
  const attributions = ledger.filter((r) => r?.kind === 'ATTRIBUTION');
  const seen = new Set();
  const counted = [];
  let rejectedForeign = 0, rejectedNoEvidence = 0, rejectedDuplicate = 0;
  let rejectedUnprovenInteraction = 0;
  for (const row of attributions) {
    if (!ownedBy(row, merchantId)) { rejectedForeign++; continue; }
    // L7 — GRADED EVIDENCE. A row whose proofState is REQUEST_RECEIVED records a
    // true fact (a request arrived) but proves nothing about a consumer, so it
    // must not reach a merchant-facing figure. Rows written before grading existed
    // have a NULL proofState and are treated as ungraded legacy evidence: counted,
    // because they passed the guards in force when they were written, and
    // reported separately so the distinction is visible rather than buried.
    if (typeof row.proofState === 'string' && row.valueEligible !== true) {
      rejectedUnprovenInteraction++; continue;
    }
    if (evidenceLinks(row) === null) { rejectedNoEvidence++; continue; }
    if (seen.has(row.evidenceChainSha256)) { rejectedDuplicate++; continue; }
    seen.add(row.evidenceChainSha256);
    counted.push(row);
  }

  // ---- L6 — spend derived from the chain, never read from a stored total.
  //
  // DEFECTS FOUND BY RUNNING THE CHAIN END TO END. Neither was catchable by a
  // fixture I wrote myself, because my fixtures and my module shared one author.
  //
  //  E2E-1  The real ledger stores SPEND with a NEGATIVE amount (append is called
  //         with `amount: -amount`) while my fixtures used positive values. A
  //         genuine merchant's spend therefore summed negative, clamped to 0, and
  //         proof of value was WITHHELD for a merchant who had actually paid.
  //         Withholding is the safe direction, which is exactly why it could have
  //         shipped unnoticed — nothing looks broken, the merchant simply never
  //         sees the result they earned.
  //  E2E-3  Normalizing the sign required rewriting this loop, and writing a guard
  //         that actually bites revealed a second defect: a SPEND explicitly marked
  //         relationshipOwner PLATFORM still funded the merchant's cost-per-action.
  //         Platform money is not the merchant's money and must not underwrite a
  //         merchant-facing claim.
  //
  //  (I also claimed ownedBy was DROPPING money rows for lacking relationshipOwner.
  //   That was WRONG: reverting the "fix" failed zero tests, so it guarded nothing.
  //   ownedBy tolerates an absent owner and refuses only a present non-MERCHANT
  //   value. Recorded as a mistaken diagnosis rather than quietly kept as a fix.)
  const belongsToMerchant = (row) => {
    if (!text(row?.merchantId) || row.merchantId !== merchantId) return false;
    if (text(row.relationshipOwner) && row.relationshipOwner !== 'MERCHANT') return false;
    return true;
  };
  let spentCents = 0, issuedCents = 0;
  for (const row of ledger) {
    if (!belongsToMerchant(row)) continue;
    // Sign is NORMALIZED. Reading it raw is how a real spend became "no spend".
    const cents = Math.abs(toCents(row.amount));
    if (!Number.isFinite(cents)) continue;
    if (row.kind === 'SPEND') spentCents += cents;
    else if (row.kind === 'ISSUE') issuedCents += cents;
    else if (row.kind === 'REFUND') spentCents -= cents;
  }
  // VERIFIER FINDING B7 (LOW, latent). `spent <= 0` is false for NaN, so a
  // non-finite total slipped past the blocker and rendered as NaN on the merchant
  // page. Unreachable through the ledger API today (it refuses INVALID_AMOUNT), so
  // only a hand-inserted row could reach it — which is exactly the input this
  // module must not trust, since it reads rows directly.
  const spentRaw = Math.max(0, spentCents);
  const spent = Number.isFinite(spentRaw) ? fromCents(spentRaw) : 0;

  const byKind = {};
  for (const row of counted) byKind[row.actionKind] = (byKind[row.actionKind] || 0) + 1;

  // ---- Cost per attributed action. Only meaningful with BOTH spend and
  // evidenced actions; otherwise it is null, never 0 and never Infinity.
  const costPerAction = counted.length > 0 && spent > 0
    ? Math.round((spent / counted.length) * 100) / 100
    : null;

  // ---- L4/L5 — what blocks a commercial figure from being shown at all.
  const blockers = [];
  if (isDemonstration) {
    blockers.push(`demonstration data — ${demoReasons.join('; ')}`);
  }
  if (counted.length === 0) {
    blockers.push('no attributed action carries verifiable evidence');
  }
  if (spent <= 0) {
    blockers.push('no placement spend is recorded, so cost per action cannot be derived');
  }

  const proofOfValue = blockers.length === 0 ? {
    attributed_actions: counted.length,
    actions_by_kind: byKind,
    credits_spent: spent,
    cost_per_attributed_action: costPerAction,
    every_counted_action_has_verified_evidence: true,
    relationship_owner: 'MERCHANT',
    not_claimed: NOT_CLAIMED,
  } : null;

  // ---- The audit's findings are the merchant's actionable work. They are shown
  // whether or not proof of value exists: a merchant with no spend still
  // benefits from knowing what is missing, and withholding it would be a
  // sales tactic rather than a product.
  const priorityActions = Array.isArray(audit?.top_actions)
    ? audit.top_actions.map((a) => ({
        rank: a.rank, weight: a.weight, finding: a.finding,
        evidence_field: a.evidence_field, observed: a.observed, action: a.action,
      }))
    : [];

  return {
    schema: 'merchant-growth-os/1',
    generated_at: now.toISOString(),
    merchant: { id: merchantId, name: retailer?.name ?? null },
    truth_label: isDemonstration
      ? `DEMONSTRATION_ONLY — not a live commercial result (${demoReasons.join('; ')})`
      : 'LIVE_RECORD',
    // VERIFIER FINDING B8 (LOW, latent). audit.score was passed through verbatim,
    // so 999, -5, NaN or "high" would render as a score. The live page passes no
    // audit today, but a module that reads a caller-supplied number and prints it
    // as a measurement must bound it or it is not a measurement.
    visibility: audit ? {
      score: Number.isFinite(Number(audit.score))
        ? Math.min(100, Math.max(0, Math.round(Number(audit.score))))
        : null,
      counts: audit.counts,
      // The score is a measure of observable completeness, not of performance.
      means: 'Share of observable profile, menu, provenance and answerability fields that are present and sourced. It is not a ranking, a traffic estimate, or a performance score.',
    } : null,
    priority_actions: priorityActions,
    attribution: {
      rows_seen: attributions.length,
      counted: counted.length,
      rejected_foreign_merchant: rejectedForeign,
      rejected_unverifiable_evidence: rejectedNoEvidence,
      rejected_duplicate_evidence: rejectedDuplicate,
      // Named separately: "we saw a request but cannot show a consumer acted" is a
      // different fact from "the evidence was forged", and collapsing them would
      // hide how much of a merchant's traffic is unproven.
      rejected_unproven_interaction: rejectedUnprovenInteraction,
    },
    proof_of_value: proofOfValue,
    proof_of_value_blockers: blockers,
    not_claimed: NOT_CLAIMED,
    disclaimer: 'Every figure above is derived from observable ledger rows and database fields. Actions are counted only when their evidence chain re-hashes to its recorded digest. No ranking, traffic, lead, conversion-lift or revenue figure is claimed or implied.',
  };
}
