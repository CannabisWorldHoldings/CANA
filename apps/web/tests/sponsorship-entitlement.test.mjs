import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveSponsorship,
  shouldRenderBadge,
  dedupeSponsoredCards,
  SPONSORSHIP_STATES as S,
} from '../src/lib/sponsorship-entitlement.mjs';

/**
 * SPONSORSHIP ENTITLEMENT — attack suite for Mechanism Matrix M-001.
 *
 * Each test corresponds to an attack the sponsorship gate must survive:
 * disguised sponsorship, expired sponsorship, forged entitlement, refunded
 * credit, sponsorship altering organic order, missing evidence chain, and
 * duplicate campaign display.
 *
 * The gate is FAIL-CLOSED: anything short of a chain-linked, unexpired,
 * unrefunded, order-neutral, disclosed placement renders no badge.
 */

const M = 'merchant_alpha';
const future = new Date(Date.now() + 30 * 86400_000);
const past = new Date(Date.now() - 86400_000);

const issue = (over = {}) => ({
  merchantId: M, kind: 'ISSUE', seq: 0, amount: 500,
  authorizationRef: 'PO-1', expiresAt: future,
  prevHash: 'genesis', entryHash: 'h0', ...over,
});
const spend = (over = {}) => ({
  merchantId: M, kind: 'SPEND', seq: 1, amount: -100,
  placement: 'FEATURED_CARD', disclosureLabel: 'Sponsored placement',
  affectsOrganicOrder: false, prevHash: 'h0', entryHash: 'h1', ...over,
});
const refund = (over = {}) => ({
  merchantId: M, kind: 'REFUND', seq: 2, amount: 100,
  originalSeq: 1, reason: 'under-delivered', prevHash: 'h1', entryHash: 'h2', ...over,
});

const resolve = (entries, over = {}) =>
  resolveSponsorship({ merchantId: M, entries, placement: 'FEATURED_CARD', ...over });

test('HAPPY PATH: a chain-linked, funded, unexpired placement is ACTIVE', () => {
  const r = resolve([issue(), spend()]);
  assert.equal(r.state, S.ACTIVE);
  assert.equal(r.label, 'Sponsored placement');
  assert.equal(r.affectsOrganicOrder, false);
  assert.equal(r.evidence.spend_seq, 1);
  assert.equal(r.evidence.entry_hash, 'h1');
  assert.ok(r.evidence.entitlement_digest.length === 24);
  assert.equal(shouldRenderBadge(r.state), true);
});

test('ATTACK 1 — DISGUISED SPONSORSHIP: a spend with no disclosure label cannot render', () => {
  for (const label of [undefined, null, '', '   ', '\t']) {
    const r = resolve([issue(), spend({ disclosureLabel: label })]);
    assert.equal(r.state, S.INVALID_EVIDENCE, `label=${JSON.stringify(label)} must not render`);
    assert.equal(shouldRenderBadge(r.state), false);
  }
});

test('ATTACK 2 — EXPIRED SPONSORSHIP: funding past its expiry renders nothing', () => {
  const r = resolve([issue({ expiresAt: past }), spend()]);
  assert.equal(r.state, S.EXPIRED);
  assert.equal(shouldRenderBadge(r.state), false);
  assert.equal(r.label, null, 'an expired campaign must not leak its label');
  // Boundary: expiry exactly now is expired, not active.
  const now = new Date();
  assert.equal(resolve([issue({ expiresAt: now }), spend()], { now }).state, S.EXPIRED);
});

test('ATTACK 3 — FORGED ENTITLEMENT: a row not linked into the chain is refused', () => {
  // A fabricated row inserted without hash linkage.
  assert.equal(resolve([issue(), spend({ entryHash: null })]).state, S.INVALID_EVIDENCE);
  assert.equal(resolve([issue(), spend({ prevHash: null })]).state, S.INVALID_EVIDENCE);
  assert.equal(resolve([issue(), spend({ entryHash: '  ' })]).state, S.INVALID_EVIDENCE);
  // A spend with no funding ISSUE before it is unbacked money.
  assert.equal(resolve([spend()]).state, S.INVALID_EVIDENCE);
  // Funding that appears AFTER the spend does not retroactively entitle it.
  assert.equal(resolve([spend({ seq: 1 }), issue({ seq: 5 })]).state, S.INVALID_EVIDENCE);
});

test('ATTACK 4 — REFUNDED CREDIT: a fully refunded placement stops rendering', () => {
  const r = resolve([issue(), spend(), refund()]);
  assert.equal(r.state, S.REFUNDED);
  assert.equal(shouldRenderBadge(r.state), false);
  // Partial refund does NOT cancel the entitlement.
  const partial = resolve([issue(), spend(), refund({ amount: 40 })]);
  assert.equal(partial.state, S.ACTIVE, 'a partial refund leaves the placement live');
  // Cumulative partials that reach the full amount DO cancel it.
  const cumulative = resolve([
    issue(), spend(),
    refund({ seq: 2, amount: 40, entryHash: 'h2' }),
    refund({ seq: 3, amount: 60, entryHash: 'h3' }),
  ]);
  assert.equal(cumulative.state, S.REFUNDED, 'cumulative refunds must cancel');
  // A refund pointing at a DIFFERENT spend must not cancel this one.
  assert.equal(resolve([issue(), spend(), refund({ originalSeq: 99 })]).state, S.ACTIVE);
});

test('ATTACK 5 — ORDER MANIPULATION: a spend claiming to affect ordering is refused', () => {
  const r = resolve([issue(), spend({ affectsOrganicOrder: true })]);
  assert.equal(r.state, S.INVALID_EVIDENCE);
  assert.equal(shouldRenderBadge(r.state), false);
  // And a valid entitlement always reports order-neutrality explicitly.
  assert.equal(resolve([issue(), spend()]).affectsOrganicOrder, false);
});

test('ATTACK 6 — MISSING EVIDENCE: absent ledger or wrong merchant renders nothing', () => {
  assert.equal(resolve([]).state, S.NONE, 'no entries = organic card');
  assert.equal(resolve([issue(), spend({ merchantId: 'someone_else' })]).state, S.NONE,
    'another merchant\'s spend must not badge this card');
  assert.equal(resolve([issue(), spend({ placement: 'DEAL_SPOTLIGHT' })]).state, S.NONE,
    'a spend on a different slot must not badge this slot');
  assert.equal(resolveSponsorship({ merchantId: M, entries: null, placement: 'FEATURED_CARD' }).state, S.INVALID_EVIDENCE);
  assert.equal(resolveSponsorship({ merchantId: '', entries: [], placement: 'FEATURED_CARD' }).state, S.INVALID_EVIDENCE);
  // FAIL CLOSED: an unreachable ledger must not assume "paid".
  const un = resolve([issue(), spend()], { ledgerAvailable: false });
  assert.equal(un.state, S.UNAVAILABLE);
  assert.equal(shouldRenderBadge(un.state), false);
});

test('ATTACK 7 — DUPLICATE CAMPAIGN DISPLAY: one merchant cannot occupy a slot twice', () => {
  const cards = [
    { id: 'c1', merchantId: M, placement: 'FEATURED_CARD', sponsorshipState: S.ACTIVE },
    { id: 'c2', merchantId: M, placement: 'FEATURED_CARD', sponsorshipState: S.ACTIVE },
    { id: 'c3', merchantId: M, placement: 'DEAL_SPOTLIGHT', sponsorshipState: S.ACTIVE },
    { id: 'c4', merchantId: 'other', placement: 'FEATURED_CARD', sponsorshipState: S.ACTIVE },
    { id: 'c5', merchantId: M, placement: 'FEATURED_CARD', sponsorshipState: S.EXPIRED },
  ];
  const allowed = dedupeSponsoredCards(cards);
  assert.equal(allowed.has('c1'), true, 'first card for the slot renders');
  assert.equal(allowed.has('c2'), false, 'duplicate campaign on the same slot is suppressed');
  assert.equal(allowed.has('c3'), true, 'a different slot is a different campaign');
  assert.equal(allowed.has('c4'), true, 'a different merchant is a different campaign');
  assert.equal(allowed.has('c5'), false, 'non-ACTIVE never renders');
  assert.equal(allowed.size, 3);
});

test('LOADING state is distinct and renders no claim', () => {
  const r = resolve([issue(), spend()], { loading: true });
  assert.equal(r.state, S.LOADING);
  assert.equal(shouldRenderBadge(r.state), false);
  assert.equal(r.label, null);
});

test('the newest campaign governs when several exist for one slot', () => {
  const r = resolve([
    issue(),
    spend({ seq: 1, disclosureLabel: 'Old campaign', entryHash: 'h1' }),
    spend({ seq: 3, disclosureLabel: 'Current campaign', prevHash: 'h2', entryHash: 'h3' }),
  ]);
  assert.equal(r.state, S.ACTIVE);
  assert.equal(r.label, 'Current campaign');
  assert.equal(r.evidence.spend_seq, 3);
});

test('CONTROL: the gate can actually reject — it is not a rubber stamp', () => {
  // If every one of these rendered, the gate would be decorative.
  const rejected = [
    resolve([issue(), spend({ disclosureLabel: '' })]),
    resolve([issue({ expiresAt: past }), spend()]),
    resolve([issue(), spend({ entryHash: null })]),
    resolve([issue(), spend(), refund()]),
    resolve([issue(), spend({ affectsOrganicOrder: true })]),
    resolve([issue(), spend()], { ledgerAvailable: false }),
    resolve([]),
  ];
  assert.equal(rejected.filter((r) => shouldRenderBadge(r.state)).length, 0,
    'no rejected scenario may render a badge');
  // And the happy path still passes, so the gate is not simply always-deny.
  assert.equal(shouldRenderBadge(resolve([issue(), spend()]).state), true);
});

test('D-1 HIGH: a forged unlinked ISSUE cannot revive an EXPIRED campaign', () => {
  // Independent verification: the resolver forgery-checked the SPEND but
  // extended full trust to the ISSUE governing expiry. An unlinked forged ISSUE
  // with a far-future expiry out-ranked the real expired funding and produced a
  // visible ACTIVE badge — the deception-POSITIVE direction.
  const r = resolve([
    issue({ seq: 0, expiresAt: past, entryHash: 'hp' }),                     // real, expired
    spend({ seq: 1 }),                                                        // legit, chain-linked
    issue({ seq: 0.9, expiresAt: future, entryHash: null, prevHash: null }), // forged, unlinked
  ]);
  assert.equal(r.state, S.INVALID_EVIDENCE, 'an unlinked ISSUE must never govern expiry');
  assert.equal(shouldRenderBadge(r.state), false);
  assert.match(r.reason, /not chain-linked/);
  // Control: the same shape with a properly linked newer ISSUE is legitimate.
  const ok = resolve([
    issue({ seq: 0, expiresAt: past, entryHash: 'hp' }),
    spend({ seq: 1 }),
    issue({ seq: 0.9, expiresAt: future, entryHash: 'hq', prevHash: 'hp' }),
  ]);
  assert.equal(ok.state, S.ACTIVE, 'a chain-linked newer funding legitimately governs');
});

test('D-2 MEDIUM: adversarial refund amounts cannot revive a refunded placement', () => {
  // A NEGATIVE refund previously revived a fully-refunded placement, and a
  // NaN/undefined amount silently nullified an entire refund set.
  for (const bad of [-100, NaN, Infinity, -Infinity, undefined, null, '50', 0]) {
    const r = resolve([issue(), spend(), refund({ amount: bad })]);
    assert.equal(r.state, S.INVALID_EVIDENCE, `refund amount ${JSON.stringify(bad)} must fail closed`);
    assert.equal(shouldRenderBadge(r.state), false);
  }
  // A negative refund alongside a real one must not net out to "not refunded".
  const mixed = resolve([
    issue(), spend(),
    refund({ seq: 2, amount: 100, entryHash: 'h2' }),
    refund({ seq: 3, amount: -100, entryHash: 'h3' }),
  ]);
  assert.equal(mixed.state, S.INVALID_EVIDENCE, 'a negative refund must not cancel a real one');
});

test('D-3 LOW: dedupe keys cannot collide via delimiter injection', () => {
  const cards = [
    { id: 'x', merchantId: 'a|b', placement: 'c', sponsorshipState: S.ACTIVE },
    { id: 'y', merchantId: 'a', placement: 'b|c', sponsorshipState: S.ACTIVE },
  ];
  const allowed = dedupeSponsoredCards(cards);
  assert.equal(allowed.size, 2, "'a|b'+'c' and 'a'+'b|c' are different campaigns and must not collide");
});

test('D-4 INFO: order-claim check matches the ledger strictness', () => {
  for (const v of [true, 1, 'true', [], {}, 'yes']) {
    const r = resolve([issue(), spend({ affectsOrganicOrder: v })]);
    assert.equal(r.state, S.INVALID_EVIDENCE, `affectsOrganicOrder=${JSON.stringify(v)} must be refused`);
  }
  // null/undefined mean "not set" and are legitimate.
  assert.equal(resolve([issue(), spend({ affectsOrganicOrder: null })]).state, S.ACTIVE);
});
