import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDemandCredits, GENESIS_HASH } from '../src/lib/demand-credits.mjs';

/**
 * Persisted Demand Credit ledger — DB-state verification.
 *
 * These run against a REAL disposable SQLite database, not a mock, because the
 * invariants being tested (derived balance, gapless hash chain, cross-merchant
 * isolation, idempotency) are properties of persistence. A mock would let all
 * of them pass while the real thing was broken.
 */

let prisma, credits, tmpDir, PrismaClient;
const A = 'merchant_alpha';
const B = 'merchant_beta';

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-test-'));
  const dbFile = path.join(tmpDir, 'test.db');
  const schema = path.join(tmpDir, 'schema.prisma');
  // Copy the real schema so the test cannot drift from production shape.
  fs.copyFileSync(path.resolve('prisma/schema.prisma'), schema);
  execFileSync('npx', ['prisma', 'db', 'push', '--schema', schema, '--skip-generate', '--accept-data-loss'], {
    env: { ...process.env, DATABASE_URL: `file:${dbFile}` }, stdio: 'pipe',
  });
  ({ PrismaClient } = await import('@prisma/client'));
  prisma = new PrismaClient({ datasources: { db: { url: `file:${dbFile}` } } });
  credits = createDemandCredits(prisma);
});

after(async () => {
  await prisma?.$disconnect();
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

const future = () => new Date(Date.now() + 30 * 86400_000);

test('empty merchant: balance 0 and chain verifies from genesis', async () => {
  assert.equal(await credits.balance(A), 0);
  const v = await credits.verifyChain(A);
  assert.equal(v.valid, true);
  assert.equal(v.head, GENESIS_HASH);
});

test('issue requires authorization, a valid expiry, and a FUTURE expiry', async () => {
  assert.equal((await credits.issue({ merchantId: A, amount: 100, expiresAt: future() })).denial_code, 'AUTHORIZATION_REQUIRED');
  assert.equal((await credits.issue({ merchantId: A, amount: 100, authorizationRef: '   ', expiresAt: future() })).denial_code, 'AUTHORIZATION_REQUIRED');
  assert.equal((await credits.issue({ merchantId: A, amount: 100, authorizationRef: 'PO-1' })).denial_code, 'EXPIRY_REQUIRED');
  assert.equal((await credits.issue({ merchantId: A, amount: 100, authorizationRef: 'PO-1', expiresAt: 'not-a-date' })).denial_code, 'EXPIRY_REQUIRED');
  // Pre-expired credits are meaningless; issuing them would make expiry decorative.
  assert.equal((await credits.issue({ merchantId: A, amount: 100, authorizationRef: 'PO-1', expiresAt: '2020-01-01' })).denial_code, 'EXPIRY_IN_PAST');
});

test('amount type strictness — numeric strings and coercible junk are refused', async () => {
  for (const bad of ['100', true, false, [], [100], {}, null, undefined, NaN, Infinity, -Infinity, 0, -5]) {
    const r = await credits.issue({ merchantId: A, amount: bad, authorizationRef: 'PO-1', expiresAt: future() });
    assert.notEqual(r.accepted, true, `amount=${JSON.stringify(bad)} must be refused`);
    assert.equal(r.denial_code, 'INVALID_AMOUNT', `amount=${JSON.stringify(bad)} wrong denial`);
  }
});

test('authorized issue persists and balance is derived from the row', async () => {
  const r = await credits.issue({ merchantId: A, amount: 500, authorizationRef: 'PO-2026-001', expiresAt: future() });
  assert.equal(r.accepted, true);
  assert.equal(await credits.balance(A), 500);
  // Verify against the DATABASE, not the return value.
  const row = await prisma.demandCreditEntry.findFirst({ where: { merchantId: A, kind: 'ISSUE' } });
  assert.equal(row.amount, 500);
  assert.equal(row.prevHash, GENESIS_HASH);
  assert.equal(row.seq, 0);
});

test('RANK PURCHASE REFUSED for every truthy shape, not just === true', async () => {
  // A loose check would record affectsOrganicOrder:false while the caller
  // believed they had bought ranking — a silent, dangerous mismatch.
  for (const v of [true, 'true', 1, [], {}, 'yes']) {
    const r = await credits.spend({ merchantId: A, amount: 10, placement: 'FEATURED_CARD', disclosureLabel: 'Sponsored', affectsOrganicOrder: v });
    assert.equal(r.denial_code, 'RANK_PURCHASE_REFUSED', `affectsOrganicOrder=${JSON.stringify(v)} must be refused`);
  }
});

test('placement requires disclosure and a known slot; overspend refused', async () => {
  assert.equal((await credits.spend({ merchantId: A, amount: 10, placement: 'FEATURED_CARD' })).denial_code, 'DISCLOSURE_REQUIRED');
  assert.equal((await credits.spend({ merchantId: A, amount: 10, placement: 'FEATURED_CARD', disclosureLabel: '  ' })).denial_code, 'DISCLOSURE_REQUIRED');
  assert.equal((await credits.spend({ merchantId: A, amount: 10, placement: 'TOP_OF_SEARCH', disclosureLabel: 'Sponsored' })).denial_code, 'UNKNOWN_PLACEMENT');
  assert.equal((await credits.spend({ merchantId: A, amount: 99999, placement: 'FEATURED_CARD', disclosureLabel: 'Sponsored' })).denial_code, 'INSUFFICIENT_CREDITS');
});

test('MONEY CONSERVATION: balance can never go negative across a spend sequence', async () => {
  const start = await credits.balance(A);
  // Drain in chunks, then attempt one more.
  let spent = 0;
  for (const amt of [100, 100, 100, 100]) {
    const r = await credits.spend({ merchantId: A, amount: amt, placement: 'DEAL_SPOTLIGHT', disclosureLabel: 'Sponsored — placement only' });
    if (r.accepted) spent += amt;
  }
  const after = await credits.balance(A);
  assert.equal(after, start - spent, 'balance must equal issued minus spent exactly');
  assert.ok(after >= 0, `balance went negative: ${after}`);
  const over = await credits.spend({ merchantId: A, amount: after + 1, placement: 'DEAL_SPOTLIGHT', disclosureLabel: 'Sponsored' });
  assert.equal(over.denial_code, 'INSUFFICIENT_CREDITS');
  assert.ok((await credits.balance(A)) >= 0);
});

test('FLOAT PRECISION: 0.1 + 0.2 credits do not create or destroy value', async () => {
  const M = 'merchant_float';
  await credits.issue({ merchantId: M, amount: 0.1, authorizationRef: 'PO-F1', expiresAt: future() });
  await credits.issue({ merchantId: M, amount: 0.2, authorizationRef: 'PO-F2', expiresAt: future() });
  assert.equal(await credits.balance(M), 0.3, 'integer-cent accounting must avoid float dust');
  const r = await credits.spend({ merchantId: M, amount: 0.3, placement: 'FEATURED_CARD', disclosureLabel: 'Sponsored' });
  assert.equal(r.accepted, true, '0.1+0.2 must be spendable as 0.3');
  assert.equal(await credits.balance(M), 0);
});

test('CROSS-MERCHANT ISOLATION: B cannot draw on A, refund A, or attribute to A', async () => {
  await credits.issue({ merchantId: A, amount: 1000, authorizationRef: 'PO-X', expiresAt: future() });
  assert.equal(await credits.balance(B), 0);
  assert.equal((await credits.spend({ merchantId: B, amount: 50, placement: 'FEATURED_CARD', disclosureLabel: 'Sponsored' })).denial_code, 'INSUFFICIENT_CREDITS');
  const aSpend = await credits.spend({ merchantId: A, amount: 50, placement: 'FEATURED_CARD', disclosureLabel: 'Sponsored' });
  assert.equal(aSpend.accepted, true);
  // B refunding A's spend must fail — ownership is part of the lookup.
  assert.equal((await credits.refund({ merchantId: B, amount: 10, reason: 'theft attempt', originalSeq: aSpend.entry.seq })).denial_code, 'ORIGINAL_SPEND_NOT_FOUND');
  // B attributing against A's placement must fail.
  assert.equal((await credits.attribute({
    merchantId: B, actionKind: 'PHONE_CLICK', observedAt: new Date(), placementSeq: aSpend.entry.seq,
    evidenceChain: [{ step: 's', ref: 'r' }],
  })).denial_code, 'PLACEMENT_NOT_FOUND');
});

test('refund is capped cumulatively and cannot target a non-SPEND', async () => {
  const M = 'merchant_refund';
  await credits.issue({ merchantId: M, amount: 300, authorizationRef: 'PO-R', expiresAt: future() });
  const sp = await credits.spend({ merchantId: M, amount: 120, placement: 'FEATURED_CARD', disclosureLabel: 'Sponsored' });
  assert.equal((await credits.refund({ merchantId: M, amount: 10, reason: 'x', originalSeq: 0 })).denial_code, 'ORIGINAL_SPEND_NOT_FOUND', 'seq 0 is the ISSUE, not a SPEND');
  assert.equal((await credits.refund({ merchantId: M, amount: 200, reason: 'x', originalSeq: sp.entry.seq })).denial_code, 'REFUND_EXCEEDS_SPEND');
  assert.equal((await credits.refund({ merchantId: M, amount: 20, reason: 'partial', originalSeq: sp.entry.seq })).accepted, true);
  assert.equal((await credits.refund({ merchantId: M, amount: 110, reason: 'over cumulative', originalSeq: sp.entry.seq })).denial_code, 'DOUBLE_REFUND_REFUSED');
  assert.equal((await credits.refund({ merchantId: M, amount: 100, reason: 'remainder', originalSeq: sp.entry.seq })).accepted, true);
  assert.equal((await credits.refund({ merchantId: M, amount: 1, reason: 'one too many', originalSeq: sp.entry.seq })).denial_code, 'DOUBLE_REFUND_REFUSED');
  assert.equal(await credits.balance(M), 300, 'fully refunded spend returns the balance exactly');
});

test('attribution requires complete dated evidence and never moves money', async () => {
  const M = 'merchant_attr';
  await credits.issue({ merchantId: M, amount: 200, authorizationRef: 'PO-A', expiresAt: future() });
  const sp = await credits.spend({ merchantId: M, amount: 50, placement: 'NEIGHBORHOOD_BANNER', disclosureLabel: 'Sponsored' });
  const before = await credits.balance(M);

  assert.equal((await credits.attribute({ merchantId: M, actionKind: 'PHONE_CLICK', evidenceChain: [], observedAt: new Date() })).denial_code, 'EVIDENCE_CHAIN_REQUIRED');
  assert.equal((await credits.attribute({ merchantId: M, actionKind: 'PHONE_CLICK', evidenceChain: [{ step: 'x' }], observedAt: new Date() })).denial_code, 'EVIDENCE_LINK_INCOMPLETE');
  assert.equal((await credits.attribute({ merchantId: M, actionKind: 'PHONE_CLICK', evidenceChain: [{ step: 'x', ref: 'y' }] })).denial_code, 'OBSERVED_AT_REQUIRED');
  assert.equal((await credits.attribute({ merchantId: M, actionKind: 'PURCHASE', evidenceChain: [{ step: 'x', ref: 'y' }], observedAt: new Date() })).denial_code, 'UNKNOWN_ACTION');
  assert.equal((await credits.attribute({ merchantId: M, actionKind: 'PHONE_CLICK', evidenceChain: new Array(65).fill({ step: 's', ref: 'r' }), observedAt: new Date() })).denial_code, 'EVIDENCE_CHAIN_TOO_LONG');
  // Prototype pollution must not fake a link.
  const polluted = JSON.parse('{"__proto__":{"step":"x","ref":"y"}}');
  assert.equal((await credits.attribute({ merchantId: M, actionKind: 'PHONE_CLICK', evidenceChain: [polluted], observedAt: new Date() })).denial_code, 'EVIDENCE_LINK_INCOMPLETE');

  const ok = await credits.attribute({
    merchantId: M, actionKind: 'PHONE_CLICK', observedAt: new Date(), placementSeq: sp.entry.seq,
    evidenceChain: [{ step: 'render', ref: 'r1' }, { step: 'click', ref: 'r2' }],
  });
  assert.equal(ok.accepted, true);
  assert.equal(ok.entry.amount, 0, 'attribution must never move money');
  assert.equal(ok.entry.relationshipOwner, 'MERCHANT');
  assert.equal(ok.entry.exportableByMerchant, true);
  assert.equal(await credits.balance(M), before, 'balance unchanged by attribution');
});

test('IDEMPOTENCY: the same evidence chain cannot inflate proof of value twice', async () => {
  const M = 'merchant_idem';
  await credits.issue({ merchantId: M, amount: 100, authorizationRef: 'PO-I', expiresAt: future() });
  const chain = [{ step: 'render', ref: 'unique-1' }, { step: 'click', ref: 'unique-2' }];
  const first = await credits.attribute({ merchantId: M, actionKind: 'MENU_VIEW', evidenceChain: chain, observedAt: new Date() });
  assert.equal(first.accepted, true);
  const second = await credits.attribute({ merchantId: M, actionKind: 'MENU_VIEW', evidenceChain: chain, observedAt: new Date() });
  assert.equal(second.denial_code, 'DUPLICATE_ATTRIBUTION', 'replaying the same evidence must not double-count');
  const pov = await credits.proofOfValue(M);
  assert.equal(pov.attributed_actions, 1);
});

test('CHAIN FORGERY: edit, reorder and truncation are all detected', async () => {
  const M = 'merchant_chain';
  await credits.issue({ merchantId: M, amount: 100, authorizationRef: 'PO-C', expiresAt: future() });
  await credits.spend({ merchantId: M, amount: 40, placement: 'FEATURED_CARD', disclosureLabel: 'Sponsored' });
  await credits.spend({ merchantId: M, amount: 10, placement: 'DEAL_SPOTLIGHT', disclosureLabel: 'Sponsored' });
  assert.equal((await credits.verifyChain(M)).valid, true);

  // 1. Silent edit of a recorded amount.
  await prisma.demandCreditEntry.updateMany({ where: { merchantId: M, seq: 1 }, data: { amount: -1 } });
  let v = await credits.verifyChain(M);
  assert.equal(v.valid, false, 'a silent amount edit must be detected');
  assert.equal(v.brokenAt, 1);
  await prisma.demandCreditEntry.updateMany({ where: { merchantId: M, seq: 1 }, data: { amount: -40 } });
  assert.equal((await credits.verifyChain(M)).valid, true, 'restoring the value restores the chain');

  // 2. MIDDLE deletion while the tail remains — leaves a real gap, and the
  //    surviving tail's prevHash no longer matches its predecessor.
  const mid = await prisma.demandCreditEntry.findFirst({ where: { merchantId: M, seq: 1 } });
  await prisma.demandCreditEntry.delete({ where: { id: mid.id } });
  v = await credits.verifyChain(M);
  assert.equal(v.valid, false, 'a middle deletion must be detected');
  assert.equal(v.brokenAt, 2, 'the surviving tail is where the break surfaces');

  // 3. TAIL truncation is an HONEST LIMIT, asserted so it can never be
  //    silently forgotten: removing the newest entries leaves a shorter but
  //    fully self-consistent chain. Detecting it requires an external anchor
  //    (a published head hash), which this module does not yet have.
  const M2 = 'merchant_trunc';
  await credits.issue({ merchantId: M2, amount: 100, authorizationRef: 'PO-T', expiresAt: future() });
  const t2 = await credits.spend({ merchantId: M2, amount: 10, placement: 'FEATURED_CARD', disclosureLabel: 'Sponsored' });
  assert.equal((await credits.verifyChain(M2)).valid, true);
  await prisma.demandCreditEntry.delete({ where: { id: t2.entry.id } });
  const vt = await credits.verifyChain(M2);
  assert.equal(vt.valid, true, 'DOCUMENTED LIMIT: tail truncation is not detectable by replay alone');
  assert.ok(vt.anchor_caveat.includes('external anchor'), 'the limit must be disclosed in the result');
});

test('proofOfValue re-hashes evidence rather than trusting a flag', async () => {
  const M = 'merchant_pov';
  await credits.issue({ merchantId: M, amount: 100, authorizationRef: 'PO-P', expiresAt: future() });
  await credits.attribute({ merchantId: M, actionKind: 'WEBSITE_CLICK', evidenceChain: [{ step: 's', ref: 'r' }], observedAt: new Date() });
  let pov = await credits.proofOfValue(M);
  assert.equal(pov.every_action_has_evidence, true);
  assert.equal(pov.actions_with_verified_evidence, 1);
  assert.deepEqual(pov.not_claimed, ['ranking position', 'traffic', 'impressions', 'leads', 'conversion lift']);

  // Tamper with the stored evidence so it no longer matches its digest.
  const a = await prisma.demandCreditEntry.findFirst({ where: { merchantId: M, kind: 'ATTRIBUTION' } });
  await prisma.demandCreditEntry.update({ where: { id: a.id }, data: { evidenceChain: '[{"step":"forged","ref":"forged"}]' } });
  pov = await credits.proofOfValue(M);
  assert.equal(pov.actions_with_verified_evidence, 0, 'tampered evidence must not count as evidenced');
  assert.equal(pov.every_action_has_evidence, false);
});

test('merchant export carries the relationship and a portability statement', async () => {
  const ex = await credits.exportForMerchant('merchant_attr');
  assert.equal(ex.relationship_owner, 'MERCHANT');
  assert.ok(ex.portability_statement.includes('belong to the merchant'));
  assert.ok(ex.attributed_actions.length >= 1);
  assert.equal(ex.chain_verification.valid, true);
});

test('hostile merchantId values do not crash or pollute', async () => {
  for (const id of ['__proto__', 'constructor', 'prototype', 'a'.repeat(5000), '日本語', "'; DROP TABLE DemandCreditEntry; --"]) {
    const r = await credits.issue({ merchantId: id, amount: 10, authorizationRef: 'PO-H', expiresAt: future() });
    assert.equal(r.accepted, true, `hostile id ${id.slice(0, 20)} should be handled as data`);
    assert.equal(await credits.balance(id), 10);
  }
  assert.equal({}.step, undefined, 'Object.prototype must not be polluted');
  // The table must still exist after the injection attempt.
  assert.ok((await prisma.demandCreditEntry.count()) > 0);
});
