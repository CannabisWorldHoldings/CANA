#!/usr/bin/env node
/**
 * ORDERWEEDDC DEMAND CREDITS + ATTRIBUTION LEDGER
 *
 * Mechanism Matrix M-005 — the only mechanism at NOT_STARTED, and the one that
 * converts existing truth advantages into revenue.
 *
 * COMPETITOR BRITTLE POINT (Weedmaps, evidence 2026-07-23):
 *   rented visibility (~$2,805/mo blended, 10-K) + orders through the platform
 *   belong to the PLATFORM not the dispensary + zero merchant brand equity +
 *   $10,000/mo liquidated damages for promoting a competitor. Merchants are
 *   already primed to distrust: "stop paying and you disappear overnight."
 *
 * OUR ORIGINAL IMPROVEMENT — three inversions, each enforced in code here:
 *   1. MERCHANT OWNS THE CUSTOMER. Every attributed action records
 *      relationship_owner='MERCHANT' and is exportable by the merchant.
 *   2. CREDITS BUY PLACEMENT, NEVER RANK. Spending is recorded as a display
 *      attribute; this ledger refuses any spend that claims to alter ordering.
 *   3. NO VALUE WITHOUT AN EVIDENCE CHAIN. An attributed action must cite an
 *      observable event chain or it is rejected — no invented leads or lift.
 *
 * Append-only and hash-chained: every entry binds the previous entry's hash, so
 * silent edits are detectable. Balance is DERIVED from the chain, never stored.
 *
 * Usage:
 *   node ledger.mjs --selftest
 *   node ledger.mjs --demo --json out.json
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';

const has = k => process.argv.includes(`--${k}`);
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d; };

const sha = s => createHash('sha256').update(s).digest('hex');
const present = v => typeof v === 'string' ? v.trim().length > 0 : v != null;

export const ENTRY_KINDS = ['ISSUE', 'SPEND', 'REFUND', 'EXPIRE', 'ATTRIBUTION'];
/** Placement is a display slot. Ordering is NOT purchasable — see refusal below. */
export const PLACEMENT_KINDS = ['FEATURED_CARD', 'NEIGHBORHOOD_BANNER', 'DEAL_SPOTLIGHT', 'BRAND_COLLECTION'];
export const ACTION_KINDS = ['PROFILE_VIEW', 'MENU_VIEW', 'DIRECTIONS_CLICK', 'PHONE_CLICK', 'WEBSITE_CLICK', 'HANDOFF'];

/**
 * Append-only hash-chained ledger.
 * Genesis hash is a constant so an empty ledger still has a verifiable root.
 */
export class DemandCreditLedger {
  constructor() { this.entries = []; this.GENESIS = sha('orderweeddc:demand-credits:genesis'); }

  get headHash() { return this.entries.length ? this.entries.at(-1).entry_hash : this.GENESIS; }

  #append(entry) {
    const prev = this.headHash;
    const body = JSON.stringify({ ...entry, prev_hash: prev });
    const rec = { ...entry, seq: this.entries.length, prev_hash: prev, entry_hash: sha(body), recorded_at: new Date().toISOString() };
    this.entries.push(rec);
    return { accepted: true, entry: rec };
  }
  #reject(code, detail) { return { accepted: false, denial_code: code, denial_detail: detail }; }

  /** Credits enter only with an authorization reference — never conjured. */
  issue({ merchantId, amount, authorizationRef, expiresAt }) {
    if (!present(merchantId)) return this.#reject('MERCHANT_REQUIRED', 'merchantId missing');
    if (!Number.isFinite(amount) || amount <= 0) return this.#reject('INVALID_AMOUNT', `amount=${amount} must be a positive finite number`);
    if (!present(authorizationRef)) return this.#reject('AUTHORIZATION_REQUIRED', 'credits cannot be issued without an authorization reference');
    if (!present(expiresAt)) return this.#reject('EXPIRY_REQUIRED', 'credits must carry an expiry so unused value cannot linger indefinitely');
    return this.#append({ kind: 'ISSUE', merchant_id: merchantId, amount, authorization_ref: authorizationRef, expires_at: expiresAt });
  }

  /**
   * Spend credits on a PLACEMENT. Refuses any spend that asserts influence over
   * ordering — sponsorship must never masquerade as organic rank.
   */
  spend({ merchantId, amount, placement, disclosureLabel, affectsOrganicOrder = false }) {
    if (!present(merchantId)) return this.#reject('MERCHANT_REQUIRED', 'merchantId missing');
    if (!Number.isFinite(amount) || amount <= 0) return this.#reject('INVALID_AMOUNT', `amount=${amount} must be a positive finite number`);
    if (!PLACEMENT_KINDS.includes(placement)) return this.#reject('UNKNOWN_PLACEMENT', `${placement} not in ${PLACEMENT_KINDS.join('|')}`);
    if (affectsOrganicOrder === true) {
      return this.#reject('RANK_PURCHASE_REFUSED', 'credits buy labeled placement, never organic ordering — sponsorship must not masquerade as rank');
    }
    if (!present(disclosureLabel)) {
      return this.#reject('DISCLOSURE_REQUIRED', 'every paid placement must carry a visible per-card disclosure label');
    }
    const bal = this.balance(merchantId);
    if (amount > bal) return this.#reject('INSUFFICIENT_CREDITS', `spend ${amount} exceeds balance ${bal}`);
    return this.#append({ kind: 'SPEND', merchant_id: merchantId, amount: -amount, placement, disclosure_label: disclosureLabel, affects_organic_order: false });
  }

  refund({ merchantId, amount, reason, originalSeq }) {
    if (!present(merchantId)) return this.#reject('MERCHANT_REQUIRED', 'merchantId missing');
    if (!Number.isFinite(amount) || amount <= 0) return this.#reject('INVALID_AMOUNT', `amount=${amount}`);
    if (!present(reason)) return this.#reject('REASON_REQUIRED', 'refunds must state a reason');
    const orig = this.entries.find(e => e.seq === originalSeq && e.kind === 'SPEND' && e.merchant_id === merchantId);
    if (!orig) return this.#reject('ORIGINAL_SPEND_NOT_FOUND', `no SPEND at seq=${originalSeq} for this merchant`);
    if (amount > Math.abs(orig.amount)) return this.#reject('REFUND_EXCEEDS_SPEND', `refund ${amount} > original ${Math.abs(orig.amount)}`);
    const already = this.entries.filter(e => e.kind === 'REFUND' && e.original_seq === originalSeq).reduce((s, e) => s + e.amount, 0);
    if (already + amount > Math.abs(orig.amount)) return this.#reject('DOUBLE_REFUND_REFUSED', `already refunded ${already} of ${Math.abs(orig.amount)}`);
    return this.#append({ kind: 'REFUND', merchant_id: merchantId, amount, reason, original_seq: originalSeq });
  }

  /**
   * Record an attributed customer action.
   * FAIL-CLOSED: requires an evidence chain. Without it there is no proof the
   * action happened, and an unproven action must never become a value claim.
   */
  attribute({ merchantId, actionKind, evidenceChain, observedAt, placementSeq = null }) {
    if (!present(merchantId)) return this.#reject('MERCHANT_REQUIRED', 'merchantId missing');
    if (!ACTION_KINDS.includes(actionKind)) return this.#reject('UNKNOWN_ACTION', `${actionKind} not in ${ACTION_KINDS.join('|')}`);
    if (!Array.isArray(evidenceChain) || evidenceChain.length === 0) {
      return this.#reject('EVIDENCE_CHAIN_REQUIRED', 'an attributed action without an evidence chain is an invented metric');
    }
    if (evidenceChain.some(l => !present(l?.step) || !present(l?.ref))) {
      return this.#reject('EVIDENCE_LINK_INCOMPLETE', 'every evidence link needs a step and a retrievable ref');
    }
    if (!present(observedAt)) return this.#reject('OBSERVED_AT_REQUIRED', 'an undated action is not evidence');
    if (placementSeq !== null && !this.entries.some(e => e.seq === placementSeq && e.kind === 'SPEND')) {
      return this.#reject('PLACEMENT_NOT_FOUND', `no SPEND at seq=${placementSeq} to attribute against`);
    }
    return this.#append({
      kind: 'ATTRIBUTION', merchant_id: merchantId, amount: 0, action_kind: actionKind,
      evidence_chain: evidenceChain, evidence_chain_sha256: sha(JSON.stringify(evidenceChain)),
      observed_at: observedAt, placement_seq: placementSeq,
      // THE INVERSION: the merchant keeps the customer relationship.
      relationship_owner: 'MERCHANT',
      exportable_by_merchant: true,
    });
  }

  /** Balance is derived from the chain — never a stored mutable number. */
  balance(merchantId) {
    return this.entries
      .filter(e => e.merchant_id === merchantId && e.kind !== 'ATTRIBUTION')
      .reduce((s, e) => s + e.amount, 0);
  }

  /** Verify the hash chain. Detects any silent edit or reordering. */
  verifyChain() {
    let prev = this.GENESIS;
    for (const e of this.entries) {
      if (e.prev_hash !== prev) return { valid: false, brokenAt: e.seq, reason: 'prev_hash mismatch' };
      const { seq, prev_hash, entry_hash, recorded_at, ...body } = e;
      if (sha(JSON.stringify({ ...body, prev_hash })) !== entry_hash) return { valid: false, brokenAt: seq, reason: 'entry_hash mismatch' };
      prev = e.entry_hash;
    }
    return { valid: true, entries: this.entries.length, head: this.headHash };
  }

  /**
   * Merchant export — the direct answer to "the platform owns your customers."
   * A merchant can take their attributed relationships and leave.
   */
  exportForMerchant(merchantId) {
    const mine = this.entries.filter(e => e.merchant_id === merchantId);
    return {
      merchant_id: merchantId,
      exported_at: new Date().toISOString(),
      relationship_owner: 'MERCHANT',
      portability_statement: 'These attributed customer relationships belong to the merchant. No lock-in clause restricts their use elsewhere.',
      balance: this.balance(merchantId),
      attributed_actions: mine.filter(e => e.kind === 'ATTRIBUTION'),
      credit_entries: mine.filter(e => e.kind !== 'ATTRIBUTION'),
      chain_verification: this.verifyChain(),
    };
  }

  /** Proof-of-value: only counts actions that carry a verified evidence chain. */
  proofOfValue(merchantId) {
    const acts = this.entries.filter(e => e.merchant_id === merchantId && e.kind === 'ATTRIBUTION');
    const spend = Math.abs(this.entries.filter(e => e.merchant_id === merchantId && e.kind === 'SPEND').reduce((s, e) => s + e.amount, 0));
    const byKind = {};
    for (const a of acts) byKind[a.action_kind] = (byKind[a.action_kind] || 0) + 1;
    return {
      merchant_id: merchantId,
      credits_spent: spend,
      attributed_actions: acts.length,
      actions_by_kind: byKind,
      every_action_has_evidence: acts.every(a => Array.isArray(a.evidence_chain) && a.evidence_chain.length > 0),
      // Deliberately absent: ranking, traffic, impressions, lift, conversion rate.
      not_claimed: ['ranking position', 'traffic', 'impressions', 'leads', 'conversion lift'],
      disclaimer: 'Counts only actions with a retrievable evidence chain. No ranking, traffic, or conversion-lift figure is claimed or implied.',
      chain_verification: this.verifyChain(),
    };
  }
}

// ---------------- self-test: the ledger must REFUSE ----------------
if (has('selftest')) {
  let pass = 0, fail = 0;
  const t = (n, c) => { c ? (pass++, console.log(`  ok   ${n}`)) : (fail++, console.log(`  FAIL ${n}`)); };
  const L = new DemandCreditLedger();
  const M = 'merchant_alpha';

  t('empty ledger chain verifies', L.verifyChain().valid);
  t('issue without authorization refused', L.issue({ merchantId: M, amount: 100, expiresAt: '2026-12-31' }).denial_code === 'AUTHORIZATION_REQUIRED');
  t('issue with whitespace authorization refused', L.issue({ merchantId: M, amount: 100, authorizationRef: '   ', expiresAt: '2026-12-31' }).denial_code === 'AUTHORIZATION_REQUIRED');
  t('issue without expiry refused', L.issue({ merchantId: M, amount: 100, authorizationRef: 'PO-1' }).denial_code === 'EXPIRY_REQUIRED');
  t('negative issue refused', L.issue({ merchantId: M, amount: -5, authorizationRef: 'PO-1', expiresAt: 'x' }).denial_code === 'INVALID_AMOUNT');
  t('NaN issue refused', L.issue({ merchantId: M, amount: NaN, authorizationRef: 'PO-1', expiresAt: 'x' }).denial_code === 'INVALID_AMOUNT');
  t('Infinity issue refused', L.issue({ merchantId: M, amount: Infinity, authorizationRef: 'PO-1', expiresAt: 'x' }).denial_code === 'INVALID_AMOUNT');

  const iss = L.issue({ merchantId: M, amount: 500, authorizationRef: 'PO-2026-001', expiresAt: '2026-12-31' });
  t('authorized issue accepted', iss.accepted);
  t('balance derived = 500', L.balance(M) === 500);

  t('RANK PURCHASE REFUSED', L.spend({ merchantId: M, amount: 50, placement: 'FEATURED_CARD', disclosureLabel: 'Sponsored', affectsOrganicOrder: true }).denial_code === 'RANK_PURCHASE_REFUSED');
  t('undisclosed placement refused', L.spend({ merchantId: M, amount: 50, placement: 'FEATURED_CARD' }).denial_code === 'DISCLOSURE_REQUIRED');
  t('whitespace disclosure refused', L.spend({ merchantId: M, amount: 50, placement: 'FEATURED_CARD', disclosureLabel: '  ' }).denial_code === 'DISCLOSURE_REQUIRED');
  t('unknown placement refused', L.spend({ merchantId: M, amount: 50, placement: 'TOP_OF_SEARCH', disclosureLabel: 'Sponsored' }).denial_code === 'UNKNOWN_PLACEMENT');
  t('overspend refused', L.spend({ merchantId: M, amount: 5000, placement: 'FEATURED_CARD', disclosureLabel: 'Sponsored' }).denial_code === 'INSUFFICIENT_CREDITS');

  const sp = L.spend({ merchantId: M, amount: 120, placement: 'FEATURED_CARD', disclosureLabel: 'Sponsored placement — does not affect ranking' });
  t('disclosed placement accepted', sp.accepted);
  t('balance after spend = 380', L.balance(M) === 380);

  t('attribution without evidence refused', L.attribute({ merchantId: M, actionKind: 'PHONE_CLICK', evidenceChain: [], observedAt: '2026-07-26' }).denial_code === 'EVIDENCE_CHAIN_REQUIRED');
  t('attribution with incomplete link refused', L.attribute({ merchantId: M, actionKind: 'PHONE_CLICK', evidenceChain: [{ step: 'click' }], observedAt: '2026-07-26' }).denial_code === 'EVIDENCE_LINK_INCOMPLETE');
  t('undated attribution refused', L.attribute({ merchantId: M, actionKind: 'PHONE_CLICK', evidenceChain: [{ step: 'click', ref: 'evt:1' }] }).denial_code === 'OBSERVED_AT_REQUIRED');
  t('unknown action refused', L.attribute({ merchantId: M, actionKind: 'PURCHASE', evidenceChain: [{ step: 'x', ref: 'y' }], observedAt: 'now' }).denial_code === 'UNKNOWN_ACTION');
  t('attribution to nonexistent placement refused', L.attribute({ merchantId: M, actionKind: 'PHONE_CLICK', evidenceChain: [{ step: 'x', ref: 'y' }], observedAt: 'now', placementSeq: 999 }).denial_code === 'PLACEMENT_NOT_FOUND');

  const at = L.attribute({ merchantId: M, actionKind: 'PHONE_CLICK', observedAt: '2026-07-26T12:00:00Z', placementSeq: sp.entry.seq,
    evidenceChain: [{ step: 'placement_render', ref: 'render:abc' }, { step: 'card_click', ref: 'evt:def' }, { step: 'phone_reveal', ref: 'evt:ghi' }] });
  t('evidenced attribution accepted', at.accepted);
  t('MERCHANT owns the relationship', at.entry.relationship_owner === 'MERCHANT');
  t('attribution is merchant-exportable', at.entry.exportable_by_merchant === true);
  t('attribution does not change balance', L.balance(M) === 380);

  t('refund of nonexistent spend refused', L.refund({ merchantId: M, amount: 10, reason: 'x', originalSeq: 999 }).denial_code === 'ORIGINAL_SPEND_NOT_FOUND');
  t('refund exceeding spend refused', L.refund({ merchantId: M, amount: 9999, reason: 'x', originalSeq: sp.entry.seq }).denial_code === 'REFUND_EXCEEDS_SPEND');
  const rf = L.refund({ merchantId: M, amount: 20, reason: 'placement under-delivered', originalSeq: sp.entry.seq });
  t('valid refund accepted', rf.accepted);
  t('balance after refund = 400', L.balance(M) === 400);
  // Must be UNDER the original (120) so REFUND_EXCEEDS_SPEND does not fire
  // first — this specifically tests cumulative double-refund protection:
  // 20 already refunded + 110 requested = 130 > 120 original.
  t('cumulative double refund refused', L.refund({ merchantId: M, amount: 110, reason: 'again', originalSeq: sp.entry.seq }).denial_code === 'DOUBLE_REFUND_REFUSED');
  t('refund within remaining allowance accepted', L.refund({ merchantId: M, amount: 100, reason: 'remaining', originalSeq: sp.entry.seq }).accepted === true);
  t('balance after second refund = 500', L.balance(M) === 500);
  t('refund of last cent beyond allowance refused', L.refund({ merchantId: M, amount: 1, reason: 'over', originalSeq: sp.entry.seq }).denial_code === 'DOUBLE_REFUND_REFUSED');

  t('chain verifies after all entries', L.verifyChain().valid);
  // Tamper detection: silently edit a recorded amount.
  const snapshot = JSON.parse(JSON.stringify(L.entries));
  L.entries[1].amount = 999999;
  t('TAMPER DETECTED after silent edit', L.verifyChain().valid === false);
  L.entries = snapshot;
  t('chain valid again after restore', L.verifyChain().valid);

  const ex = L.exportForMerchant(M);
  t('merchant export carries attributed actions', ex.attributed_actions.length === 1);
  t('merchant export asserts merchant ownership', ex.relationship_owner === 'MERCHANT');
  const pov = L.proofOfValue(M);
  t('proof-of-value counts only evidenced actions', pov.every_action_has_evidence === true);
  t('proof-of-value claims no ranking/traffic/lift', pov.not_claimed.length === 5 && pov.attributed_actions === 1);

  console.log(`\n  Demand Credits self-test: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

if (has('demo')) {
  const L = new DemandCreditLedger();
  const M = 'demo_retailer_alpha';
  L.issue({ merchantId: M, amount: 250, authorizationRef: 'PILOT-2026-001', expiresAt: '2026-12-31' });
  const s = L.spend({ merchantId: M, amount: 75, placement: 'NEIGHBORHOOD_BANNER', disclosureLabel: 'Sponsored — placement only, ranking unaffected' });
  L.attribute({ merchantId: M, actionKind: 'DIRECTIONS_CLICK', observedAt: new Date().toISOString(), placementSeq: s.entry.seq,
    evidenceChain: [{ step: 'banner_render', ref: 'render:n1' }, { step: 'banner_click', ref: 'evt:n2' }, { step: 'directions_open', ref: 'evt:n3' }] });
  const out = { export: L.exportForMerchant(M), proof_of_value: L.proofOfValue(M) };
  console.log(JSON.stringify(out, null, 2));
  const J = arg('json', null);
  if (J) fs.writeFileSync(J, JSON.stringify(out, null, 2));
}
