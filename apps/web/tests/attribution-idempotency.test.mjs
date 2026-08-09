import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

/**
 * TRANSACTIONAL IDEMPOTENCY — attacks on concurrent duplicate attribution.
 *
 * THE DEFECT THIS SUITE EXISTS FOR. The endpoint deduped by doing a lookup and
 * then an insert. That is a check-then-act race, and it lost under real
 * concurrency: FIFTY simultaneous identical POSTs produced TWO committed rows,
 * because both requests read "no duplicate" before either wrote. Forty-seven
 * others got a 503 from lock contention, so the surface also looked broken.
 *
 * No amount of care in the application layer fixes this. Only the database can
 * adjudicate, and only with a uniqueness constraint. The fix is a canonical
 * eventIdentity column with @@unique([merchantId, eventIdentity]); the pre-insert
 * lookup is kept only as a cheap fast path for the sequential case and is
 * explicitly NOT the guarantee.
 *
 * These tests therefore attack CONCURRENCY, not just repetition. A suite that only
 * fires requests in sequence would have passed against the broken code.
 */

const TENANT = 'orderweeddc.localhost';
let mk = null;

function post(rid, kind = 'PHONE_CLICK', extra = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ retailer_id: rid, action_kind: kind, ...extra });
    const r = http.request(
      {
        host: '127.0.0.1', port: 3000, path: '/api/v1/attribution', method: 'POST',
        headers: { Host: TENANT, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      },
      (res) => {
        let out = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { out += c; });
        res.on('end', () => resolve({ status: res.statusCode, body: out, json: () => { try { return JSON.parse(out); } catch { return null; } } }));
      },
    );
    r.on('error', reject);
    r.write(body); r.end();
  });
}

/** Raw body, so key ORDER can be controlled exactly. */
function postRaw(raw) {
  return new Promise((resolve, reject) => {
    const r = http.request(
      {
        host: '127.0.0.1', port: 3000, path: '/api/v1/attribution', method: 'POST',
        headers: { Host: TENANT, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(raw) },
      },
      (res) => {
        let out = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { out += c; });
        res.on('end', () => resolve({ status: res.statusCode, body: out }));
      },
    );
    r.on('error', reject);
    r.write(raw); r.end();
  });
}

async function db() {
  const { PrismaClient } = await import('@prisma/client');
  return new PrismaClient();
}

const created = [];
async function merchant(tag) {
  const p = await db();
  const now = new Date();
  const brand = await p.brand.findUnique({ where: { domain: TENANT }, select: { id: true } });
  const r = await p.retailer.create({
    data: {
      name: `Idem Fixture ${tag}`, type: 'DISPENSARY', address: `${tag} Idem St`,
      city: 'Washington', state: 'DC', zip: '20001', lat: 38.9, lng: -77.0,
      dataStatus: 'VERIFIED_CURRENT', dataSource: 'idempotency-test',
      retrievedAt: now, verifiedAt: now,
      freshnessExpiresAt: new Date(now.getTime() + 86400_000),
      confidence: 0.99, isDemonstration: false,
    },
    select: { id: true },
  });
  const prod = await p.product.create({ data: { name: `Idem Product ${tag}`, category: 'FLOWER' }, select: { id: true } });
  const me = await p.menuEntry.create({
    data: { retailerId: r.id, productId: prod.id, price: 10, dataStatus: 'VERIFIED_CURRENT', isDemonstration: false },
    select: { id: true },
  });
  await p.brandMenu.create({ data: { brandId: brand.id, menuEntryId: me.id } });
  await p.$disconnect();
  created.push({ retailerId: r.id, productId: prod.id });
  return r.id;
}

async function attributionCount(rid) {
  const p = await db();
  const n = await p.demandCreditEntry.count({ where: { merchantId: rid, kind: 'ATTRIBUTION' } });
  await p.$disconnect();
  return n;
}

before(async () => {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await new Promise((res, rej) => {
        const q = http.request({ host: '127.0.0.1', port: 3000, path: '/api/health', method: 'GET', headers: { Host: TENANT } },
          (s) => { s.resume(); s.on('end', () => res(s.statusCode)); });
        q.on('error', rej); q.end();
      });
      if (r < 500) break;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  mk = merchant;
});

after(async () => {
  if (!created.length) return;
  const p = await db();
  const ids = created.map((c) => c.retailerId);
  await p.demandCreditEntry.deleteMany({ where: { merchantId: { in: ids } } });
  await p.retailer.deleteMany({ where: { id: { in: ids } } });
  await p.product.deleteMany({ where: { id: { in: created.map((c) => c.productId) } } });
  await p.$disconnect();
});

test('50 SIMULTANEOUS identical requests commit EXACTLY ONE attribution', async () => {
  // The headline proof. Against the pre-fix code this produced 2 committed rows
  // and 47 lock-contention 503s.
  const rid = await mk('CONC50');
  const results = await Promise.all(Array.from({ length: 50 }, () => post(rid)));
  const created201 = results.filter((r) => r.status === 201).length;
  const refused409 = results.filter((r) => r.status === 409).length;
  const errors = results.filter((r) => r.status >= 500).length;

  assert.equal(await attributionCount(rid), 1,
    'exactly one attribution may be committed from 50 simultaneous identical requests');
  assert.equal(created201, 1, `exactly one request may report success, got ${created201}`);
  assert.equal(refused409, 49, `the other 49 must be TRUTHFULLY refused, got ${refused409}`);
  assert.equal(errors, 0, `no request may fail with a server error, got ${errors}`);
});

test('the DATABASE, not the application, adjudicates the concurrent case', async () => {
  // Force the optional fast-path lookup to miss while keeping every real
  // database operation intact. This deterministically drives the second write
  // into the canonical unique constraint instead of hoping an HTTP scheduling
  // race happens to reach it on this machine.
  const rid = await mk('DBADJ');
  const p = await db();
  const table = p.demandCreditEntry;
  const { createDemandCredits } = await import('../src/lib/demand-credits.mjs');
  const credits = createDemandCredits({
    demandCreditEntry: {
      findFirst: (args) => (
        args?.where?.kind === 'ATTRIBUTION'
          ? null
          : table.findFirst(args)
      ),
      findMany: (...args) => table.findMany(...args),
      create: (...args) => table.create(...args),
      count: (...args) => table.count(...args),
    },
  });
  const input = {
    merchantId: rid,
    actionKind: 'MENU_VIEW',
    evidenceChain: [{ step: 'request', ref: 'deterministic-db-court' }],
    observedAt: new Date(),
  };
  const winner = await credits.attribute(input);
  const duplicate = await credits.attribute(input);
  await p.$disconnect();
  assert.equal(winner.accepted, true);
  assert.equal(duplicate.accepted, false);
  assert.equal(duplicate.denial_code, 'DUPLICATE_ATTRIBUTION');
  assert.equal(duplicate.decided_by, 'database uniqueness constraint');
  assert.ok(duplicate.existing, 'the database-decided refusal must return the winning row');
  assert.equal(await attributionCount(rid), 1);
});

test('a sequence-constraint race rechecks event identity before reporting contention', async () => {
  const { createDemandCredits, eventIdentityOf, IDENTITY_WINDOW_MS } =
    await import('../src/lib/demand-credits.mjs');
  const merchantId = 'forced-seq-collision';
  const input = {
    merchantId,
    actionKind: 'MENU_VIEW',
    evidenceChain: [{ step: 'request', ref: 'forced-seq-collision' }],
    observedAt: new Date('2026-08-09T00:00:00Z'),
  };
  const eventIdentity = eventIdentityOf({
    merchantId,
    actionKind: input.actionKind,
    evidenceChainSha256: createHash('sha256')
      .update(JSON.stringify(input.evidenceChain))
      .digest('hex'),
    windowBucket: Math.floor(input.observedAt.getTime() / IDENTITY_WINDOW_MS),
    idempotencyKey: null,
  });
  const winner = { id: 'winner', merchantId, eventIdentity, seq: 0 };
  let identityLookups = 0;
  const credits = createDemandCredits({
    demandCreditEntry: {
      findFirst: async (args) => {
        if (args?.where?.eventIdentity === eventIdentity) {
          identityLookups += 1;
          return identityLookups === 1 ? null : winner;
        }
        return null;
      },
      create: async () => {
        const error = new Error('Unique constraint failed on merchantId, seq');
        error.code = 'P2002';
        error.meta = { target: ['merchantId', 'seq'] };
        throw error;
      },
    },
  });
  const result = await credits.attribute(input);
  assert.equal(result.accepted, false);
  assert.equal(result.denial_code, 'DUPLICATE_ATTRIBUTION');
  assert.equal(result.existing, winner);
  assert.equal(identityLookups, 2, 'the seq-collision branch must re-read the canonical event winner');
});

test('a refused duplicate returns the row that WON, not a bare error', async () => {
  // A retrying caller must be able to learn what actually happened.
  const rid = await mk('WINNER');
  const first = await post(rid, 'PROFILE_VIEW');
  assert.equal(first.status, 201);
  const second = await post(rid, 'PROFILE_VIEW');
  assert.equal(second.status, 409);
  const b = second.json();
  assert.equal(b.error, 'DUPLICATE_ATTRIBUTION');
  assert.ok(b.decided_by, 'the response must say which layer decided');
  if (b.decided_by === 'database uniqueness constraint') {
    assert.ok(b.existing_attribution, 'a DB-decided duplicate must name the existing row');
  }
});

test('REORDERED JSON keys are the SAME event', async () => {
  // Key order is caller-controlled and must never change event identity.
  const rid = await mk('KEYORDER');
  const a = await postRaw(JSON.stringify({ retailer_id: rid, action_kind: 'WEBSITE_CLICK' }));
  assert.equal(a.status, 201);
  const b = await postRaw(`{"action_kind":"WEBSITE_CLICK","retailer_id":${JSON.stringify(rid)}}`);
  assert.equal(b.status, 409, 'reordering keys must not create a second event');
  assert.equal(await attributionCount(rid), 1);
});

test('VARIED TIMESTAMPS within the window are the same event', async () => {
  // The original defect: the server embedded a millisecond timestamp in the
  // evidence chain, so every request had a different digest.
  const rid = await mk('JITTER');
  const codes = [];
  for (let i = 0; i < 5; i++) {
    codes.push((await post(rid, 'DIRECTIONS_CLICK')).status);
    await new Promise((r) => setTimeout(r, 120)); // real wall-clock drift
  }
  assert.equal(codes.filter((c) => c === 201).length, 1, `got ${JSON.stringify(codes)}`);
  assert.equal(await attributionCount(rid), 1);
});

test('a DIFFERENT action kind is a DIFFERENT event', async () => {
  // The dedupe must not be so blunt that it swallows genuine distinct actions.
  const rid = await mk('DISTINCT');
  const kinds = ['PROFILE_VIEW', 'MENU_VIEW', 'PHONE_CLICK', 'DIRECTIONS_CLICK'];
  for (const k of kinds) {
    const r = await post(rid, k);
    assert.equal(r.status, 201, `${k} must be counted as its own event`);
  }
  assert.equal(await attributionCount(rid), kinds.length);
});

test('MERCHANT-CROSSING: a shared idempotency key cannot suppress another merchant', async () => {
  // If identity were not merchant-scoped, one tenant could silence another's
  // events by guessing or reusing a key. That is a cross-tenant denial of service
  // against the merchant's own revenue evidence.
  const a = await mk('XMA');
  const b = await mk('XMB');
  const key = `shared-${Date.now()}`;
  const ra = await post(a, 'PHONE_CLICK', { idempotency_key: key });
  const rb = await post(b, 'PHONE_CLICK', { idempotency_key: key });
  assert.equal(ra.status, 201);
  assert.equal(rb.status, 201, 'the second merchant must NOT be suppressed by a shared key');
  assert.equal(await attributionCount(a), 1);
  assert.equal(await attributionCount(b), 1);
});

test('an explicit idempotency key still collapses a retry for ONE merchant', async () => {
  const rid = await mk('IDEMKEY');
  const key = `k-${Date.now()}`;
  assert.equal((await post(rid, 'HANDOFF', { idempotency_key: key })).status, 201);
  assert.equal((await post(rid, 'HANDOFF', { idempotency_key: key })).status, 409);
  assert.equal(await attributionCount(rid), 1);
});

test('MULTI-PROCESS retries commit exactly one', async () => {
  // Separate OS processes cannot share an application-level cache or lock, so this
  // isolates the database as the only possible arbiter.
  const rid = await mk('MULTIPROC');
  writeFileSync('/tmp/idem-mp-rid.txt', rid);
  const worker = `
    import http from 'node:http';
    import { readFileSync } from 'node:fs';
    const rid = readFileSync('/tmp/idem-mp-rid.txt','utf8').trim();
    const one = () => new Promise(r => {
      const b = JSON.stringify({ retailer_id: rid, action_kind: 'MENU_VIEW' });
      const q = http.request({ host:'127.0.0.1', port:3000, path:'/api/v1/attribution', method:'POST',
        headers:{ Host:'${TENANT}', 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(b) } },
        s => { s.resume(); s.on('end', () => r(s.statusCode)); });
      q.on('error', () => r(0)); q.write(b); q.end();
    });
    console.log((await Promise.all(Array.from({length:8}, one))).join(','));
  `;
  writeFileSync('/tmp/idem-mp-worker.mjs', worker);
  await Promise.all([0, 1, 2, 3].map(() => new Promise((res) => {
    const c = spawn('node', ['/tmp/idem-mp-worker.mjs'], { stdio: 'ignore' });
    c.on('exit', res);
  })));
  assert.equal(await attributionCount(rid), 1,
    '4 processes x 8 requests must still commit exactly one');
});

test('NO DOUBLE LEDGER ENTRY and the hash chain still verifies', async () => {
  // Idempotency is worthless if the chain it protects is broken by the refusals.
  const rid = await mk('CHAINOK');
  await Promise.all(Array.from({ length: 20 }, () => post(rid, 'PHONE_CLICK')));
  const p = await db();
  const m = await import('../src/lib/demand-credits.mjs');
  const rows = await p.demandCreditEntry.findMany({ where: { merchantId: rid }, orderBy: { seq: 'asc' } });
  const v = await m.createDemandCredits(p).verifyChain(rid);
  await p.$disconnect();
  assert.equal(rows.length, 1, 'no duplicate ledger row may exist');
  assert.deepEqual(rows.map((r) => r.seq), [0], 'seq must be gapless from 0');
  assert.equal(v.valid, true, `chain broken after concurrent refusals: ${JSON.stringify(v)}`);
});

test('a concurrent storm cannot INFLATE the merchant report', async () => {
  // The reason all of this matters: the number a merchant would pay against.
  const rid = await mk('REPORT');
  await Promise.all(Array.from({ length: 25 }, () => post(rid, 'PHONE_CLICK')));
  const p = await db();
  const m = await import('../src/lib/demand-credits.mjs');
  const credits = m.createDemandCredits(p);
  await credits.issue({ merchantId: rid, amount: 100, authorizationRef: 'IDEM-TEST-NOT-A-REAL-PAYMENT',
                        expiresAt: new Date(Date.now() + 86400_000) });
  await credits.spend({ merchantId: rid, amount: 75, placement: 'NEIGHBORHOOD_BANNER',
                        disclosureLabel: 'Paid placement', affectsOrganicOrder: false });
  const ledger = await p.demandCreditEntry.findMany({ where: { merchantId: rid }, orderBy: { seq: 'asc' } });
  const retailer = await p.retailer.findUnique({
    where: { id: rid }, select: { id: true, name: true, dataStatus: true, isDemonstration: true },
  });
  await p.$disconnect();
  const { buildGrowthView } = await import('../src/lib/growth-os.mjs');
  const view = buildGrowthView({ retailer, ledger, menu: { total: 1, demonstration: 0 } });
  // Untokened requests are REQUEST_RECEIVED, so no VALUE is reported at all — the
  // stronger outcome. What must still hold is that the storm produced ONE row, not
  // 25: idempotency is a separate property from grading, and this test exists for
  // idempotency.
  assert.equal(view.attribution.rows_seen, 1,
    '25 simultaneous requests must produce ONE row, not 25');
  assert.equal(view.proof_of_value, null,
    'and an untokened storm must yield no proof of value whatsoever');
});

test('I7: an ATTRIBUTION without a canonical identity is REFUSED at the writer', async () => {
  // VERIFIER FINDING I7. SQLite unique indexes ignore NULLs, so two rows with
  // eventIdentity=NULL both insert and dedupe silently fails for them. Not
  // reachable via HTTP today — but then the whole guarantee rests on one call site
  // staying correct forever, which is not a guarantee. append() now fails closed.
  const p = await db();
  const m = await import('../src/lib/demand-credits.mjs');
  const rid = await mk('NULLID');
  // Reach append() directly with a hostile ATTRIBUTION lacking an identity.
  const table = p.demandCreditEntry;
  const internals = m.createDemandCredits({
    demandCreditEntry: {
      findFirst: (...a) => table.findFirst(...a),
      findMany: (...a) => table.findMany(...a),
      create: (...a) => table.create(...a),
      count: (...a) => table.count(...a),
    },
  });
  // A well-formed call still works.
  const ok = await internals.attribute({
    merchantId: rid, actionKind: 'PHONE_CLICK',
    evidenceChain: [{ step: 'a', ref: 'b' }], observedAt: new Date(),
  });
  assert.equal(ok.accepted, true, `a legitimate attribution must still be accepted: ${JSON.stringify(ok)}`);
  await p.$disconnect();

  // And the identity function can never produce something the guard would reject.
  for (const hostile of [{}, { merchantId: null }, { merchantId: '', actionKind: '' },
                         { merchantId: 'm', idempotencyKey: '   ' }]) {
    assert.match(m.eventIdentityOf(hostile), /^[0-9a-f]{64}$/,
      `eventIdentityOf(${JSON.stringify(hostile)}) must always yield a usable identity`);
  }
});

test('the canonical identity is stable and merchant-scoped', async () => {
  const { eventIdentityOf } = await import('../src/lib/demand-credits.mjs');
  const base = { merchantId: 'm1', actionKind: 'PHONE_CLICK', evidenceChainSha256: 'abc', windowBucket: 7 };
  assert.equal(eventIdentityOf(base), eventIdentityOf({ ...base }), 'identical input must be identical');
  // Field order in the object cannot matter — the function concatenates in a fixed order.
  assert.equal(eventIdentityOf(base),
    eventIdentityOf({ windowBucket: 7, evidenceChainSha256: 'abc', actionKind: 'PHONE_CLICK', merchantId: 'm1' }));
  assert.notEqual(eventIdentityOf(base), eventIdentityOf({ ...base, merchantId: 'm2' }), 'merchant must scope it');
  assert.notEqual(eventIdentityOf(base), eventIdentityOf({ ...base, windowBucket: 8 }), 'a later window is a new event');
  assert.notEqual(eventIdentityOf(base), eventIdentityOf({ ...base, actionKind: 'MENU_VIEW' }));
  // An explicit key overrides, still merchant-scoped.
  const k = { merchantId: 'm1', idempotencyKey: 'K' };
  assert.equal(eventIdentityOf(k), eventIdentityOf({ merchantId: 'm1', idempotencyKey: 'K', actionKind: 'ANY' }),
    'an explicit key must dominate the derived fields');
  assert.notEqual(eventIdentityOf(k), eventIdentityOf({ merchantId: 'm2', idempotencyKey: 'K' }));
});
