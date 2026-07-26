import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';

/**
 * MERCHANT PILOT EVIDENCE CHAIN — end to end, through the real surfaces.
 *
 * Every component of the revenue chain has been attacked in isolation: the
 * visibility audit, the demand-credit ledger, the attribution endpoint, the Growth
 * OS view, the merchant pilot package. None had ever been run END TO END through
 * the real HTTP surface against real database rows.
 *
 * That gap matters more than it sounds. Each component's own tests use fixtures
 * shaped by the same hand that wrote the component, so two components can each be
 * "correct" against their own fixture and disagree about the real row. The only
 * way to know the chain holds is to drive it once, in order, through the surfaces
 * a merchant would actually touch:
 *
 *   audit the profile  ->  fund placement  ->  spend on placement
 *   ->  record a REAL attributed action over HTTP
 *   ->  derive proof of value  ->  confirm the ledger chain still verifies
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. No merchant is contacted, no payment is
 * activated, no public claim is made. Those are owner-only. This proves the
 * evidence machinery works so that when the owner authorizes a real pilot, the
 * proof is already trustworthy — not the other way round.
 */

const TENANT = 'orderweeddc.localhost';
const sha = (s) => createHash('sha256').update(s).digest('hex');
let fx = null;

function req(method, path, { body = null } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === null ? null : JSON.stringify(body);
    const r = http.request(
      {
        host: '127.0.0.1', port: 3000, path, method,
        headers: {
          Host: TENANT,
          ...(payload === null ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }),
        },
      },
      (res) => {
        let out = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { out += c; });
        res.on('end', () => resolve({ status: res.statusCode, json: async () => JSON.parse(out), text: async () => out }));
      },
    );
    r.on('error', reject);
    if (payload !== null) r.write(payload);
    r.end();
  });
}

async function db() {
  const { PrismaClient } = await import('@prisma/client');
  return new PrismaClient();
}

before(async () => {
  for (let i = 0; i < 40; i++) {
    try { const r = await req('GET', '/api/health'); if (r.status < 500) break; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  const p = await db();
  const now = new Date();
  const brand = await p.brand.findUnique({ where: { domain: TENANT }, select: { id: true } });
  if (!brand) { await p.$disconnect(); throw new Error(`tenant ${TENANT} not configured`); }

  const retailer = await p.retailer.create({
    data: {
      name: 'Pilot Chain Merchant', type: 'DISPENSARY',
      address: '5 Pilot Way', city: 'Washington', state: 'DC', zip: '20001',
      lat: 38.9072, lng: -77.0369, phone: '202-555-0177',
      hours: 'Mon-Sun 9-9', hoursSource: 'merchant-confirmed',
      licenseStatus: 'VERIFIED', licenseNumber: 'DC-PILOT-1',
      lastLicenseCheck: now, lastInfoCheck: now,
      dataStatus: 'VERIFIED_CURRENT', dataSource: 'pilot-chain-test',
      sourceUrl: 'https://example.invalid/pilot',
      retrievedAt: now, verifiedAt: now,
      freshnessExpiresAt: new Date(now.getTime() + 86400_000),
      confidence: 0.97, isDemonstration: false,
    },
    select: { id: true },
  });
  const product = await p.product.create({ data: { name: 'Pilot Chain Product', category: 'FLOWER' }, select: { id: true } });
  const entry = await p.menuEntry.create({
    data: { retailerId: retailer.id, productId: product.id, price: 30, dataStatus: 'VERIFIED_CURRENT', isDemonstration: false },
    select: { id: true },
  });
  await p.brandMenu.create({ data: { brandId: brand.id, menuEntryId: entry.id } });
  await p.$disconnect();
  fx = { retailerId: retailer.id, productId: product.id };
});

after(async () => {
  if (!fx) return;
  const p = await db();
  // Ledger rows are NOT cascade-deleted by retailer. A failed run would otherwise
  // leave ATTRIBUTION rows that a later proof-of-value would count as real.
  await p.demandCreditEntry.deleteMany({ where: { merchantId: fx.retailerId } });
  await p.retailer.deleteMany({ where: { id: fx.retailerId } });
  await p.product.deleteMany({ where: { id: fx.productId } });
  await p.$disconnect();
});

test('STAGE 1 — the profile can be audited from real rows', async () => {
  const p = await db();
  const r = await p.retailer.findUnique({ where: { id: fx.retailerId } });
  const menuCount = await p.menuEntry.count({ where: { retailerId: fx.retailerId } });
  await p.$disconnect();
  assert.ok(r, 'the fixture retailer must exist');
  assert.equal(r.isDemonstration, false, 'a demonstration record could never carry a commercial result');
  assert.equal(r.dataStatus, 'VERIFIED_CURRENT');
  assert.ok(menuCount > 0, 'a merchant with no menu has nothing to attribute against');
});

test('STAGE 2 — placement is funded and spent through the LEDGER, not by insert', async () => {
  const p = await db();
  const m = await import('../src/lib/demand-credits.mjs');
  const credits = m.createDemandCredits(p);
  const issued = await credits.issue({
    merchantId: fx.retailerId, amount: 500,
    authorizationRef: 'PILOT-CHAIN-TEST-NOT-A-REAL-PAYMENT',
    expiresAt: new Date(Date.now() + 30 * 86400_000),
  });
  assert.equal(issued.accepted, true, `issue refused: ${issued.denial_code ?? ''} ${issued.denial_detail ?? ''}`);
  const spent = await credits.spend({
    merchantId: fx.retailerId, amount: 75,
    // NEIGHBORHOOD_FEATURE was my invention; the ledger refused it with
    // UNKNOWN_PLACEMENT and listed the real enum. The guard was right and my test
    // was wrong — exactly the kind of disagreement only an end-to-end run finds.
    placement: 'NEIGHBORHOOD_BANNER',
    disclosureLabel: 'Paid placement',
    affectsOrganicOrder: false,
  });
  assert.equal(spent.accepted, true, `spend refused: ${spent.denial_code ?? ''} ${spent.denial_detail ?? ''}`);
  const bal = await credits.balance(fx.retailerId);
  assert.equal(bal, 425, 'balance must be DERIVED from the chain: 500 issued - 75 spent');
  await p.$disconnect();
});

test('STAGE 3 — a REAL attributed action is recorded over HTTP', async () => {
  const r = await req('POST', '/api/v1/attribution', {
    body: { retailer_id: fx.retailerId, action_kind: 'PHONE_CLICK', idempotency_key: 'pilot-chain-1' },
  });
  assert.equal(r.status, 201, `attribution refused: ${await r.text()}`);
  const b = await r.json();
  assert.equal(b.recorded, true);
  assert.equal(b.attribution.evidence_links, 4, 'the SERVER built the evidence, not the caller');
  assert.match(b.attribution.evidence_digest, /^[0-9a-f]{64}$/);
});

test('STAGE 3b — a replay of that action is REFUSED, not counted twice', async () => {
  const r = await req('POST', '/api/v1/attribution', {
    body: { retailer_id: fx.retailerId, action_kind: 'PHONE_CLICK', idempotency_key: 'pilot-chain-1' },
  });
  assert.equal(r.status, 409);
  assert.equal((await r.json()).error, 'DUPLICATE_ATTRIBUTION');
});

test('STAGE 4 — the recorded row survives the EVIDENCE guard independently', async () => {
  // The attribution endpoint wrote it; the growth module must independently agree
  // it is evidence. Two components shaped by the same author can each be correct
  // against their own fixture and still disagree about a real row.
  const p = await db();
  const rows = await p.demandCreditEntry.findMany({ where: { merchantId: fx.retailerId }, orderBy: { seq: 'asc' } });
  await p.$disconnect();
  const { evidenceLinks, ownedBy } = await import('../src/lib/growth-os.mjs');
  const attrs = rows.filter((r) => r.kind === 'ATTRIBUTION');
  assert.equal(attrs.length, 1, 'exactly one action should have been recorded');
  const links = evidenceLinks(attrs[0]);
  assert.ok(Array.isArray(links) && links.length === 4, 'the growth module must accept the endpoint\'s evidence');
  assert.equal(ownedBy(attrs[0], fx.retailerId), true, 'and must agree the merchant owns it');
  // Recompute the digest the same way the pilot does.
  assert.equal(sha(attrs[0].evidenceChain), attrs[0].evidenceChainSha256);
});

test('STAGE 5 — proof of value is DERIVED and is not withheld', async () => {
  const p = await db();
  const rows = await p.demandCreditEntry.findMany({ where: { merchantId: fx.retailerId }, orderBy: { seq: 'asc' } });
  const retailer = await p.retailer.findUnique({
    where: { id: fx.retailerId },
    select: { id: true, name: true, dataStatus: true, isDemonstration: true },
  });
  const menuTotal = await p.menuEntry.count({ where: { retailerId: fx.retailerId } });
  const menuDemo = await p.menuEntry.count({ where: { retailerId: fx.retailerId, isDemonstration: true } });
  await p.$disconnect();

  const { buildGrowthView } = await import('../src/lib/growth-os.mjs');
  const view = buildGrowthView({ retailer, ledger: rows, menu: { total: menuTotal, demonstration: menuDemo } });

  assert.equal(view.truth_label, 'LIVE_RECORD');
  // GRADING CHANGED THIS STAGE, correctly. The HTTP call in STAGE 3 carries no
  // interaction token, so its row is REQUEST_RECEIVED and is NOT value-eligible.
  // Proof of value is therefore withheld — which is the honest outcome, and the
  // whole point of the grading work. Asserting the old "not withheld" expectation
  // would be asserting that an untokened request proves a consumer acted.
  assert.equal(view.proof_of_value, null,
    'an untokened request must not yield proof of value');
  assert.ok(view.attribution.rejected_unproven_interaction >= 1,
    'and the row must be rejected BY THE GRADE guard, visibly');
  // The rest of the chain still holds: the row exists, is owned, and is evidenced.
  assert.equal(view.attribution.rows_seen, 1);
  // And it still claims nothing.
  for (const k of ['revenue', 'leads', 'conversion lift', 'traffic']) {
    assert.ok(view.not_claimed.includes(k), `must disclaim ${k}`);
  }
});

test('STAGE 6 — the ledger hash chain still verifies after the whole flow', async () => {
  const p = await db();
  const m = await import('../src/lib/demand-credits.mjs');
  const credits = m.createDemandCredits(p);
  const v = await credits.verifyChain(fx.retailerId);
  await p.$disconnect();
  assert.equal(v.valid, true, `chain broken: ${JSON.stringify(v)}`);
});

test('STAGE 7 — the merchant can EXPORT their own evidence', async () => {
  // A merchant who cannot take their evidence with them does not own the
  // relationship, whatever the package claims.
  const p = await db();
  const m = await import('../src/lib/demand-credits.mjs');
  const credits = m.createDemandCredits(p);
  const exported = await credits.exportForMerchant(fx.retailerId);
  await p.$disconnect();
  assert.ok(exported, 'an export must be produced');
  const raw = JSON.stringify(exported);
  assert.ok(raw.includes(fx.retailerId), 'the export must identify the merchant');
  assert.ok(!/ranking|conversion lift|guarantee/i.test(raw), 'and must claim nothing');
});

test('THE WHOLE CHAIN refuses to produce a result for DEMONSTRATION data', async () => {
  // The same flow, run against a seeded demonstration retailer, must yield
  // nothing at every stage — this is the control that proves the chain above
  // measured something real rather than always saying yes.
  const p = await db();
  const demo = await p.retailer.findFirst({
    where: { isDemonstration: true },
    select: { id: true, name: true, dataStatus: true, isDemonstration: true },
  });
  await p.$disconnect();
  assert.ok(demo, 'a seeded demonstration retailer must exist for this control');

  // The HTTP surface refuses outright.
  const r = await req('POST', '/api/v1/attribution', {
    body: { retailer_id: demo.id, action_kind: 'PHONE_CLICK' },
  });
  assert.equal(r.status, 409, 'attribution against demonstration data must be refused');

  // And even given a hand-built ledger, the view withholds every figure.
  const { buildGrowthView } = await import('../src/lib/growth-os.mjs');
  const chain = JSON.stringify([{ step: 'a', ref: 'b' }]);
  const view = buildGrowthView({
    retailer: demo,
    ledger: [
      { kind: 'SPEND', merchantId: demo.id, amount: 75, relationshipOwner: 'MERCHANT' },
      { kind: 'ATTRIBUTION', merchantId: demo.id, actionKind: 'PHONE_CLICK', relationshipOwner: 'MERCHANT',
        evidenceChain: chain, evidenceChainSha256: sha(chain) },
    ],
  });
  assert.equal(view.proof_of_value, null, 'demonstration data must never yield proof of value');
  assert.match(view.truth_label, /DEMONSTRATION_ONLY/);
});

test('OWNER GATES remain closed — nothing here authorizes real contact or payment', async () => {
  // This suite proves the machinery. It must not be readable as authorization.
  const p = await db();
  const rows = await p.demandCreditEntry.findMany({ where: { merchantId: fx.retailerId } });
  await p.$disconnect();
  const issue = rows.find((r) => r.kind === 'ISSUE');
  assert.ok(issue, 'an ISSUE row must exist');
  // My first assertion demanded NOT_A_REAL_PAYMENT with underscores while the
  // reference I passed uses hyphens. The reference was right; the regex was wrong.
  assert.match(issue.authorizationRef, /NOT[-_]A[-_]REAL[-_]PAYMENT/i,
    'the funding reference must state plainly that no real payment occurred');
  // And no row anywhere may imply a real charge or a real merchant contact.
  const raw = JSON.stringify(rows);
  assert.ok(!/stripe|charge_id|card_|invoice|contacted|outreach|emailed/i.test(raw),
    'nothing in this flow may look like a real payment or a real merchant contact');
});
