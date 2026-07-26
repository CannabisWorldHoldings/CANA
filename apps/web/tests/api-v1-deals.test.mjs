import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

/**
 * PUBLIC API v1 — deals CONTRACT TESTS.
 *
 * A deal is a commercial OFFER, not a description, so these tests attack the two
 * independent time boundaries separately: a record can be freshly verified while
 * the offer it describes ended yesterday. The most important fixture here is the
 * VERIFIED deal attached to a DEMONSTRATION retailer — a truth boundary usually
 * leaks across a JOIN, and that is the one case a single-table test cannot catch.
 */

const TENANT = 'orderweeddc.localhost';
let fixture = null;

function req(method, path, host = TENANT) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: 3000, path, method, headers: { Host: host } },
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
      });
    r.on('error', reject);
    r.end();
  });
}
const get = (p, host) => req('GET', p, host);

async function createFixture() {
  const { PrismaClient } = await import('@prisma/client');
  const db = new PrismaClient();
  const now = new Date();
  const brand = await db.brand.findUnique({ where: { domain: TENANT }, select: { id: true } });
  if (!brand) { await db.$disconnect(); throw new Error(`tenant ${TENANT} not configured`); }

  const verified = {
    dataStatus: 'VERIFIED_CURRENT', dataSource: 'deals-contract-test',
    sourceUrl: 'https://example.invalid/deal',
    retrievedAt: now, verifiedAt: now,
    freshnessExpiresAt: new Date(now.getTime() + 86400_000),
    confidence: 0.99, isDemonstration: false,
  };

  const mkRetailer = async (tag, over = {}) => {
    const r = await db.retailer.create({
      data: {
        name: `Deal Fixture ${tag}`, type: 'DISPENSARY', address: `${tag} Deal St`,
        city: 'Washington', state: 'DC', zip: '20001', lat: 38.9, lng: -77.03,
        ...verified, ...over,
      },
      select: { id: true },
    });
    const p = await db.product.create({ data: { name: `Deal Product ${tag}`, category: 'FLOWER' }, select: { id: true } });
    const e = await db.menuEntry.create({
      data: { retailerId: r.id, productId: p.id, price: 15, dataStatus: 'VERIFIED_CURRENT', isDemonstration: false },
      select: { id: true },
    });
    await db.brandMenu.create({ data: { brandId: brand.id, menuEntryId: e.id } });
    return { retailerId: r.id, productId: p.id };
  };

  const liveRetailer = await mkRetailer('LIVE');
  // A retailer that is DEMONSTRATION data but carries a fully VERIFIED deal.
  const demoRetailer = await mkRetailer('DEMORET', {
    dataStatus: 'DEMONSTRATION_ONLY', isDemonstration: true,
  });

  const mkDeal = async (tag, retailerId, over = {}) => (await db.deal.create({
    data: {
      retailerId, title: `Deal ${tag}`, description: `desc ${tag}`,
      discount: '20% off', code: `CODE${tag}`,
      expiryDate: new Date(now.getTime() + 7 * 86400_000), isActive: true,
      ...verified, ...over,
    },
    select: { id: true },
  })).id;

  const dealIds = {
    good: await mkDeal('GOOD', liveRetailer.retailerId),
    expired: await mkDeal('EXPIRED', liveRetailer.retailerId, { expiryDate: new Date(now.getTime() - 86400_000) }),
    inactive: await mkDeal('INACTIVE', liveRetailer.retailerId, { isActive: false }),
    unverified: await mkDeal('UNVERIFIED', liveRetailer.retailerId, { dataStatus: 'AWAITING_VERIFICATION' }),
    stale: await mkDeal('STALE', liveRetailer.retailerId, { freshnessExpiresAt: new Date(now.getTime() - 1000) }),
    demonstration: await mkDeal('DEMO', liveRetailer.retailerId, { isDemonstration: true, dataStatus: 'DEMONSTRATION_ONLY' }),
    // THE JOIN LEAK: a perfectly verified, live, active offer on a DEMONSTRATION retailer.
    onDemoRetailer: await mkDeal('ONDEMO', demoRetailer.retailerId),
    expiringNow: await mkDeal('EXPNOW', liveRetailer.retailerId, { expiryDate: now }),
  };
  await db.$disconnect();
  return { liveRetailer, demoRetailer, dealIds };
}

async function destroyFixture(f) {
  if (!f) return;
  const { PrismaClient } = await import('@prisma/client');
  const db = new PrismaClient();
  const ids = [f.liveRetailer.retailerId, f.demoRetailer.retailerId];
  await db.deal.deleteMany({ where: { retailerId: { in: ids } } });
  await db.retailer.deleteMany({ where: { id: { in: ids } } });
  await db.product.deleteMany({ where: { id: { in: [f.liveRetailer.productId, f.demoRetailer.productId] } } });
  await db.$disconnect();
}

before(async () => {
  for (let i = 0; i < 40; i++) {
    try { const r = await get('/api/health'); if (r.status < 500) break; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  fixture = await createFixture();
});
after(async () => { await destroyFixture(fixture); });

const titles = async () => (await (await get('/api/v1/deals?pageSize=50')).json()).data.map((d) => d.title);

test('returns 200 with the version in body AND header', async () => {
  const r = await get('/api/v1/deals');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('x-api-version'), 'v1');
  const b = await r.json();
  assert.equal(b.api_version, 'v1');
  assert.ok(Array.isArray(b.data));
});

test('a verified, live, active deal IS published', async () => {
  const t = await titles();
  assert.ok(t.includes('Deal GOOD'), 'a genuine offer must be published, else every test below is vacuous');
});

test('BOUNDARY 2: an EXPIRED offer is withheld even though the record is fresh', async () => {
  // The whole reason this endpoint carries two time boundaries.
  const t = await titles();
  assert.ok(!t.includes('Deal EXPIRED'), 'an expired offer must never be published');
});

test('BOUNDARY 2: an offer expiring exactly NOW is treated as expired', async () => {
  const t = await titles();
  assert.ok(!t.includes('Deal EXPNOW'), 'expiry must be exclusive, not inclusive');
});

test('BOUNDARY 2: an INACTIVE offer is withheld', async () => {
  const t = await titles();
  assert.ok(!t.includes('Deal INACTIVE'));
});

test('BOUNDARY 1: an unverified or STALE deal record is withheld', async () => {
  const t = await titles();
  assert.ok(!t.includes('Deal UNVERIFIED'), 'an unverified deal must not be published');
  assert.ok(!t.includes('Deal STALE'), 'a stale deal record must not be published');
});

test('a DEMONSTRATION deal is never published', async () => {
  const t = await titles();
  assert.ok(!t.includes('Deal DEMO'));
});

test('JOIN LEAK: a VERIFIED deal on a DEMONSTRATION retailer is withheld', async () => {
  // The case a single-table test cannot catch, and where truth boundaries
  // usually leak. The deal itself is impeccable; its retailer is not.
  const t = await titles();
  assert.ok(!t.includes('Deal ONDEMO'),
    'verifying the deal alone would leak demonstration retailers through their deals');
});

test('every published record carries provenance for the DEAL and the RETAILER', async () => {
  const b = await (await get('/api/v1/deals?pageSize=50')).json();
  assert.ok(b.data.length > 0, 'no records — this check would be vacuous');
  for (const d of b.data) {
    for (const k of ['data_status', 'source', 'retrieved_at', 'verified_at',
                     'freshness_expires_at', 'confidence', 'is_demonstration']) {
      assert.ok(k in d.provenance, `deal ${d.id} missing provenance.${k}`);
    }
    assert.equal(d.provenance.is_demonstration, false);
    assert.equal(d.retailer.is_demonstration, false, 'a published deal cannot sit on a demonstration retailer');
    assert.equal(d.offer.offer_validity_checked, true);
    assert.ok(new Date(d.offer.expires_at) > new Date(), 'a published offer must be in the future');
  }
});

test('NO discount math is invented', async () => {
  const b = await (await get('/api/v1/deals?pageSize=50')).json();
  const good = b.data.find((d) => d.title === 'Deal GOOD');
  assert.equal(good.discount, '20% off', 'the stored string must pass through verbatim');
  const raw = JSON.stringify(b.data);
  assert.ok(!/savings_amount|computed_saving|you_save|saving_cents/i.test(raw),
    'a computed saving would invent a number nobody verified');
  assert.ok(b.truth_contract.not_claimed.includes('savings amount'));
});

test('ORDERING is declared and sponsorship-neutral', async () => {
  const b = await (await get('/api/v1/deals')).json();
  assert.equal(b.ordering.sponsorship_affects_order, false);
  assert.match(b.ordering.rule, /truth-first/);
  assert.ok(!/isSponsored|is_sponsored/i.test(JSON.stringify(b.data)));
});

test('pagination is CLAMPED and garbage falls back', async () => {
  const big = await (await get('/api/v1/deals?pageSize=99999')).json();
  assert.equal(big.pagination.page_size, 50);
  assert.ok(big.pagination.page_size <= big.pagination.max_page_size);
  const junk = await (await get('/api/v1/deals?pageSize=abc&page=-7')).json();
  assert.equal(junk.pagination.page_size, 20);
  assert.equal(junk.pagination.page, 1);
});

test('an UNKNOWN TENANT is refused and leaks no deal data', async () => {
  const r = await get('/api/v1/deals', 'not-a-configured-host.localhost');
  assert.equal(r.status, 421);
  const body = await r.text();
  assert.ok(!/Deal GOOD|promo_code|CODEGOOD/.test(body), 'a refusal must leak nothing');
});

test('the response is not cached', async () => {
  const r = await get('/api/v1/deals');
  assert.match(r.headers.get('cache-control') ?? '', /no-store/);
});

test('the truth contract names BOTH time boundaries and what is not claimed', async () => {
  const b = await (await get('/api/v1/deals')).json();
  const joined = b.truth_contract.boundaries_applied.join(' ');
  assert.match(joined, /record freshness/);
  assert.match(joined, /offer validity/);
  assert.match(joined, /retailer publishability/);
  assert.match(b.truth_contract.why_two_time_boundaries, /ended yesterday/);
  for (const k of ['ranking position', 'endorsement', 'savings amount']) {
    assert.ok(b.truth_contract.not_claimed.includes(k), `must disclaim ${k}`);
  }
});
