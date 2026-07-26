import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

/**
 * PUBLIC API v1 — neighborhoods CONTRACT TESTS.
 *
 * A neighborhood payload is an AGGREGATE: "N dispensaries in Petworth" is a
 * claim built from many records at once, and unlike a record payload there is
 * no per-row provenance a consumer could inspect to catch a lie — a bad input
 * disappears into the arithmetic. So these tests attack the count in BOTH
 * directions with the same fixture set:
 *
 *   - a demonstration, counterfeit-verified, unverified, stale, unlinked, or
 *     other-tenant retailer must NOT inflate the count, and
 *   - every legitimately publishable retailer must be counted, through BOTH
 *     geographic membership paths (ZIP list, coordinate window) — a silently
 *     dropped record is the same defect pointed the other way.
 *
 * Both directions are asserted as a DELTA against a baseline captured before
 * the fixtures exist, so the suite is immune to seeded data and to fixtures
 * other concurrently-running suites create (verified: no other suite places
 * records in the Petworth window — sibling fixtures sit at lat 38.90, below
 * Petworth's 38.902 window floor, and none uses ZIP 20011 or 20008).
 *
 * The third attack is on WITHHELD-versus-ZERO: past the verification cap the
 * endpoint must refuse to assert a number at all. A zero reads as "we measured
 * and found none"; withheld reads as "we cannot claim this". Publishing either
 * one in the other's place is a fabricated measurement.
 */

const TENANT = 'orderweeddc.localhost';
const OTHER_TENANT = 'deals.localhost';
const TAG = 'neighborhoods-contract-test';

// Petworth & Brightwood: ZIP 20011, center 38.942 / -77.023, window ±0.04 lat,
// ±0.05 lng. Chosen as the assertion target because no other suite's fixtures
// fall inside it, so exact-delta assertions cannot race a concurrent test file.
const TARGET = 'petworth-brightwood';
// Woodley Park: cap-overflow target. Sibling fixtures at (38.90, -77.03) also
// land in this window, which is harmless here — they can only push the
// candidate set FURTHER past the cap, and the assertion is "withheld".
const CAP_TARGET = 'woodley-park';
const CAP = 200;

let fx = null;
let baseline = null;       // TARGET aggregate for TENANT before fixtures
let otherBaseline = null;  // TARGET aggregate for OTHER_TENANT before fixtures

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

const body = async (q = '?pageSize=50', host = TENANT) => (await (await get(`/api/v1/neighborhoods${q}`, host)).json());
const nb = (b, slug) => b.data.find((n) => n.slug === slug);

async function createFixture() {
  const { PrismaClient } = await import('@prisma/client');
  const db = new PrismaClient();
  const now = new Date();
  const brand = await db.brand.findUnique({ where: { domain: TENANT }, select: { id: true } });
  const otherBrand = await db.brand.findUnique({ where: { domain: OTHER_TENANT }, select: { id: true } });
  if (!brand || !otherBrand) { await db.$disconnect(); throw new Error('tenants not configured'); }

  const verified = {
    dataStatus: 'VERIFIED_CURRENT', dataSource: TAG,
    sourceUrl: 'https://example.invalid/neighborhood',
    retrievedAt: now, verifiedAt: now,
    freshnessExpiresAt: new Date(now.getTime() + 86400_000),
    confidence: 0.99, isDemonstration: false,
  };

  const mkRetailer = async (tag, geo, over = {}) => (await db.retailer.create({
    data: {
      name: `Neighborhood Fixture ${tag}`, type: 'DISPENSARY',
      address: `${tag} Fixture Ave`, city: 'Washington', state: 'DC',
      ...geo, ...verified, ...over,
    }, select: { id: true },
  })).id;

  // One deliberately-unverified product carries every menu link, so nothing
  // this suite creates can ever publish on /api/v1/products.
  const product = await db.product.create({
    data: { name: 'Neighborhood Fixture Product', category: 'FLOWER', dataSource: TAG },
    select: { id: true },
  });
  const link = async (retailerId, brandId = brand.id) => {
    const e = await db.menuEntry.create({
      data: { retailerId, productId: product.id, price: 10, dataSource: TAG },
      select: { id: true },
    });
    await db.brandMenu.create({ data: { brandId, menuEntryId: e.id } });
  };

  // ---- Petworth window fixtures. Exactly THREE must count, one per
  // membership path (both, ZIP-only, coordinates-only).
  const inBoth = await mkRetailer('IN-BOTH', { zip: '20011', lat: 38.942, lng: -77.023 });
  // ZIP matches; coordinates sit outside EVERY configured window (lat 38.80 is
  // below every window floor), so only the ZIP branch can include it.
  const inZipOnly = await mkRetailer('IN-ZIP-ONLY', { zip: '20011', lat: 38.80, lng: -76.88 });
  // No ZIP at all; only the coordinate window can include it. A publishable
  // record must not be dropped just because one membership path is empty.
  const inCoordsOnly = await mkRetailer('IN-COORDS-ONLY', { zip: null, lat: 38.945, lng: -77.02 });

  // ---- The attack set: each sits squarely in the window and must contribute
  // NOTHING to the count.
  const demo = await mkRetailer('DEMO', { zip: '20011', lat: 38.943, lng: -77.024 },
    { dataStatus: 'DEMONSTRATION_ONLY', isDemonstration: true });
  // The counterfeit: a legacy dataStatus of VERIFIED_CURRENT on a record still
  // flagged demonstration. resolveDataStatus() demotes it; so must the count.
  const counterfeit = await mkRetailer('COUNTERFEIT', { zip: '20011', lat: 38.944, lng: -77.025 },
    { dataStatus: 'VERIFIED_CURRENT', isDemonstration: true });
  const unverified = await mkRetailer('UNVERIFIED', { zip: '20011', lat: 38.941, lng: -77.022 },
    { dataStatus: 'AWAITING_VERIFICATION' });
  const stale = await mkRetailer('STALE', { zip: '20011', lat: 38.940, lng: -77.021 },
    { freshnessExpiresAt: new Date(now.getTime() - 1000) });
  // Verified and in-window but reachable through NO tenant menu graph.
  const noLink = await mkRetailer('NOLINK', { zip: '20011', lat: 38.946, lng: -77.026 });
  // Verified and in-window but linked ONLY to the other tenant.
  const otherTenantOnly = await mkRetailer('OTHERBRAND', { zip: '20011', lat: 38.947, lng: -77.027 });
  // Verified but geographically outside every window and ZIP list.
  const outside = await mkRetailer('OUTSIDE', { zip: '20005', lat: 38.80, lng: -76.88 });

  for (const id of [inBoth, inZipOnly, inCoordsOnly, demo, counterfeit, unverified, stale, outside]) {
    await link(id);
  }
  await link(otherTenantOnly, otherBrand.id);
  // noLink gets no link, deliberately.

  // ---- Cap overflow: CAP+1 verified, tenant-linked retailers in the Woodley
  // window at (38.955, -77.09) — inside Woodley (and Adams Morgan), OUTSIDE
  // Petworth (lng -77.09 is past Petworth's -77.073 floor), so the exact-delta
  // assertions above stay untouched. verifiedAt sits 6h in the past so these
  // sort BEHIND other suites' fresh fixtures on every verifiedAt-desc surface
  // and cannot push a sibling's fixture off its first page.
  const capVerified = {
    ...verified,
    verifiedAt: new Date(now.getTime() - 6 * 3600_000),
    freshnessExpiresAt: new Date(now.getTime() + 18 * 3600_000),
  };
  await db.retailer.createMany({
    data: Array.from({ length: CAP + 1 }, (_, i) => ({
      name: `Neighborhood Cap Fixture ${String(i).padStart(3, '0')}`, type: 'DISPENSARY',
      address: `${i} Cap St`, city: 'Washington', state: 'DC',
      zip: '20008', lat: 38.955, lng: -77.09, ...capVerified,
    })),
  });
  const capRetailers = await db.retailer.findMany({
    where: { dataSource: TAG, zip: '20008' }, select: { id: true },
  });
  await db.menuEntry.createMany({
    data: capRetailers.map((r) => ({ retailerId: r.id, productId: product.id, price: 10, dataSource: TAG })),
  });
  const capEntries = await db.menuEntry.findMany({
    where: { dataSource: TAG, retailerId: { in: capRetailers.map((r) => r.id) } },
    select: { id: true },
  });
  await db.brandMenu.createMany({
    data: capEntries.map((e) => ({ brandId: brand.id, menuEntryId: e.id })),
  });

  await db.$disconnect();
  return { productId: product.id };
}

/**
 * Teardown deletes by the suite's dataSource TAG rather than by remembered ids,
 * so it cleans up fully even when creation failed partway (and sweeps any
 * leftovers from a previous killed run). Order: brandMenu -> menuEntry ->
 * retailer -> product, innermost join first.
 */
async function destroyFixture() {
  const { PrismaClient } = await import('@prisma/client');
  const db = new PrismaClient();
  await db.brandMenu.deleteMany({ where: { menuEntry: { dataSource: TAG } } });
  await db.menuEntry.deleteMany({ where: { dataSource: TAG } });
  await db.retailer.deleteMany({ where: { dataSource: TAG } });
  await db.product.deleteMany({ where: { dataSource: TAG } });
  await db.$disconnect();
}

before(async () => {
  for (let i = 0; i < 40; i++) {
    try { const r = await get('/api/health'); if (r.status < 500) break; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  // Baselines FIRST, fixtures second: every count assertion is a delta.
  const b = await body();
  baseline = nb(b, TARGET)?.aggregate;
  assert.ok(baseline, `neighborhood "${TARGET}" must exist before fixtures — is the route deployed?`);
  assert.equal(baseline.asserted, true,
    `baseline count for "${TARGET}" is withheld — the delta assertions below would be meaningless`);
  const ob = await body('?pageSize=50', OTHER_TENANT);
  otherBaseline = nb(ob, TARGET)?.aggregate;
  assert.ok(otherBaseline?.asserted, 'other-tenant baseline must be measurable');
  fx = await createFixture();
});
after(async () => { await destroyFixture(); });

test('returns 200 with the version in body AND header', async () => {
  const r = await get('/api/v1/neighborhoods');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('x-api-version'), 'v1');
  const b = await r.json();
  assert.equal(b.api_version, 'v1');
  assert.ok(Array.isArray(b.data));
});

test('every legitimately publishable retailer IS counted — through BOTH membership paths', async () => {
  // The not-silently-dropped direction. Three verified fixtures sit in the
  // window: one matches ZIP and coordinates, one matches ZIP only (its
  // coordinates are outside every window), one matches coordinates only (it
  // has no ZIP at all). All three must be in the total, else the count
  // understates and every "nothing inflated it" test below is vacuous.
  const agg = nb(await body(), TARGET).aggregate;
  assert.equal(agg.asserted, true);
  assert.ok(agg.retailer_count >= baseline.retailer_count + 3,
    `expected at least baseline(${baseline.retailer_count}) + 3 counted fixtures, got ${agg.retailer_count} — a publishable record was silently dropped from the aggregate`);
});

test('AGGREGATE HONESTY: no demonstration, counterfeit, unverified, stale, unlinked, other-tenant, or out-of-window record inflates the count', async () => {
  // The inflation direction. Six attack fixtures sit inside the window and one
  // outside it; if the count exceeds baseline + 3, at least one of them was
  // counted — and a consumer reading "N in Petworth" could never tell.
  const agg = nb(await body(), TARGET).aggregate;
  assert.equal(agg.asserted, true);
  assert.ok(agg.retailer_count <= baseline.retailer_count + 3,
    `expected at most baseline(${baseline.retailer_count}) + 3, got ${agg.retailer_count} — a record the site itself would withhold is inside a published total`);
});

test('TENANT SCOPE runs through the real menu graph, per tenant', async () => {
  // The other-tenant fixture must count for ITS tenant and only there. This is
  // the same delta discipline, applied on the second brand's host.
  const agg = nb(await body('?pageSize=50', OTHER_TENANT), TARGET).aggregate;
  assert.equal(agg.asserted, true);
  assert.equal(agg.retailer_count, otherBaseline.retailer_count + 1,
    'the OTHERBRAND fixture must be counted for the tenant whose menu graph reaches it, and nothing else may leak across tenants');
});

test('WITHHELD is not zero: past the verification cap the count is refused, not fabricated', async () => {
  const b = await body();
  const capped = nb(b, CAP_TARGET);
  assert.ok(capped, `neighborhood "${CAP_TARGET}" must be listed`);
  assert.equal(capped.aggregate.asserted, false,
    `${CAP + 1}+ candidates must force the count to be WITHHELD — publishing any number here asserts records nobody re-verified`);
  assert.equal(Object.hasOwn(capped.aggregate, 'retailer_count'), false,
    'a withheld count must be an ABSENT key. Zero would read as "we measured and found none", which is a fabricated measurement');
  assert.match(capped.aggregate.withheld_reason, /withheld|re-verify/i);
  assert.equal(capped.aggregate.verified_between, null,
    'a withheld aggregate must not claim a verification span either');
  // And withholding is per-neighborhood, never contagious: the target window
  // in the SAME response still asserts its exact count.
  assert.equal(nb(b, TARGET).aggregate.asserted, true,
    'an overflow in one neighborhood must not withhold every other neighborhood');
});

test('an asserted ZERO stays a real measurement — never conflated with withheld', async () => {
  const b = await body();
  for (const n of b.data) {
    if (n.aggregate.asserted) {
      assert.equal(typeof n.aggregate.retailer_count, 'number',
        `${n.slug}: an asserted aggregate must carry its number, even when that number is 0`);
      assert.equal(n.aggregate.withheld_reason, null);
    } else {
      assert.equal(Object.hasOwn(n.aggregate, 'retailer_count'), false,
        `${n.slug}: withheld and numbered at the same time is a contradiction`);
      assert.ok(n.aggregate.withheld_reason, `${n.slug}: a refusal must say why`);
    }
  }
  assert.match(b.truth_contract.count_policy, /zero always means/i);
  assert.match(b.truth_contract.count_policy, /withheld/i);
});

test('the aggregate carries provenance for the NUMBER, and verified_between is coherent', async () => {
  const b = await body();
  assert.ok(b.data.length > 0, 'no neighborhoods — this check would be vacuous');
  for (const n of b.data) {
    for (const k of ['kind', 'definition_source', 'inputs', 'boundary', 'computed_at', 'candidate_cap', 'is_demonstration']) {
      assert.ok(k in n.provenance, `${n.slug} missing provenance.${k}`);
    }
    assert.equal(n.provenance.kind, 'computed_aggregate');
    assert.equal(n.provenance.is_demonstration, false);
    assert.match(n.provenance.boundary, /isPubliclyVerified/);
    assert.ok(Number.isFinite(new Date(n.provenance.computed_at).getTime()));
    const vb = n.aggregate.verified_between;
    if (vb) {
      assert.ok(new Date(vb.oldest) <= new Date(vb.newest), `${n.slug}: verification span is inverted`);
    }
  }
  const target = nb(b, TARGET);
  assert.ok(target.aggregate.verified_between,
    'the target neighborhood has counted records, so its input-freshness span must be published');
});

test('the payload publishes NO retailer identity — aggregate inputs are not records', async () => {
  // The count is the only claim. Republishing names here would quietly create
  // a second retailers surface without that contract's guarantees.
  const raw = await (await get('/api/v1/neighborhoods?pageSize=50')).text();
  assert.ok(!/Neighborhood Fixture|Neighborhood Cap Fixture/.test(raw),
    'fixture retailer identities leaked into an aggregate payload');
  assert.ok(!/Demo Retailer (Alpha|Beta|Gamma|Delta|Epsilon)/.test(raw),
    'seeded demonstration retailers leaked into an aggregate payload');
});

test('geography is declared: fixed windows and ZIP lists, so membership is checkable', async () => {
  const target = nb(await body(), TARGET);
  assert.ok(target.area.postal_codes.includes('20011'));
  assert.equal(typeof target.area.center.latitude, 'number');
  assert.equal(typeof target.area.latitude_window, 'number');
  assert.match(target.area.rule, /postal code|coordinates/i);
});

test('ORDERING is declared, alphabetical, and sponsorship-neutral', async () => {
  const b = await body();
  assert.equal(b.ordering.sponsorship_affects_order, false);
  assert.match(b.ordering.rule, /alphabetical/i);
  const slugs = b.data.map((n) => n.slug);
  assert.deepEqual(slugs, [...slugs].sort(), 'payload order must be the declared stable alphabetical order');
  assert.ok(!/isSponsored|is_sponsored/i.test(JSON.stringify(b.data)),
    'sponsorship state must not appear anywhere in an aggregate payload');
});

test('pagination is CLAMPED, garbage falls back, pages do not overlap', async () => {
  const big = await body('?pageSize=99999');
  assert.equal(big.pagination.page_size, 50);
  assert.ok(big.pagination.page_size <= big.pagination.max_page_size);
  assert.equal(big.pagination.returned, big.pagination.total_matching,
    'fifty is enough for every configured neighborhood, so one page must return the whole set');
  const junk = await body('?pageSize=abc&page=-7');
  assert.equal(junk.pagination.page_size, 20);
  assert.equal(junk.pagination.page, 1);
  const p1 = await body('?pageSize=6&page=1');
  const p2 = await body('?pageSize=6&page=2');
  const s1 = p1.data.map((n) => n.slug);
  for (const s of p2.data.map((n) => n.slug)) {
    assert.ok(!s1.includes(s), `slug ${s} appeared on both pages — unstable ordering`);
  }
});

test('an UNKNOWN TENANT is refused and leaks no aggregate', async () => {
  const r = await get('/api/v1/neighborhoods', 'not-a-configured-host.localhost');
  assert.equal(r.status, 421);
  const t = await r.text();
  assert.ok(!/retailer_count|petworth/i.test(t), 'a refusal must leak nothing');
});

test('the response is not cached', async () => {
  const r = await get('/api/v1/neighborhoods');
  assert.match(r.headers.get('cache-control') ?? '', /no-store/);
});

test('the truth contract names the double boundary, the count policy, and what is NOT claimed', async () => {
  const b = await body();
  const joined = b.truth_contract.boundaries_applied.join(' ');
  assert.match(joined, /currentPublicRecordWhere/);
  assert.match(joined, /applied again after the query/);
  assert.match(joined, /menu graph/);
  assert.match(joined, /not an advertising radius/);
  assert.match(b.truth_contract.count_policy, /would themselves be published/);
  assert.equal(typeof b.truth_contract.post_query_rejections, 'number');
  for (const k of ['ranking position', 'endorsement', 'retailer density beyond the verification cap',
                   'legal or administrative neighborhood boundaries', 'delivery coverage']) {
    assert.ok(b.truth_contract.not_claimed.includes(k), `must disclaim: ${k}`);
  }
});
