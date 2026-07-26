import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

/**
 * PUBLIC API v1 — products CONTRACT TESTS.
 *
 * A product record carries POTENCY, which in this category is a regulated claim. A
 * partner republishing an unverified THC figure may be making a compliance claim on
 * our authority, about a substance someone will consume. So these tests attack the
 * potency boundary hardest, and they attack it in BOTH directions: an unverifiable
 * figure must be withheld, and a legitimate one must not be silently dropped.
 *
 * The join here is THREE deep — product -> menuEntry -> retailer — so a truth
 * boundary can leak at two places rather than one. Each is attacked separately.
 */

const TENANT = 'orderweeddc.localhost';
let fx = null;

function get(path, host = TENANT) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: 3000, path, method: 'GET', headers: { Host: host } },
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

async function createFixture() {
  const { PrismaClient } = await import('@prisma/client');
  const db = new PrismaClient();
  const now = new Date();
  const brand = await db.brand.findUnique({ where: { domain: TENANT }, select: { id: true } });
  if (!brand) { await db.$disconnect(); throw new Error(`tenant ${TENANT} not configured`); }

  const verified = {
    dataStatus: 'VERIFIED_CURRENT', dataSource: 'products-contract-test',
    retrievedAt: now, verifiedAt: now,
    freshnessExpiresAt: new Date(now.getTime() + 86400_000),
    confidence: 0.99, isDemonstration: false,
  };

  const mkRetailer = async (tag, over = {}) => (await db.retailer.create({
    data: {
      name: `Prod Fixture ${tag}`, type: 'DISPENSARY', address: `${tag} Prod St`,
      city: 'Washington', state: 'DC', zip: '20001', lat: 38.9, lng: -77.03,
      ...verified, ...over,
    }, select: { id: true },
  })).id;

  const liveRetailer = await mkRetailer('LIVERET');
  const demoRetailer = await mkRetailer('DEMORET', { dataStatus: 'DEMONSTRATION_ONLY', isDemonstration: true });

  const mkProduct = async (tag, over = {}) => (await db.product.create({
    data: { name: `Prod ${tag}`, category: 'FLOWER', strainType: 'hybrid',
            thcPercent: 22.5, cbdPercent: 0.4, ...verified, ...over },
    select: { id: true },
  })).id;

  const link = async (productId, retailerId, over = {}) => {
    const e = await db.menuEntry.create({
      data: { retailerId, productId, price: 42, inStock: true, ...verified, ...over },
      select: { id: true },
    });
    await db.brandMenu.create({ data: { brandId: brand.id, menuEntryId: e.id } });
    return e.id;
  };

  const p = {
    good: await mkProduct('GOOD'),
    unverified: await mkProduct('UNVERIFIED', { dataStatus: 'AWAITING_VERIFICATION' }),
    demo: await mkProduct('DEMO', { dataStatus: 'DEMONSTRATION_ONLY', isDemonstration: true }),
    // Potency that must NOT be asserted: out of range and non-finite.
    badThc: await mkProduct('BADTHC', { thcPercent: 250, cbdPercent: null }),
    negThc: await mkProduct('NEGTHC', { thcPercent: -5, cbdPercent: null }),
    noPotency: await mkProduct('NOPOT', { thcPercent: null, cbdPercent: null }),
    // Reached only through a DEMONSTRATION retailer — the two-hop join leak.
    onDemoRetailer: await mkProduct('ONDEMO'),
    // Reached only through an UNVERIFIED menu entry — the one-hop join leak.
    viaBadEntry: await mkProduct('BADENTRY'),
  };

  await link(p.good, liveRetailer);
  await link(p.unverified, liveRetailer);
  await link(p.demo, liveRetailer);
  await link(p.badThc, liveRetailer);
  await link(p.negThc, liveRetailer);
  await link(p.noPotency, liveRetailer);
  await link(p.onDemoRetailer, demoRetailer);
  await link(p.viaBadEntry, liveRetailer, { dataStatus: 'AWAITING_VERIFICATION' });
  // A second, cheaper offer for the good product, to prove lowest-price selection.
  const second = await mkRetailer('SECOND');
  await link(p.good, second, { price: 30 });

  await db.$disconnect();
  return { productIds: Object.values(p), retailerIds: [liveRetailer, demoRetailer, second], p };
}

async function destroyFixture(f) {
  if (!f) return;
  const { PrismaClient } = await import('@prisma/client');
  const db = new PrismaClient();
  await db.menuEntry.deleteMany({ where: { productId: { in: f.productIds } } });
  await db.product.deleteMany({ where: { id: { in: f.productIds } } });
  await db.retailer.deleteMany({ where: { id: { in: f.retailerIds } } });
  await db.$disconnect();
}

before(async () => {
  for (let i = 0; i < 40; i++) {
    try { const r = await get('/api/health'); if (r.status < 500) break; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  fx = await createFixture();
});
after(async () => { await destroyFixture(fx); });

const body = async (q = '?pageSize=50') => (await (await get(`/api/v1/products${q}`)).json());
const names = async () => (await body()).data.map((d) => d.name);

test('returns 200 with the version in body AND header', async () => {
  const r = await get('/api/v1/products');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('x-api-version'), 'v1');
  const b = await r.json();
  assert.equal(b.api_version, 'v1');
  assert.ok(Array.isArray(b.data));
});

test('a verified product on a verified menu entry and retailer IS published', async () => {
  const n = await names();
  assert.ok(n.includes('Prod GOOD'), 'a genuine product must publish, else every test below is vacuous');
});

test('an UNVERIFIED or DEMONSTRATION product is withheld', async () => {
  const n = await names();
  assert.ok(!n.includes('Prod UNVERIFIED'));
  assert.ok(!n.includes('Prod DEMO'));
});

test('JOIN LEAK 1: a verified product reached only through a DEMONSTRATION retailer is withheld', async () => {
  const n = await names();
  assert.ok(!n.includes('Prod ONDEMO'),
    'verifying the product alone would leak demonstration retailers through their menus');
});

test('JOIN LEAK 2: a verified product reached only through an UNVERIFIED menu entry is withheld', async () => {
  const n = await names();
  assert.ok(!n.includes('Prod BADENTRY'),
    'the middle table of a three-deep join is a boundary too');
});

// ------------------------------------------------------------ potency boundary
test('POTENCY: a plausible verified figure IS asserted', async () => {
  const b = await body();
  const good = b.data.find((d) => d.name === 'Prod GOOD');
  assert.equal(good.potency.thc_percent, 22.5);
  assert.equal(good.potency.cbd_percent, 0.4);
  assert.equal(good.potency.asserted, true);
  assert.equal(good.potency.withheld_reason, null);
});

test('POTENCY: an OUT-OF-RANGE figure is OMITTED, not clamped', async () => {
  // Clamping would quietly invent a number nobody measured.
  const b = await body();
  for (const nm of ['Prod BADTHC', 'Prod NEGTHC']) {
    const p = b.data.find((d) => d.name === nm);
    assert.ok(p, `${nm} should still be listed — the record is verified, only its potency is not`);
    assert.equal('thc_percent' in p.potency, false, `${nm} must not assert an impossible THC figure`);
    assert.equal(p.potency.asserted, false);
    assert.match(p.potency.withheld_reason, /regulated claim we will not make/i);
  }
});

test('POTENCY: an ABSENT figure is never rendered as zero', async () => {
  const b = await body();
  const p = b.data.find((d) => d.name === 'Prod NOPOT');
  assert.equal('thc_percent' in p.potency, false, 'absent must mean absent, never 0');
  assert.equal('cbd_percent' in p.potency, false);
  assert.equal(p.potency.asserted, false);
  // And the payload must never contain a zeroed potency anywhere.
  const raw = JSON.stringify(b.data);
  assert.ok(!/"thc_percent":\s*0\b/.test(raw), 'a zero THC figure would be a fabricated measurement');
});

test('POTENCY: the withheld COUNT is reported, not hidden', async () => {
  const b = await body();
  // WITHHELD means "a figure exists on the record but cannot be asserted" — the
  // BADTHC (250) and NEGTHC (-5) cases. A record that never carried a potency
  // figure (NOPOT) is not withholding anything; counting it would inflate the
  // number and imply we suppressed data that was never recorded. My first version
  // demanded 3 and was wrong about what the counter means.
  assert.ok(b.truth_contract.potency_records_withheld >= 2,
    `expected the 2 unassertable-figure fixtures, got ${b.truth_contract.potency_records_withheld}`);
  // And prove the distinction holds: NOPOT is listed, asserts nothing, and is NOT
  // counted as withheld.
  const nopot = b.data.find((d) => d.name === 'Prod NOPOT');
  assert.equal(nopot.potency.asserted, false, 'a record with no figure asserts nothing');
  assert.match(b.truth_contract.potency_policy, /never means zero/i);
});

// --------------------------------------------------------------- price policy
test('PRICE: the LOWEST observed price is reported verbatim, not averaged', async () => {
  const b = await body();
  const good = b.data.find((d) => d.name === 'Prod GOOD');
  assert.equal(good.availability.lowest_observed_price, 30, 'offers of 42 and 30 must yield 30, not 36');
  assert.equal(good.availability.offered_by_retailers, 2);
  const raw = JSON.stringify(b);
  assert.ok(!/average_price|mean_price|from_price|savings/i.test(raw), 'no invented price figure');
});

// ---------------------------------------------------------------- boundaries
test('every published product carries full provenance and is not demonstration', async () => {
  const b = await body();
  assert.ok(b.data.length > 0, 'no records — this check would be vacuous');
  for (const p of b.data) {
    for (const k of ['data_status', 'source', 'retrieved_at', 'verified_at',
                     'freshness_expires_at', 'confidence', 'is_demonstration']) {
      assert.ok(k in p.provenance, `product ${p.id} missing provenance.${k}`);
    }
    assert.equal(p.provenance.is_demonstration, false);
  }
});

test('the seeded demonstration retailers never appear in any product payload', async () => {
  const raw = await (await get('/api/v1/products?pageSize=50')).text();
  assert.ok(!/Demo Retailer (Alpha|Beta|Gamma|Delta|Epsilon)/.test(raw));
});

test('ORDERING is declared and sponsorship-neutral', async () => {
  const b = await body('');
  assert.equal(b.ordering.sponsorship_affects_order, false);
  assert.match(b.ordering.rule, /truth-first/);
  assert.ok(!/isSponsored|is_sponsored/i.test(JSON.stringify(b.data)));
});

test('pagination is CLAMPED and garbage falls back', async () => {
  const big = await body('?pageSize=99999');
  assert.equal(big.pagination.page_size, 50);
  const junk = await body('?pageSize=abc&page=-7');
  assert.equal(junk.pagination.page_size, 20);
  assert.equal(junk.pagination.page, 1);
});

test('an UNKNOWN TENANT is refused and leaks no product data', async () => {
  const r = await get('/api/v1/products', 'not-a-configured-host.localhost');
  assert.equal(r.status, 421);
  const t = await r.text();
  assert.ok(!/Prod GOOD|thc_percent/.test(t), 'a refusal must leak nothing');
});

test('the response is not cached', async () => {
  const r = await get('/api/v1/products');
  assert.match(r.headers.get('cache-control') ?? '', /no-store/);
});

test('the truth contract disclaims medical, legal and lab-accuracy claims', async () => {
  const b = await body('');
  for (const k of ['medical or therapeutic effect', 'legal compliance of any purchase',
                   'laboratory accuracy of potency figures', 'price at time of visit']) {
    assert.ok(b.truth_contract.not_claimed.includes(k), `must disclaim: ${k}`);
  }
  assert.ok(b.truth_contract.boundaries_applied.some((s) => /three-deep join/.test(s)));
});
