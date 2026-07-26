import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

/**
 * PUBLIC API v1 — attribution CONTRACT TESTS.
 *
 * These run against the REAL running server over HTTP. The endpoint's whole
 * purpose is to be the ONLY path by which a consumer action becomes ledger
 * evidence, so the tests attack the ways a caller could manufacture evidence
 * rather than merely reporting an action.
 *
 * Host header: undici (global fetch) IGNORES a manually supplied Host header, so
 * a tenant-scoped endpoint is untestable through fetch — every request arrives as
 * 127.0.0.1 and is correctly refused with 421. node:http honours it.
 */

const TENANT = 'orderweeddc.localhost';
let fixture = null;

function req(method, path, { host = TENANT, body = null, raw = null } = {}) {
  return new Promise((resolve, reject) => {
    const payload = raw !== null ? raw : body === null ? null : JSON.stringify(body);
    const r = http.request(
      {
        host: '127.0.0.1', port: 3000, path, method,
        headers: {
          Host: host,
          ...(payload === null ? {} : {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          }),
        },
      },
      (res) => {
        let out = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { out += c; });
        res.on('end', () => resolve({
          status: res.statusCode,
          headers: { get: (k) => res.headers[k.toLowerCase()] ?? null },
          json: async () => JSON.parse(out),
          text: async () => out,
        }));
      },
    );
    r.on('error', reject);
    if (payload !== null) r.write(payload);
    r.end();
  });
}
const post = (p, o) => req('POST', p, o);

/**
 * The test owns its fixture. A VERIFIED retailer is required for a recordable
 * action, and every seeded retailer is demonstration data — but promoting a
 * seeded row to VERIFIED_CURRENT would manufacture exactly the counterfeit
 * verification this endpoint refuses, and would leave it in the database. So the
 * test creates its own, wires it into the tenant through the real menu graph,
 * and destroys it in after() — which runs even when an assertion fails.
 */
async function createFixture() {
  const { PrismaClient } = await import('@prisma/client');
  const db = new PrismaClient();
  const now = new Date();
  const brand = await db.brand.findUnique({ where: { domain: TENANT }, select: { id: true } });
  if (!brand) { await db.$disconnect(); throw new Error(`tenant ${TENANT} is not configured`); }

  const mk = async (tag, over = {}) => {
    const retailer = await db.retailer.create({
      data: {
        name: `Attr Fixture ${tag}`, type: 'DISPENSARY',
        address: '2 Test Way', city: 'Washington', state: 'DC', zip: '20001',
        lat: 38.9072, lng: -77.0369,
        dataStatus: 'VERIFIED_CURRENT', dataSource: 'attribution-contract-test',
        sourceUrl: 'https://example.invalid/fixture',
        retrievedAt: now, verifiedAt: now,
        freshnessExpiresAt: new Date(now.getTime() + 86400_000),
        confidence: 0.99, isDemonstration: false,
        ...over,
      },
      select: { id: true },
    });
    const product = await db.product.create({
      data: { name: `Attr Product ${tag}`, category: 'FLOWER' }, select: { id: true },
    });
    const entry = await db.menuEntry.create({
      data: { retailerId: retailer.id, productId: product.id, price: 10,
              dataStatus: 'VERIFIED_CURRENT', isDemonstration: false },
      select: { id: true },
    });
    await db.brandMenu.create({ data: { brandId: brand.id, menuEntryId: entry.id } });
    return { retailerId: retailer.id, productId: product.id };
  };

  const live = await mk('LIVE');
  const demo = await mk('DEMO', { dataStatus: 'DEMONSTRATION_ONLY', isDemonstration: true });
  // Reachable from NO brand menu — used to prove cross-tenant refusal.
  const orphanRetailer = await db.retailer.create({
    data: {
      name: 'Attr Fixture ORPHAN', type: 'DISPENSARY', address: '3 Test Way',
      city: 'Washington', state: 'DC', zip: '20001', lat: 38.9, lng: -77.0,
      dataStatus: 'VERIFIED_CURRENT', dataSource: 'attribution-contract-test',
      retrievedAt: now, verifiedAt: now,
      freshnessExpiresAt: new Date(now.getTime() + 86400_000),
      confidence: 0.99, isDemonstration: false,
    },
    select: { id: true },
  });
  await db.$disconnect();
  return { live, demo, orphanId: orphanRetailer.id };
}

async function destroyFixture(f) {
  if (!f) return;
  const { PrismaClient } = await import('@prisma/client');
  const db = new PrismaClient();
  const retailerIds = [f.live.retailerId, f.demo.retailerId, f.orphanId];
  // Ledger rows are NOT cascade-deleted by retailer, so clear them explicitly or
  // a failed run leaves attribution rows that a later proof-of-value would count.
  await db.demandCreditEntry.deleteMany({ where: { merchantId: { in: retailerIds } } });
  await db.retailer.deleteMany({ where: { id: { in: retailerIds } } });
  await db.product.deleteMany({ where: { id: { in: [f.live.productId, f.demo.productId] } } });
  await db.$disconnect();
}

before(async () => {
  for (let i = 0; i < 40; i++) {
    try { const r = await req('GET', '/api/health'); if (r.status < 500) break; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  fixture = await createFixture();
});

after(async () => { await destroyFixture(fixture); });

test('records a real action and returns a thin receipt', async () => {
  const r = await post('/api/v1/attribution', {
    body: { retailer_id: fixture.live.retailerId, action_kind: 'PHONE_CLICK' },
  });
  assert.equal(r.status, 201);
  const b = await r.json();
  assert.equal(b.recorded, true);
  assert.equal(b.attribution.action_kind, 'PHONE_CLICK');
  assert.equal(b.attribution.evidence_links, 4, 'the server must build the evidence chain');
  assert.match(b.attribution.evidence_digest ?? '', /^[0-9a-f]{64}$/);
  assert.equal(typeof b.attribution.ledger_seq, 'number');
});

test('the receipt claims NO commercial outcome', async () => {
  const r = await post('/api/v1/attribution', {
    body: { retailer_id: fixture.live.retailerId, action_kind: 'WEBSITE_CLICK' },
  });
  const b = await r.json();
  assert.equal(b.truth_contract.evidence_built_by, 'server');
  assert.equal(b.truth_contract.client_supplied_evidence_accepted, false);
  for (const k of ['ranking position', 'traffic', 'lead', 'conversion lift', 'revenue']) {
    assert.ok(b.truth_contract.not_claimed.includes(k), `must disclaim ${k}`);
  }
  const raw = JSON.stringify(b);
  assert.ok(!/guarantee|lift of|increase of|\bROI\b/i.test(raw), 'no outcome may be implied');
});

test('CLIENT-SUPPLIED EVIDENCE is refused, not silently ignored', async () => {
  // The forgery this endpoint exists to prevent. A caller that could supply the
  // chain could supply the proof.
  for (const field of ['evidence_chain', 'evidenceChain', 'evidence_chain_sha256',
                       'observed_at', 'amount', 'relationship_owner', 'seq']) {
    const r = await post('/api/v1/attribution', {
      body: { retailer_id: fixture.live.retailerId, action_kind: 'MENU_VIEW', [field]: 'x' },
    });
    const b = await r.json();
    assert.equal(r.status, 400, `${field} must be refused`);
    assert.equal(b.error, 'CLIENT_SUPPLIED_EVIDENCE_REFUSED');
    assert.equal(b.recorded, false);
  }
});

test('DEMONSTRATION data can never become commercial evidence', async () => {
  const r = await post('/api/v1/attribution', {
    body: { retailer_id: fixture.demo.retailerId, action_kind: 'PROFILE_VIEW' },
  });
  assert.equal(r.status, 409);
  const b = await r.json();
  assert.equal(b.error, 'DEMONSTRATION_OR_UNVERIFIED_RETAILER');
  assert.equal(b.recorded, false);
});

test('CROSS-TENANT attribution is refused', async () => {
  // A verified retailer that is not reachable from this tenant's menu graph.
  const r = await post('/api/v1/attribution', {
    body: { retailer_id: fixture.orphanId, action_kind: 'PHONE_CLICK' },
  });
  assert.equal(r.status, 404);
  assert.equal((await r.json()).error, 'RETAILER_NOT_IN_TENANT');
});

test('an UNKNOWN TENANT cannot record anything', async () => {
  const r = await post('/api/v1/attribution', {
    host: 'not-a-configured-host.localhost',
    body: { retailer_id: fixture.live.retailerId, action_kind: 'PHONE_CLICK' },
  });
  assert.ok(r.status === 421, `expected 421, got ${r.status}`);
  const body = await r.text();
  assert.ok(!/"recorded":\s*true/.test(body), 'a refused tenant must not record');
});

test('DUPLICATE actions are refused by the ledger, not counted twice', async () => {
  const key = `contract-dup-${Date.now()}`;
  const one = await post('/api/v1/attribution', {
    body: { retailer_id: fixture.live.retailerId, action_kind: 'DIRECTIONS_CLICK', idempotency_key: key },
  });
  assert.equal(one.status, 201);
  const two = await post('/api/v1/attribution', {
    body: { retailer_id: fixture.live.retailerId, action_kind: 'DIRECTIONS_CLICK', idempotency_key: key },
  });
  assert.equal(two.status, 409, 'a replayed action must be refused');
  const b = await two.json();
  assert.equal(b.error, 'DUPLICATE_ATTRIBUTION');
  assert.equal(b.recorded, false);
});

test('A6: REPEATED identical actions with NO key are refused, not counted', async () => {
  // VERIFIER FINDING A6 (HIGH). The endpoint baked observedAt.toISOString() into the
  // evidence chain, so every request produced a different digest and the ledger's
  // dedupe could never fire. Five identical POSTs produced FIVE counted actions,
  // while a code comment asserted this was impossible. An unauthenticated caller
  // could inflate a merchant's attributed_actions and deflate cost-per-action.
  const results = [];
  for (let i = 0; i < 5; i++) {
    const r = await post('/api/v1/attribution', {
      body: { retailer_id: fixture.live.retailerId, action_kind: 'MENU_VIEW' },
    });
    results.push(r.status);
  }
  const recorded = results.filter((s) => s === 201).length;
  const refused = results.filter((s) => s === 409).length;
  assert.equal(recorded, 1, `five identical actions produced ${recorded} records — replay inflation`);
  assert.equal(refused, 4, 'the other four must be refused as duplicates');
});

test('A6: the dedupe is NOT so blunt that it swallows distinct actions', async () => {
  // The window dedupe must collapse REPLAYS without collapsing genuinely different
  // events. All six action kinds are used elsewhere in this file, and every test
  // shares one 5-minute window, so asking "is DIRECTIONS_CLICK accepted?" depends on
  // test ORDER — which is not a property of the endpoint. Instead this uses its own
  // fresh retailer, so the assertion is about the dedupe rule alone.
  const { PrismaClient } = await import('@prisma/client');
  const db = new PrismaClient();
  const now = new Date();
  const brand = await db.brand.findUnique({ where: { domain: TENANT }, select: { id: true } });
  const r = await db.retailer.create({
    data: {
      name: 'Attr Fixture DEDUPE', type: 'DISPENSARY', address: '4 Test Way',
      city: 'Washington', state: 'DC', zip: '20001', lat: 38.9, lng: -77.0,
      dataStatus: 'VERIFIED_CURRENT', dataSource: 'attribution-contract-test',
      retrievedAt: now, verifiedAt: now,
      freshnessExpiresAt: new Date(now.getTime() + 86400_000),
      confidence: 0.99, isDemonstration: false,
    },
    select: { id: true },
  });
  const prod = await db.product.create({ data: { name: 'Attr Product DEDUPE', category: 'FLOWER' }, select: { id: true } });
  const me = await db.menuEntry.create({
    data: { retailerId: r.id, productId: prod.id, price: 10, dataStatus: 'VERIFIED_CURRENT', isDemonstration: false },
    select: { id: true },
  });
  await db.brandMenu.create({ data: { brandId: brand.id, menuEntryId: me.id } });
  await db.$disconnect();

  try {
    // Four DIFFERENT kinds on a clean merchant must all be counted.
    const kinds = ['PROFILE_VIEW', 'MENU_VIEW', 'PHONE_CLICK', 'DIRECTIONS_CLICK'];
    const codes = [];
    for (const k of kinds) {
      const res = await post('/api/v1/attribution', { body: { retailer_id: r.id, action_kind: k } });
      codes.push(res.status);
    }
    assert.deepEqual(codes, [201, 201, 201, 201],
      `distinct action kinds must each count, got ${JSON.stringify(codes)}`);
    // And a replay of one of them, same window, must be refused.
    const replay = await post('/api/v1/attribution', { body: { retailer_id: r.id, action_kind: 'PHONE_CLICK' } });
    assert.equal(replay.status, 409, 'a replay within the window must be refused');
  } finally {
    const db2 = new PrismaClient();
    await db2.demandCreditEntry.deleteMany({ where: { merchantId: r.id } });
    await db2.retailer.deleteMany({ where: { id: r.id } });
    await db2.product.deleteMany({ where: { id: prod.id } });
    await db2.$disconnect();
  }
});

test('A8: the receipt states what it does NOT prove', async () => {
  // VERIFIER FINDING A8. The four evidence links reference the tenant, retailer,
  // action kind and endpoint — none references a person. The chain proves a REQUEST
  // arrived, not that a human acted. Saying so is the difference between evidence
  // and a fabricated metric.
  const r = await post('/api/v1/attribution', {
    body: { retailer_id: fixture.live.retailerId, action_kind: 'HANDOFF' },
  });
  const b = await r.json();
  assert.equal(b.truth_contract.consumer_identity_bound, false);
  assert.match(b.truth_contract.does_not_prove, /human consumer/i);
  assert.match(b.truth_contract.proves, /a request arrived/i);
  assert.ok(b.truth_contract.not_claimed.includes('that a human consumer performed this action'));
  assert.match(b.truth_contract.replay_protection, /window/i);
});

test('unknown and malformed actions are refused', async () => {
  for (const kind of ['PURCHASE', 'phone_click', '', 'PHONE_CLICK; DROP TABLE', null, 42]) {
    const r = await post('/api/v1/attribution', {
      body: { retailer_id: fixture.live.retailerId, action_kind: kind },
    });
    assert.equal(r.status, 400, `action_kind ${JSON.stringify(kind)} must be refused`);
    assert.equal((await r.json()).error, 'UNKNOWN_ACTION');
  }
});

test('a malformed body is refused without a stack trace', async () => {
  const r = await post('/api/v1/attribution', { raw: 'not json at all' });
  assert.equal(r.status, 400);
  const b = await r.json();
  assert.equal(b.error, 'MALFORMED_BODY');
  assert.ok(!/at .*\(.*:\d+:\d+\)/.test(JSON.stringify(b)), 'no stack trace may leak');
});

test('a missing retailer_id is refused', async () => {
  const r = await post('/api/v1/attribution', { body: { action_kind: 'PHONE_CLICK' } });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error, 'RETAILER_REQUIRED');
});

test('GET is refused with a clear message', async () => {
  const r = await req('GET', '/api/v1/attribution');
  assert.equal(r.status, 405);
  assert.equal((await r.json()).error, 'METHOD_NOT_ALLOWED');
});

test('every recorded action is chain-linked in the ledger', async () => {
  // The endpoint must not be able to write a row that breaks the hash chain.
  const { PrismaClient } = await import('@prisma/client');
  const db = new PrismaClient();
  const m = await import('../src/lib/demand-credits.mjs');
  const rows = await db.demandCreditEntry.findMany({
    where: { merchantId: fixture.live.retailerId }, orderBy: { seq: 'asc' },
  });
  assert.ok(rows.length > 0, 'the earlier tests must have written rows, else this is vacuous');
  let prev = m.GENESIS_HASH;
  for (const row of rows) {
    assert.equal(row.prevHash, prev, `seq ${row.seq} does not link to its predecessor`);
    assert.equal(m.hashBody(row, prev), row.entryHash, `seq ${row.seq} hash does not recompute`);
    prev = row.entryHash;
  }
  // And the evidence must re-hash to its digest — the pilot depends on this.
  const { createHash } = await import('node:crypto');
  for (const row of rows.filter((r) => r.kind === 'ATTRIBUTION')) {
    const digest = createHash('sha256').update(row.evidenceChain).digest('hex');
    assert.equal(digest, row.evidenceChainSha256, `seq ${row.seq} evidence digest mismatch`);
    const parsed = JSON.parse(row.evidenceChain);
    assert.ok(Array.isArray(parsed) && parsed.length === 4);
    assert.ok(parsed.every((l) => typeof l.step === 'string' && typeof l.ref === 'string'));
  }
  await db.$disconnect();
});
