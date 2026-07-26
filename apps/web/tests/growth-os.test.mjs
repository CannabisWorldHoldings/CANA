import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildGrowthView, evidenceLinks, ownedBy, demonstrationReasons, NOT_CLAIMED }
  from '../src/lib/growth-os.mjs';

/**
 * MERCHANT GROWTH OS — attacks on the numbers a merchant would pay against.
 *
 * These figures are the most dangerous in the system: a merchant makes a spending
 * decision on them. So the suite is written as an adversary trying to inflate
 * them, not as a demonstration that the happy path works.
 */

const sha = (s) => createHash('sha256').update(s).digest('hex');
const now = new Date('2026-07-26T12:00:00Z');

const chain = (links) => JSON.stringify(links);
const REAL = [{ step: 'render', ref: 'r1' }, { step: 'click', ref: 'r2' }];

const R = (o = {}) => ({ id: 'm1', name: 'Test Merchant', dataStatus: 'VERIFIED_CURRENT', isDemonstration: false, ...o });
const attr = (o = {}) => {
  const c = o.evidenceChain ?? chain(REAL);
  return {
    kind: 'ATTRIBUTION', merchantId: 'm1', actionKind: 'PHONE_CLICK',
    relationshipOwner: 'MERCHANT',
    evidenceChain: c, evidenceChainSha256: o.evidenceChainSha256 ?? sha(c),
    ...o, evidenceChain: c,
  };
};
const spend = (amount = 75) => ({ kind: 'SPEND', merchantId: 'm1', amount, relationshipOwner: 'MERCHANT' });

// ---------------------------------------------------------------- L1 evidence
test('L1: a genuine chain counts', () => {
  const v = buildGrowthView({ retailer: R(), ledger: [spend(), attr()], now });
  assert.equal(v.attribution.counted, 1);
  assert.equal(v.proof_of_value.attributed_actions, 1);
  assert.equal(v.proof_of_value.cost_per_attributed_action, 75);
});

test('L1: empty and meaningless chains are NOT evidence', () => {
  for (const bad of ['[]', '[{}]', '""', 'null', '{}', '[null]', '[[]]',
                     '[{"step":"x"}]', '[{"ref":"y"}]', '[{"step":"  ","ref":"y"}]',
                     '[{"step":"x","ref":"   "}]', 'not json', '', ' ']) {
    const v = buildGrowthView({ retailer: R(), ledger: [spend(), attr({ evidenceChain: bad })], now });
    assert.equal(v.attribution.counted, 0, `chain ${JSON.stringify(bad)} must not count`);
    assert.equal(v.attribution.rejected_unverifiable_evidence, 1,
      `chain ${JSON.stringify(bad)} must be rejected BY THE EVIDENCE GUARD, not another`);
    assert.equal(v.attribution.rejected_foreign_merchant, 0);
    assert.equal(v.proof_of_value, null, 'no proof of value without evidence');
  }
});

test('L1: SELF-HASHED attacker content still fails — content is validated first', () => {
  // The attacker controls both the chain and the digest, so the hash always
  // matches. Validating content before trusting the hash is the whole fix.
  for (const bad of ['[]', '[{}]', '[null]', '{}']) {
    const v = buildGrowthView({
      retailer: R(),
      ledger: [spend(), { kind: 'ATTRIBUTION', merchantId: 'm1', actionKind: 'PHONE_CLICK',
                          relationshipOwner: 'MERCHANT',
                          evidenceChain: bad, evidenceChainSha256: sha(bad) }],
      now,
    });
    assert.equal(v.attribution.counted, 0, `self-hashed ${bad} must not count`);
  }
});

test('L1: a TAMPERED chain whose digest no longer matches is rejected', () => {
  const good = chain(REAL);
  const v = buildGrowthView({
    retailer: R(),
    ledger: [spend(), attr({ evidenceChain: chain([{ step: 'forged', ref: 'x' }]), evidenceChainSha256: sha(good) })],
    now,
  });
  assert.equal(v.attribution.counted, 0);
});

test('L1: a prototype-polluted link cannot fake a step', () => {
  const polluted = JSON.stringify([JSON.parse('{"__proto__":{"step":"x","ref":"y"}}')]);
  const v = buildGrowthView({ retailer: R(), ledger: [spend(), attr({ evidenceChain: polluted })], now });
  assert.equal(v.attribution.counted, 0);
});

// -------------------------------------------------------------- L2 duplicates
test('L2: a REPLAYED action counts once and does not halve cost per action', () => {
  const v = buildGrowthView({ retailer: R(), ledger: [spend(75), attr(), attr()], now });
  assert.equal(v.attribution.counted, 1, 'the replay must not count');
  assert.equal(v.attribution.rejected_duplicate_evidence, 1, 'and the rejection must be REPORTED');
  assert.equal(v.proof_of_value.cost_per_attributed_action, 75, 'not 37.5');
});

test('L2: genuinely distinct actions both count', () => {
  const other = chain([{ step: 'render', ref: 'x' }, { step: 'call', ref: 'y' }]);
  const v = buildGrowthView({
    retailer: R(), ledger: [spend(100), attr(), attr({ evidenceChain: other, evidenceChainSha256: sha(other) })], now,
  });
  assert.equal(v.attribution.counted, 2);
  assert.equal(v.proof_of_value.cost_per_attributed_action, 50);
});

// -------------------------------------------------------------- L3 ownership
test('L3: another merchant\'s action is never credited here', () => {
  const v = buildGrowthView({ retailer: R(), ledger: [spend(), attr({ merchantId: 'OTHER' })], now });
  assert.equal(v.attribution.counted, 0);
  assert.equal(v.attribution.rejected_foreign_merchant, 1);
  assert.equal(v.attribution.rejected_unverifiable_evidence, 0, 'must be rejected for OWNERSHIP, not evidence');
});

test('L3: a row with no merchantId cannot be shown to belong here', () => {
  const v = buildGrowthView({ retailer: R(), ledger: [spend(), attr({ merchantId: undefined })], now });
  assert.equal(v.attribution.rejected_foreign_merchant, 1);
});

test('L3: a PLATFORM-owned relationship is refused', () => {
  const v = buildGrowthView({ retailer: R(), ledger: [spend(), attr({ relationshipOwner: 'PLATFORM' })], now });
  assert.equal(v.attribution.counted, 0);
  assert.equal(v.attribution.rejected_foreign_merchant, 1);
});

test('L3: case variants of MERCHANT are NOT silently accepted', () => {
  for (const owner of ['merchant', ' MERCHANT ', 'Merchant']) {
    const v = buildGrowthView({ retailer: R(), ledger: [spend(), attr({ relationshipOwner: owner })], now });
    assert.equal(v.attribution.counted, 0, `${JSON.stringify(owner)} must not pass as MERCHANT`);
  }
});

// ---------------------------------------------------------- L4 demonstration
test('L4: demonstration data withholds EVERY commercial figure', () => {
  const v = buildGrowthView({ retailer: R({ isDemonstration: true }), ledger: [spend(), attr()], now });
  assert.equal(v.proof_of_value, null, 'not shown with a caveat — withheld');
  assert.match(v.truth_label, /DEMONSTRATION_ONLY/);
  assert.ok(v.proof_of_value_blockers.some((b) => /demonstration/i.test(b)));
});

test('L4: dataStatus alone blocks, even when the boolean says otherwise', () => {
  for (const ds of ['DEMONSTRATION_ONLY', 'DEMO', 'synthetic-seed', 'SAMPLE_DATA']) {
    const v = buildGrowthView({ retailer: R({ isDemonstration: false, dataStatus: ds }), ledger: [spend(), attr()], now });
    assert.equal(v.proof_of_value, null, `dataStatus ${ds} must block`);
  }
});

test('L4: an all-demonstration MENU blocks a commercial figure', () => {
  const v = buildGrowthView({ retailer: R(), ledger: [spend(), attr()], menu: { total: 5, demonstration: 5 }, now });
  assert.equal(v.proof_of_value, null);
  assert.match(v.truth_label, /every MenuEntry/);
});

test('L4: a PARTLY demonstration menu does not alone condemn the record', () => {
  const v = buildGrowthView({ retailer: R(), ledger: [spend(), attr()], menu: { total: 5, demonstration: 4 }, now });
  assert.equal(v.truth_label, 'LIVE_RECORD');
  assert.ok(v.proof_of_value !== null);
});

test('L4: every demonstration reason is CITED, not summarised', () => {
  const v = buildGrowthView({ retailer: R({ isDemonstration: true, dataStatus: 'DEMONSTRATION_ONLY' }),
    ledger: [], menu: { total: 2, demonstration: 2 }, now });
  for (const frag of ['isDemonstration=true', 'dataStatus=DEMONSTRATION_ONLY', 'every MenuEntry']) {
    assert.ok(v.truth_label.includes(frag), `must cite ${frag}`);
  }
});

// -------------------------------------------------------------- L5 no claims
test('L5: cost per action is null, never 0 or Infinity, without both inputs', () => {
  const noSpend = buildGrowthView({ retailer: R(), ledger: [attr()], now });
  assert.equal(noSpend.proof_of_value, null);
  assert.ok(noSpend.proof_of_value_blockers.some((b) => /no placement spend/.test(b)));

  const noActions = buildGrowthView({ retailer: R(), ledger: [spend()], now });
  assert.equal(noActions.proof_of_value, null);
  assert.ok(noActions.proof_of_value_blockers.some((b) => /verifiable evidence/.test(b)));
});

test('L5: the view never asserts a ranking, lift, lead or revenue figure', () => {
  const v = buildGrowthView({ retailer: R(), ledger: [spend(), attr()],
    audit: { score: 62, counts: { pass: 18, warn: 2, fail: 10 },
             top_actions: [{ rank: 1, weight: 5, finding: 'License status verified',
                             evidence_field: 'Retailer.licenseStatus', observed: 'UNVERIFIED',
                             action: 'submit evidence' }] }, now });
  for (const k of NOT_CLAIMED) assert.ok(v.not_claimed.includes(k), `must disclaim ${k}`);
  const raw = JSON.stringify(v);
  assert.ok(!/guarantee|will increase|\bROI\b|more customers|higher ranking/i.test(raw),
    'no outcome may be promised anywhere in the payload');
});

test('L5: the visibility score explains what it is NOT', () => {
  const v = buildGrowthView({ retailer: R(), ledger: [], audit: { score: 62, counts: {}, top_actions: [] }, now });
  // Assert the MEANING, not one exact phrasing: the score must disclaim being a
  // ranking, a traffic figure, and a performance measure. My first version of
  // this test demanded the literal 'not a traffic', which the real (correct)
  // wording 'not a ranking, a traffic estimate, or a performance score' does not
  // contain — the test was wrong, not the copy.
  assert.match(v.visibility.means, /not a ranking/i);
  assert.match(v.visibility.means, /traffic/i);
  assert.match(v.visibility.means, /performance score/i);
});

test('L5: priority actions are shown even when proof of value is withheld', () => {
  // Withholding a merchant's actionable findings until they spend would be a
  // sales tactic, not a product.
  const v = buildGrowthView({ retailer: R({ isDemonstration: true }), ledger: [],
    audit: { score: 40, counts: {}, top_actions: [{ rank: 1, weight: 5, finding: 'Menu has entries',
      evidence_field: 'MenuEntry', observed: 'empty menu', action: 'Publish a menu' }] }, now });
  assert.equal(v.proof_of_value, null);
  assert.equal(v.priority_actions.length, 1, 'findings must still reach the merchant');
  assert.equal(v.priority_actions[0].evidence_field, 'MenuEntry');
});

test('L5: every priority action cites a field and a remedy', () => {
  const v = buildGrowthView({ retailer: R(), ledger: [],
    audit: { score: 50, counts: {}, top_actions: [
      { rank: 1, weight: 5, finding: 'a', evidence_field: 'X', observed: 'o', action: 'do' },
      { rank: 2, weight: 3, finding: 'b', evidence_field: 'Y', observed: 'p', action: 'fix' }] }, now });
  assert.ok(v.priority_actions.every((a) => a.evidence_field && a.action));
});

// -------------------------------------------------------------- L6 derivation
test('L6: spend is DERIVED from the chain, and refunds reduce it', () => {
  const v = buildGrowthView({
    retailer: R(),
    ledger: [spend(100), { kind: 'REFUND', merchantId: 'm1', amount: 25, relationshipOwner: 'MERCHANT' }, attr()],
    now,
  });
  assert.equal(v.proof_of_value.credits_spent, 75);
  assert.equal(v.proof_of_value.cost_per_attributed_action, 75);
});

test('L6: another merchant\'s spend never enters this merchant\'s cost', () => {
  const v = buildGrowthView({
    retailer: R(),
    ledger: [spend(75), { kind: 'SPEND', merchantId: 'OTHER', amount: 9999, relationshipOwner: 'MERCHANT' }, attr()],
    now,
  });
  assert.equal(v.proof_of_value.credits_spent, 75);
});

test('L6: float amounts do not accumulate dust into a false figure', () => {
  const c2 = chain([{ step: 'a', ref: 'b' }]);
  const v = buildGrowthView({
    retailer: R(),
    ledger: [spend(0.1), spend(0.2), attr(), attr({ evidenceChain: c2, evidenceChainSha256: sha(c2) })],
    now,
  });
  assert.equal(v.proof_of_value.credits_spent, 0.3, '0.1 + 0.2 must be exactly 0.30');
});

// ---------------------------------------------- E2E: REAL ledger row shapes
// These two defects survived 26 tests because every fixture above was shaped by
// the same hand that wrote the module. Only driving the real chain end to end
// exposed them. The rows below are shaped EXACTLY as demand-credits.mjs writes
// them, so this block is the regression guard against fixture-vs-reality drift.
const realIssue = (amount = 500) => ({ kind: 'ISSUE', merchantId: 'm1', amount,
  authorizationRef: 'REF', expiresAt: new Date(now.getTime() + 86400_000) });
// The ledger calls append with `amount: -amount` for SPEND, and sets NO
// relationshipOwner on money rows.
const realSpend = (amount = 75) => ({ kind: 'SPEND', merchantId: 'm1', amount: -amount,
  placement: 'NEIGHBORHOOD_BANNER', disclosureLabel: 'Paid placement', affectsOrganicOrder: false });

test('E2E-1: a NEGATIVE SPEND amount (how the ledger really stores it) counts', () => {
  const v = buildGrowthView({ retailer: R(), ledger: [realIssue(), realSpend(75), attr()], now });
  assert.ok(v.proof_of_value !== null,
    `withheld for a merchant who really paid: ${JSON.stringify(v.proof_of_value_blockers)}`);
  assert.equal(v.proof_of_value.credits_spent, 75, 'the sign must be normalized, not read raw');
  assert.equal(v.proof_of_value.cost_per_attributed_action, 75);
});

test('E2E-2: money rows lacking relationshipOwner still count', () => {
  // NOT a defect fix. I initially claimed ownedBy() dropped money rows because
  // they carry no relationshipOwner; falsifying that "fix" failed ZERO tests,
  // proving it guarded nothing — ownedBy tolerates an absent owner and refuses
  // only a PRESENT non-MERCHANT value. This test pins the real behaviour so a
  // future edit cannot introduce the defect I mistakenly thought I had fixed.
  const v = buildGrowthView({ retailer: R(), ledger: [realIssue(), realSpend(), attr()], now });
  assert.ok(realSpend().relationshipOwner === undefined, 'the real row genuinely lacks it');
  assert.equal(v.proof_of_value.credits_spent, 75);
  // The guard that DOES matter: a present, non-MERCHANT owner is still refused.
  const hostile = buildGrowthView({ retailer: R(),
    ledger: [realIssue(), { ...realSpend(), relationshipOwner: 'PLATFORM' }, attr()], now });
  assert.equal(hostile.proof_of_value, null, 'a PLATFORM-owned spend must not fund a merchant claim');
});

test('E2E: a REFUND stored positive still reduces real spend', () => {
  const v = buildGrowthView({ retailer: R(),
    ledger: [realIssue(), realSpend(100), { kind: 'REFUND', merchantId: 'm1', amount: 25, reason: 'r', originalSeq: 1 }, attr()], now });
  assert.equal(v.proof_of_value.credits_spent, 75);
});

test('E2E: another merchant\'s real money rows never enter this total', () => {
  const v = buildGrowthView({ retailer: R(),
    ledger: [realIssue(), realSpend(75), { kind: 'SPEND', merchantId: 'OTHER', amount: -9999 }, attr()], now });
  assert.equal(v.proof_of_value.credits_spent, 75);
});

test('E2E: a non-finite amount cannot corrupt the total', () => {
  for (const bad of [NaN, Infinity, -Infinity, 'abc', null, undefined]) {
    const v = buildGrowthView({ retailer: R(),
      ledger: [realIssue(), realSpend(75), { kind: 'SPEND', merchantId: 'm1', amount: bad }, attr()], now });
    assert.equal(v.proof_of_value.credits_spent, 75, `amount ${JSON.stringify(bad)} must be ignored`);
  }
});

// ------------------------------------------------------------- helper surface
test('evidenceLinks returns the parsed links for a real chain', () => {
  const links = evidenceLinks(attr());
  assert.ok(Array.isArray(links) && links.length === 2);
});

test('ownedBy and demonstrationReasons are directly attackable', () => {
  assert.equal(ownedBy({ merchantId: 'm1' }, 'm1'), true);
  assert.equal(ownedBy({ merchantId: 'm2' }, 'm1'), false);
  assert.equal(demonstrationReasons({ isDemonstration: false, dataStatus: 'VERIFIED_CURRENT' }).length, 0);
  assert.equal(demonstrationReasons({ isDemonstration: true }).length, 1);
});
