import assert from 'node:assert/strict';
import test from 'node:test';

import { compileMarketPage } from '../src/lib/market-page-compiler.mjs';

/**
 * D10 / M-005 — the compiled city surface. Reference anatomy: recon C6/P-F7.
 * Reference FAILURE MODES are the laws under test: MM-005 (vanity ranking,
 * unsold hero filler) and MM-006 (zero platform-issued verified truth).
 */

const NOW = '2026-08-08T19:30:00-04:00';
const FRESH = '2026-08-08T12:00:00-04:00';
const STALE = '2026-08-05T12:00:00-04:00';

const lic = (checked = FRESH) => ({ status: 'VERIFIED_CURRENT', checked_at: checked, number: 'C-2024-DC-0001', authority: 'DC ABCA', source_url: 'https://abca.dc.gov/lic/C-2024-DC-0001' });
const licBare = (checked = FRESH) => ({ status: 'VERIFIED_CURRENT', checked_at: checked }); // VERIFIED but no auditable datum

const baseRecords = () => ({
  placements: [],
  merchants: [
    {
      merchant_id: 'del-serves', name: 'Serves Navy Yard', kind: 'DELIVERY', license: lic(), distance_miles: 8,
      delivery: { service_area: { neighborhoods: ['Navy Yard'] }, hours: [{ day: 6, open_minutes: 600, close_minutes: 1680 }], minimum_usd: 40, fee_usd: 0, verified_at: FRESH },
    },
    {
      merchant_id: 'del-elsewhere', name: 'Serves Georgetown Only', kind: 'DELIVERY', license: lic(), distance_miles: 3,
      delivery: { service_area: { neighborhoods: ['Georgetown'] }, hours: [{ day: 6, open_minutes: 600, close_minutes: 1680 }], verified_at: FRESH },
    },
    { merchant_id: 'disp-a', name: 'Storefront A', kind: 'DISPENSARY', license: lic(), neighborhood: 'Shaw' },
    { merchant_id: 'disp-unlicensed', name: 'Gifting Workaround', kind: 'DISPENSARY', license: { status: 'PENDING', checked_at: FRESH } },
  ],
  deals: [
    { id: 'deal-late', merchant_id: 'disp-a', title: 'Ounce special', category: 'flower', price_usd: 120, checked_at: FRESH, validity: { start: '2026-08-08T00:00:00-04:00', end: '2026-08-09T23:00:00-04:00' } },
    { id: 'deal-soon', merchant_id: 'disp-a', title: 'Tonight only', category: 'edibles', price_usd: 40, checked_at: FRESH, validity: { start: '2026-08-08T00:00:00-04:00', end: '2026-08-08T22:00:00-04:00' } },
  ],
  questions: [
    { id: 'q-legal', question: 'Is cannabis legal in DC?', answer: 'Initiative 71 allows…', source_ref: 'dc-law-register#i71' },
    { id: 'q-uncited', question: 'Made up claim?', answer: 'No citation.' },
  ],
});

const ctx = (over = {}) => ({ market: 'Washington, D.C.', now: NOW, ...over });

test('MM-005 law: unsold hero is owner intelligence — UNSOLD_INVENTORY state + editorial fallback, never filler', () => {
  const page = compileMarketPage(baseRecords(), ctx());
  const hero = page.modules.find((m) => m.kind === 'hero_media');
  assert.equal(hero.state, 'UNSOLD_INVENTORY');
  assert.equal(hero.fallback, 'EDITORIAL_HERO');
  assert.ok(page.integrity.some((n) => /UNSOLD/.test(n)));
});

test('law 3: only court-passed, sponsored-labeled, authorized-asset placements enter the hero', () => {
  const r = baseRecords();
  r.placements = [
    { id: 'p-good', advertiser: 'm1', sponsored: true, court_passed: true, creative: { asset_hash: 'abc' }, window: { start: '2026-08-08T00:00:00-04:00', end: '2026-08-10T00:00:00-04:00' } },
    { id: 'p-uncourted', advertiser: 'm2', sponsored: true, court_passed: false, creative: { asset_hash: 'x' }, window: { start: '2026-08-08T00:00:00-04:00', end: '2026-08-10T00:00:00-04:00' } },
    { id: 'p-expired', advertiser: 'm3', sponsored: true, court_passed: true, creative: { asset_hash: 'y' }, window: { start: '2026-08-01T00:00:00-04:00', end: '2026-08-02T00:00:00-04:00' } },
  ];
  const hero = compileMarketPage(r, ctx()).modules.find((m) => m.kind === 'hero_media');
  assert.equal(hero.state, 'SOLD');
  assert.deepEqual(hero.items.map((i) => i.id), ['p-good']);
  assert.equal(hero.items[0].label, 'Sponsored');
  assert.equal(hero.provenance.excluded, 2);
});

test('law 2 (MM-005): deals rank by verified urgency (expiry-soonest), never by applause', () => {
  const page = compileMarketPage(baseRecords(), ctx());
  const deals = page.modules.find((m) => m.kind === 'deals');
  assert.deepEqual(deals.items.map((d) => d.id), ['deal-soon', 'deal-late']);
  assert.match(deals.provenance.rank_basis, /never applause/);
});

test('law 2: popularity fields are ignored and flagged, never ranked on', () => {
  const r = baseRecords();
  r.deals[0].likes = 22000; // the 22k-hearts pattern from recon C6
  const page = compileMarketPage(r, ctx());
  const deals = page.modules.find((m) => m.kind === 'deals');
  assert.deepEqual(deals.items.map((d) => d.id), ['deal-soon', 'deal-late'], 'hearts change nothing');
  assert.ok(page.integrity.some((n) => /never rank on applause/.test(n)));
});

test('law 3: an organic record carrying sponsorship fields makes the compiler THROW — fail closed', () => {
  const r = baseRecords();
  r.deals[0].sponsored = true;
  assert.throws(() => compileMarketPage(r, ctx()), /ORGANIC_TRUTH_VIOLATION/);
});

test('law 1 (MM-006 inverse): unlicensed merchants and stale checks are excluded and counted', () => {
  const r = baseRecords();
  r.deals.push({ id: 'deal-unlicensed', merchant_id: 'disp-unlicensed', title: 'x', price_usd: 10, checked_at: FRESH, validity: { start: '2026-08-08T00:00:00-04:00', end: '2026-08-09T00:00:00-04:00' } });
  r.deals.push({ id: 'deal-stale', merchant_id: 'disp-a', title: 'y', price_usd: 10, checked_at: STALE, validity: { start: '2026-08-08T00:00:00-04:00', end: '2026-08-09T00:00:00-04:00' } });
  const page = compileMarketPage(r, ctx());
  const deals = page.modules.find((m) => m.kind === 'deals');
  assert.ok(!deals.items.some((d) => d.id === 'deal-unlicensed' || d.id === 'deal-stale'));
  assert.equal(deals.provenance.excluded.unlicensed, 1);
  assert.equal(deals.provenance.excluded.stale, 1);
  const disp = page.modules.find((m) => m.kind === 'dispensaries');
  assert.ok(!disp.items.some((i) => i.merchant_id === 'disp-unlicensed'));
});

test('law 1: every surfaced item carries platform-issued verified truth, not self-claims', () => {
  const page = compileMarketPage(baseRecords(), ctx({ neighborhood: 'Navy Yard' }));
  for (const mod of page.modules) {
    for (const item of mod.items) {
      if (mod.kind === 'hero_media' || mod.kind === 'local_questions') continue;
      assert.equal(item.verified.licensed, true, `${mod.kind} item carries ✓licensed`);
    }
  }
});

test('MM-008 beat: the verified mark carries the AUDITABLE DATUM (license #, authority, status, source), not a bare ✓', () => {
  const page = compileMarketPage(baseRecords(), ctx({ neighborhood: 'Navy Yard' }));
  const disp = page.modules.find((m) => m.kind === 'dispensaries').items[0];
  assert.equal(disp.verified.license_number, 'C-2024-DC-0001');
  assert.equal(disp.verified.authority, 'DC ABCA');
  assert.equal(disp.verified.status, 'VERIFIED_CURRENT');
  assert.equal(disp.verified.source_url, 'https://abca.dc.gov/lic/C-2024-DC-0001');
  assert.equal(disp.verified.auditable, true, 'a mark is auditable only with number + authority');
  const del = page.modules.find((m) => m.kind === 'delivery_services').items[0];
  assert.equal(del.verified.auditable, true);
  const deal = page.modules.find((m) => m.kind === 'deals').items[0];
  assert.equal(deal.verified.license_number, 'C-2024-DC-0001', 'deals carry the merchant license datum too');
});

test('MM-008 law: a VERIFIED merchant with no license number is a BARE mark — auditable:false + flagged (the gap we refuse)', () => {
  const r = baseRecords();
  r.merchants.find((m) => m.merchant_id === 'disp-a').license = licBare();
  const page = compileMarketPage(r, ctx());
  const disp = page.modules.find((m) => m.kind === 'dispensaries').items.find((i) => i.merchant_id === 'disp-a');
  assert.equal(disp.verified.licensed, true);
  assert.equal(disp.verified.auditable, false);
  assert.equal(disp.verified.license_number, undefined, 'never invented');
  assert.ok(page.integrity.some((n) => /MM-008 beat we still owe/.test(n)), 'the missing datum is surfaced, not hidden');
});

test('law 5 (D13): with a neighborhood, delivery rail ranks by eligibility — the 8-mile server beats the 3-mile non-server, which is EXCLUDED', () => {
  const page = compileMarketPage(baseRecords(), ctx({ neighborhood: 'Navy Yard' }));
  const rail = page.modules.find((m) => m.kind === 'delivery_services');
  assert.deepEqual(rail.items.map((i) => i.merchant_id), ['del-serves']);
  assert.equal(rail.items[0].eligibility, 'ELIGIBLE_OPEN');
  assert.match(rail.provenance.rank_basis, /eligibility over radius/);
});

test('law 5: without a neighborhood the rail is honestly market-wide and says so', () => {
  const page = compileMarketPage(baseRecords(), ctx());
  const rail = page.modules.find((m) => m.kind === 'delivery_services');
  assert.equal(rail.items.length, 2);
  assert.match(rail.provenance.rank_basis, /honest default/);
});

test('law 6: uncited local questions are excluded with an integrity note', () => {
  const page = compileMarketPage(baseRecords(), ctx());
  const qs = page.modules.find((m) => m.kind === 'local_questions');
  assert.deepEqual(qs.items.map((q) => q.id), ['q-legal']);
  assert.equal(qs.items[0].source_ref, 'dc-law-register#i71');
  assert.ok(page.integrity.some((n) => /never hallucinate law/.test(n)));
});

test('law 7: empty modules are absent — no scaffolds (hero exempt as owner signal)', () => {
  const page = compileMarketPage({ placements: [], deals: [], merchants: [], questions: [] }, ctx());
  assert.deepEqual(page.modules.map((m) => m.kind), ['hero_media']);
  assert.equal(page.modules[0].state, 'UNSOLD_INVENTORY');
});

test('law 8: every module carries provenance with eligible/excluded/rank_basis', () => {
  const page = compileMarketPage(baseRecords(), ctx({ neighborhood: 'Navy Yard' }));
  for (const mod of page.modules) {
    assert.ok(mod.provenance, mod.kind);
    assert.ok(typeof mod.provenance.eligible === 'number');
    assert.ok(typeof mod.provenance.rank_basis === 'string' && mod.provenance.rank_basis.length > 0);
  }
});

test('deterministic: same records + clock → identical page', () => {
  const a = compileMarketPage(baseRecords(), ctx({ neighborhood: 'Navy Yard' }));
  const b = compileMarketPage(baseRecords(), ctx({ neighborhood: 'Navy Yard' }));
  assert.deepEqual(a, b);
});

test('clock is injected: generated_at comes from context.now, never wall time', () => {
  const page = compileMarketPage(baseRecords(), ctx());
  assert.equal(page.generated_at, new Date(NOW).toISOString());
});

test('R2: eligible delivery rows carry the VERIFIED serves list; fail-closed rows never claim coverage', () => {
  const r = baseRecords();
  // add a stale-verification operator — must fail closed with NO serves claim
  r.merchants.push({
    merchant_id: 'stale-runner', name: 'Stale Runner', kind: 'DELIVERY', license: lic(), distance_miles: 2,
    delivery: { service_area: { neighborhoods: ['Navy Yard'] }, hours: [{ day: 6, open_minutes: 600, close_minutes: 1680 }], verified_at: STALE },
  });
  const page = compileMarketPage(r, ctx({ neighborhood: 'Navy Yard' }));
  const rail = page.modules.find((m) => m.kind === 'delivery_services');
  const eligible = rail.items.find((i) => i.merchant_id === 'del-serves');
  assert.deepEqual(eligible.facts.serves, ['Navy Yard'], 'verified coverage surfaces');
  const stale = rail.items.find((i) => i.merchant_id === 'stale-runner');
  assert.equal(stale.eligibility, 'UNVERIFIED');
  assert.equal(stale.facts.serves, undefined, 'an unverified claim is no claim');
});

test('VISUAL-IDENTITY LAW: authorized media passes through; absent media = HOUSE_FALLBACK + MERCHANT_MEDIA_MISSING flag, never fabricated', () => {
  const r = baseRecords();
  r.merchants.find((m) => m.merchant_id === 'disp-a').media = { kind: 'AUTHORIZED_LOGO', asset: 'sha256:abc', rights: 'merchant-granted-2026-08', updated_at: FRESH };
  const page = compileMarketPage(r, ctx({ neighborhood: 'Navy Yard' }));
  const withMedia = page.modules.find((m) => m.kind === 'dispensaries').items.find((i) => i.merchant_id === 'disp-a');
  assert.equal(withMedia.media.kind, 'AUTHORIZED_LOGO');
  assert.equal(withMedia.media.asset, 'sha256:abc');
  const rail = page.modules.find((m) => m.kind === 'delivery_services');
  const noMedia = rail.items.find((i) => i.merchant_id === 'del-serves');
  assert.equal(noMedia.media.kind, 'HOUSE_FALLBACK', 'no authorized media → intentional house treatment');
  assert.equal(noMedia.media.asset, undefined, 'nothing fabricated');
  assert.ok(page.integrity.some((n) => /MERCHANT_MEDIA_MISSING: del-serves/.test(n)), 'onboarding opportunity surfaced');
  assert.ok(!page.integrity.some((n) => /MERCHANT_MEDIA_MISSING: disp-a/.test(n)), 'authorized merchant not flagged');
});
