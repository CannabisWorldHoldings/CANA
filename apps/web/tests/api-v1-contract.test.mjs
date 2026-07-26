import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

/**
 * PUBLIC API v1 — CONTRACT TESTS.
 *
 * These run against the REAL running server over HTTP, not against the handler
 * function. A partner consumes bytes over a socket, so that is what must be
 * verified: status codes, headers, tenant refusal, pagination clamping, and —
 * most importantly — that the truth boundary the UI enforces is enforced here
 * too. An API that publishes records the site itself withholds is how
 * demonstration data reaches a partner's production system.
 */

/**
 * Two traps had to be cleared to test a tenant-scoped endpoint from Node:
 *
 *  1. undici IGNORES a manually supplied Host header, so `headers: { Host }`
 *     silently arrives as 127.0.0.1 and the endpoint correctly answers 421.
 *     Every test failed on a 60s readiness timeout while curl worked fine.
 *  2. `*.localhost` does not resolve in this environment — there is no hosts
 *     entry — so addressing the tenant by URL fails to connect.
 *
 * The fix is a dispatcher with a custom DNS lookup: the URL carries the real
 * tenant hostname (so the Host header is genuine, not spoofed) while the socket
 * connects to loopback. This is what a real client does, minus the DNS.
 */
// undici is not a direct dependency, so use Node's built-in http client, which
// lets the Host header be set explicitly while connecting to loopback.
import http from 'node:http';

const TENANT = 'orderweeddc.localhost';
let server;
let fixture = null;

/**
 * NON-VACUOUS TESTING WITHOUT CORRUPTING THE SEED.
 *
 * Every seeded retailer is demonstration data, so a truth-boundary test would
 * pass trivially against an empty result set — it would assert "none of zero
 * records is demonstration data". My first attempt at fixing that was to
 * promote a seeded DEMONSTRATION_ONLY retailer to VERIFIED_CURRENT, which is
 * precisely the failure this endpoint exists to prevent: fake data relabelled
 * as verified, left behind in the database for anything else to read.
 *
 * Instead the test OWNS its fixture. It creates a distinct verified retailer,
 * wires it into the tenant through the real menu graph (retailer -> menuEntry
 * -> brandMenu -> brand), asserts, and deletes it. The seed is never mutated,
 * and a failing run cannot leave a counterfeit "verified" record behind.
 */
async function createVerifiedFixture() {
  const { PrismaClient } = await import('@prisma/client');
  const db = new PrismaClient();
  const now = new Date();
  const brand = await db.brand.findUnique({ where: { domain: TENANT }, select: { id: true } });
  if (!brand) { await db.$disconnect(); throw new Error(`tenant ${TENANT} is not configured`); }

  const made = [];
  for (const tag of ['a', 'b', 'c']) {
    const retailer = await db.retailer.create({
      data: {
        name: `Contract Fixture ${tag.toUpperCase()}`,
        type: 'DISPENSARY', address: '1 Test Way', city: 'Washington', state: 'DC', zip: '20001',
        lat: 38.9072, lng: -77.0369,
        dataStatus: 'VERIFIED_CURRENT', dataSource: 'contract-test-fixture',
        sourceUrl: 'https://example.invalid/fixture',
        retrievedAt: now, verifiedAt: now,
        freshnessExpiresAt: new Date(now.getTime() + 86400_000),
        confidence: 0.99, isDemonstration: false,
      },
      select: { id: true },
    });
    const product = await db.product.create({
      data: { name: `Fixture Product ${tag}`, category: 'FLOWER' },
      select: { id: true },
    });
    const entry = await db.menuEntry.create({
      data: {
        retailerId: retailer.id, productId: product.id, price: 10,
        dataStatus: 'VERIFIED_CURRENT', isDemonstration: false,
      },
      select: { id: true },
    });
    await db.brandMenu.create({ data: { brandId: brand.id, menuEntryId: entry.id } });
    made.push({ retailerId: retailer.id, productId: product.id });
  }
  await db.$disconnect();
  return made;
}

async function destroyFixture(made) {
  if (!made?.length) return;
  const { PrismaClient } = await import('@prisma/client');
  const db = new PrismaClient();
  // Cascades clear menuEntry and brandMenu rows.
  await db.retailer.deleteMany({ where: { id: { in: made.map((m) => m.retailerId) } } });
  await db.product.deleteMany({ where: { id: { in: made.map((m) => m.productId) } } });
  await db.$disconnect();
}

/** Minimal fetch-shaped GET over node:http so the Host header is honoured. */
function get(path, host = TENANT) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: 3000, path, method: 'GET', headers: { Host: host } },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve({
          status: res.statusCode,
          ok: res.statusCode >= 200 && res.statusCode < 300,
          headers: { get: (k) => res.headers[k.toLowerCase()] ?? null },
          json: async () => JSON.parse(body),
          text: async () => body,
        }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

before(async () => {
  // Reuse an already-running server when present; otherwise start one.
  try {
    const probe = await get('/api/health');
    if (probe.ok) return;
  } catch { /* not running */ }
  server = spawn('npm', ['run', 'start'], { cwd: process.cwd(), stdio: 'ignore', detached: false });
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (Date.now() > deadline) throw new Error('server did not become ready');
    try {
      const r = await get('/api/health');
      if (r.ok) break;
    } catch { /* keep polling */ }
    await new Promise((r) => setTimeout(r, 500));
  }
});

before(async () => {
  fixture = await createVerifiedFixture();
});

after(async () => {
  // Always runs, including after a failed assertion, so no counterfeit
  // "verified" record survives the test run.
  await destroyFixture(fixture);
  if (server) { server.kill('SIGTERM'); await once(server, 'exit').catch(() => {}); }
});

test('returns 200 with the version in body AND header', async () => {
  const r = await get('/api/v1/retailers');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('x-api-version'), 'v1');
  const b = await r.json();
  assert.equal(b.api_version, 'v1');
  assert.ok(Array.isArray(b.data), 'data must be an array');
});

test('an UNKNOWN TENANT is refused, not silently defaulted', async () => {
  // Defaulting would serve one brand's records to another brand's host.
  //
  // The refusal happens in the tenant PROXY, upstream of the route handler, and
  // returns plain text rather than the handler's JSON envelope. That is the
  // correct and stronger behaviour — an unconfigured host never reaches
  // application code at all — so the contract asserts the refusal, not a
  // particular error body. My handler keeps its own UNKNOWN_TENANT branch as
  // defence in depth for any path that bypasses the proxy.
  const r = await get('/api/v1/retailers', 'not-a-configured-host.localhost');
  assert.equal(r.status, 421, 'an unknown tenant must be refused');
  const body = await r.text();
  assert.match(body, /not configured/i);
  assert.ok(!/data|retailer_id|provenance/i.test(body),
    'a refusal must not leak any retailer data');
});

test('TRUTH BOUNDARY: no demonstration record is ever published', async () => {
  const b = await (await get('/api/v1/retailers?pageSize=50')).json();
  // Guard against a vacuous pass: if the endpoint returned nothing, "no
  // demonstration record was published" is true but proves nothing.
  assert.ok(b.data.length > 0, 'fixture records must be published, else this test is vacuous');
  const names = b.data.map((r) => r.name);
  assert.ok(names.some((n) => n.startsWith('Contract Fixture')), 'verified fixtures must appear');
  // The seed is entirely demonstration data; none of it may appear.
  assert.ok(!names.some((n) => n.startsWith('Demo Retailer')),
    'seeded demonstration retailers must be withheld from the public API');
  for (const rec of b.data) {
    assert.equal(rec.provenance.is_demonstration, false,
      `demonstration record ${rec.id} must never reach the API`);
  }
});

test('PROVENANCE travels with every record', async () => {
  const b = await (await get('/api/v1/retailers?pageSize=50')).json();
  assert.ok(b.data.length > 0, 'no records — provenance check would be vacuous');
  for (const rec of b.data) {
    for (const k of ['data_status', 'source', 'retrieved_at', 'verified_at',
                     'freshness_expires_at', 'confidence', 'is_demonstration']) {
      assert.ok(k in rec.provenance, `record ${rec.id} is missing provenance.${k}`);
    }
  }
});

test('ORDERING contract is declared and sponsorship-neutral', async () => {
  const b = await (await get('/api/v1/retailers')).json();
  assert.equal(b.ordering.sponsorship_affects_order, false);
  assert.match(b.ordering.rule, /truth-first/);
  // The payload must not leak a sponsorship field at all.
  const raw = JSON.stringify(b.data);
  assert.ok(!/isSponsored|is_sponsored/i.test(raw),
    'sponsorship state must not appear in the public payload');
});

test('pagination is CLAMPED — a client cannot request the whole table', async () => {
  const b = await (await get('/api/v1/retailers?pageSize=99999')).json();
  assert.ok(b.pagination.page_size <= b.pagination.max_page_size);
  assert.equal(b.pagination.page_size, 50);
  // Garbage falls back rather than throwing.
  const g = await (await get('/api/v1/retailers?pageSize=abc&page=-7')).json();
  assert.equal(g.pagination.page_size, 20);
  assert.equal(g.pagination.page, 1);
});

test('pagination is stable and non-overlapping across pages', async () => {
  const p1 = await (await get('/api/v1/retailers?pageSize=2&page=1')).json();
  const p2 = await (await get('/api/v1/retailers?pageSize=2&page=2')).json();
  const ids1 = p1.data.map((r) => r.id);
  const ids2 = p2.data.map((r) => r.id);
  assert.ok(ids1.length > 0 && ids2.length > 0,
    'both pages must be populated, else overlap cannot be observed');
  for (const id of ids2) {
    assert.ok(!ids1.includes(id), `id ${id} appeared on both pages — unstable ordering`);
  }
});

test('the response is not cached — freshness claims must not be stale', async () => {
  const r = await get('/api/v1/retailers');
  assert.match(r.headers.get('cache-control') ?? '', /no-store/);
});

test('the truth contract explicitly disclaims what it does NOT assert', async () => {
  const b = await (await get('/api/v1/retailers')).json();
  assert.ok(b.truth_contract.not_claimed.includes('ranking position'));
  assert.ok(b.truth_contract.not_claimed.includes('endorsement'));
  assert.equal(b.truth_contract.provenance_included, true);
});
