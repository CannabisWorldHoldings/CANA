#!/usr/bin/env node
/**
 * ORDERWEEDDC MERCHANT VISIBILITY AUDIT — V1
 *
 * The first SELLABLE artifact in the merchant Growth OS wedge:
 *   merchant → verified profile → source/freshness audit → visibility audit
 *   → correction workflow → pilot → attributed action → proof of value.
 *
 * TRUTH LAW (V9 §03 + PRODUCT_AND_REVENUE_STATE):
 *   - every finding cites the exact DB field it was derived from
 *   - no invented rankings, traffic, leads, or conversion lift
 *   - demonstration data is labeled DEMONSTRATION_ONLY and can never be
 *     presented as a live commercial result
 *
 * Usage:
 *   node audit.mjs --db <path/to/dev.db> [--retailer <id|name>] [--json out.json] [--all]
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d; };
/** Whitespace-only strings are absent, not present (verifier MINOR-1). */
const present = v => typeof v === 'string' ? v.trim().length > 0 : v != null;
/** Exact, case-insensitive match — 'PENDING_VERIFIED' must never pass (verifier MINOR-2). */
const isVerified = v => typeof v === 'string' && v.trim().toUpperCase() === 'VERIFIED';

/**
 * Truth label must not rest on a single boolean (verifier FALSIFIED claim 3).
 * A record with isDemonstration=0 but dataStatus='DEMONSTRATION_ONLY', or whose
 * entire menu is demonstration data, is NOT a live commercial result.
 */
function truthLabel(r, db) {
  const reasons = [];
  if (r.isDemonstration) reasons.push('Retailer.isDemonstration=1');
  if (typeof r.dataStatus === 'string' && /demonstration|demo|synthetic|sample/i.test(r.dataStatus)) {
    reasons.push(`Retailer.dataStatus=${r.dataStatus}`);
  }
  try {
    const m = db.prepare('SELECT COUNT(*) c, SUM(CASE WHEN isDemonstration THEN 1 ELSE 0 END) d FROM MenuEntry WHERE retailerId = ?').get(r.id);
    if (m && m.c > 0 && m.d === m.c) reasons.push('every MenuEntry.isDemonstration=1');
  } catch { /* menu table unavailable */ }
  return reasons.length
    ? `DEMONSTRATION_ONLY — not a live commercial result (${reasons.join('; ')})`
    : 'LIVE_RECORD';
}
const has = k => process.argv.includes(`--${k}`);
const DB = arg('db', 'prisma/dev.db');
const JSONOUT = arg('json', null);

/** Weighted checks. Each returns {status, detail, evidence_field, remedy}. */
const CHECKS = [
  { id: 'profile.name', weight: 3, label: 'Business name present',
    run: r => present(r.name) ? ok('present', 'Retailer.name') : bad('missing', 'Retailer.name', 'Provide the legal or trading name') },
  { id: 'profile.address', weight: 4, label: 'Street address present',
    run: r => present(r.address) && present(r.city) && present(r.state) ? ok(`${r.address.trim()}, ${r.city.trim()} ${r.state.trim()}`, 'Retailer.address/city/state')
      : bad('incomplete address', 'Retailer.address', 'Supply full street address — required for local-pack eligibility') },
  { id: 'profile.geo', weight: 4, label: 'Geocoordinates present',
    run: r => (r.lat && r.lng) ? ok(`${r.lat}, ${r.lng}`, 'Retailer.lat/lng')
      : bad('missing coordinates', 'Retailer.lat/lng', 'Geocode the address so the listing appears on map and neighborhood surfaces') },
  { id: 'profile.phone', weight: 2, label: 'Phone present',
    run: r => present(r.phone) ? ok(r.phone, 'Retailer.phone') : bad('missing', 'Retailer.phone', 'Add a reachable phone number') },
  { id: 'profile.website', weight: 3, label: 'Website present',
    run: r => present(r.website) ? ok(r.website, 'Retailer.website')
      : bad('missing', 'Retailer.website', 'Add a website — required for sameAs structured data and answer-engine entity linking') },
  { id: 'profile.email', weight: 1, label: 'Contact email present',
    run: r => present(r.email) ? ok(r.email, 'Retailer.email') : bad('missing', 'Retailer.email', 'Add a contact email for correction routing') },
  { id: 'hours.present', weight: 3, label: 'Operating hours present',
    run: r => present(r.hours) ? ok(r.hours, 'Retailer.hours') : bad('missing', 'Retailer.hours', 'Publish hours — drives "open now" filtering') },
  { id: 'hours.sourced', weight: 2, label: 'Hours attributed to a real source',
    run: r => !present(r.hoursSource) ? bad('no source', 'Retailer.hoursSource', 'Attribute hours to an observable source')
      : /synthetic|seed|demo/i.test(r.hoursSource) ? warn(`synthetic source: ${r.hoursSource}`, 'Retailer.hoursSource', 'Replace seeded hours with merchant-confirmed or crawled hours')
      : ok(r.hoursSource, 'Retailer.hoursSource') },

  { id: 'license.status', weight: 5, label: 'License status verified',
    run: r => isVerified(r.licenseStatus) ? ok('VERIFIED', 'Retailer.licenseStatus')
      : bad(`status=${r.licenseStatus || 'null'}`, 'Retailer.licenseStatus', 'Submit license evidence via the claim flow to earn the Verified Current label') },
  { id: 'license.number', weight: 3, label: 'License number recorded',
    run: r => present(r.licenseNumber) ? ok(r.licenseNumber, 'Retailer.licenseNumber') : bad('missing', 'Retailer.licenseNumber', 'Record the DC ABCA license number') },
  { id: 'license.checked', weight: 3, label: 'License recently re-checked',
    run: r => r.lastLicenseCheck ? ok(String(r.lastLicenseCheck), 'Retailer.lastLicenseCheck')
      : bad('never checked', 'Retailer.lastLicenseCheck', 'Run a license re-check so status carries a timestamp') },

  { id: 'freshness.info', weight: 4, label: 'Profile information recently checked',
    run: r => r.lastInfoCheck ? ok(String(r.lastInfoCheck), 'Retailer.lastInfoCheck')
      : bad('never checked', 'Retailer.lastInfoCheck', 'Establish a freshness cadence — stale records rank below current ones under truth-first sort') },
  { id: 'freshness.retrieved', weight: 3, label: 'Record has a retrieval timestamp',
    run: r => r.retrievedAt ? ok(String(r.retrievedAt), 'Retailer.retrievedAt') : bad('missing', 'Retailer.retrievedAt', 'Bind the record to an observation time') },
  { id: 'freshness.expiry', weight: 3, label: 'Freshness window declared',
    run: r => r.freshnessExpiresAt ? ok(String(r.freshnessExpiresAt), 'Retailer.freshnessExpiresAt')
      : bad('missing', 'Retailer.freshnessExpiresAt', 'Declare when this record should be considered stale') },
  { id: 'freshness.verified', weight: 4, label: 'Record independently verified',
    run: r => r.verifiedAt ? ok(String(r.verifiedAt), 'Retailer.verifiedAt') : bad('never verified', 'Retailer.verifiedAt', 'Complete verification to qualify for Verified Current') },
  { id: 'provenance.source', weight: 4, label: 'Source URL present',
    run: r => present(r.sourceUrl) ? ok(r.sourceUrl, 'Retailer.sourceUrl')
      : bad('missing', 'Retailer.sourceUrl', 'Every operational value needs a citable source URL') },
  { id: 'provenance.confidence', weight: 3, label: 'Confidence above zero',
    run: r => (r.confidence > 0 && r.confidence <= 1) ? ok(String(r.confidence), 'Retailer.confidence')
      : bad(`confidence=${r.confidence} (must be >0 and <=1)`, 'Retailer.confidence', 'Confidence 0 suppresses the listing under truth-first ordering') },

  { id: 'data.status', weight: 5, label: 'Not demonstration-only',
    run: r => r.isDemonstration ? bad('DEMONSTRATION_ONLY', 'Retailer.isDemonstration', 'Demonstration records are excluded from public discovery — convert to a sourced live record')
      : ok(`isDemonstration=0 (dataStatus=${r.dataStatus || 'null'})`, 'Retailer.isDemonstration') },
];

function ok(detail, field) { return { status: 'PASS', detail, evidence_field: field, remedy: null }; }
function warn(detail, field, remedy) { return { status: 'WARN', detail, evidence_field: field, remedy }; }
function bad(detail, field, remedy) { return { status: 'FAIL', detail, evidence_field: field, remedy }; }

function menuChecks(db, id) {
  const rows = db.prepare(`SELECT * FROM MenuEntry WHERE retailerId = ?`).all(id);
  const out = [];
  out.push({ id: 'menu.count', weight: 5, label: 'Menu has entries',
    ...(rows.length ? ok(`${rows.length} entries`, 'MenuEntry') : bad('empty menu', 'MenuEntry', 'Publish a menu — retailers without menus lose product-level discovery entirely')) });
  if (!rows.length) {
    // DENOMINATOR FIX (independent verifier MAJOR-1): previously these four
    // checks were simply not emitted for an empty menu, so their weight left
    // the denominator and an empty menu scored HIGHER than a flawed one —
    // rewarding withholding data. They must FAIL, not vanish.
    out.push({ id: 'menu.stock', weight: 3, label: 'Stock state populated', ...bad('no menu entries', 'MenuEntry.inStock', 'Publish menu entries with availability') });
    out.push({ id: 'menu.price', weight: 4, label: 'Prices populated', ...bad('no menu entries', 'MenuEntry.price', 'Publish menu entries with prices') });
    out.push({ id: 'menu.provenance', weight: 4, label: 'Menu entries carry a source', ...bad('no menu entries', 'MenuEntry.sourceUrl', 'Publish sourced menu entries') });
    out.push({ id: 'menu.demo', weight: 3, label: 'Menu is not demonstration-only', ...bad('no menu entries', 'MenuEntry.isDemonstration', 'Publish live sourced menu entries') });
  }
  if (rows.length) {
    const inStock = rows.filter(r => r.inStock).length;
    out.push({ id: 'menu.stock', weight: 3, label: 'Stock state populated',
      ...(inStock ? ok(`${inStock}/${rows.length} in stock`, 'MenuEntry.inStock') : warn('nothing marked in stock', 'MenuEntry.inStock', 'Mark availability so "in stock" filters surface the menu')) });
    const priced = rows.filter(r => r.price != null && r.price > 0).length;
    out.push({ id: 'menu.price', weight: 4, label: 'Prices populated',
      ...(priced === rows.length ? ok(`${priced}/${rows.length} priced`, 'MenuEntry.price')
        : bad(`${priced}/${rows.length} priced`, 'MenuEntry.price', 'Missing prices break price-band filtering and comparison surfaces')) });
    const sourced = rows.filter(r => r.sourceUrl).length;
    out.push({ id: 'menu.provenance', weight: 4, label: 'Menu entries carry a source',
      ...(sourced === rows.length ? ok(`${sourced}/${rows.length} sourced`, 'MenuEntry.sourceUrl')
        : bad(`${sourced}/${rows.length} sourced`, 'MenuEntry.sourceUrl', 'Unsourced menu values cannot be labeled Verified Current')) });
    const demo = rows.filter(r => r.isDemonstration).length;
    out.push({ id: 'menu.demo', weight: 3, label: 'Menu is not demonstration-only',
      ...(demo === 0 ? ok('live', 'MenuEntry.isDemonstration') : bad(`${demo}/${rows.length} demonstration`, 'MenuEntry.isDemonstration', 'Convert seeded menu rows to sourced live rows')) });
  }
  return out;
}

function seoChecks(r) {
  const out = [];
  const hasSchemaInputs = present(r.name) && present(r.address) && present(r.city) && present(r.state) && present(r.zip) && present(r.phone);
  out.push({ id: 'seo.localbusiness', weight: 5, label: 'LocalBusiness structured-data inputs complete',
    ...(hasSchemaInputs ? ok('name+address+geo+phone present', 'Retailer.name/address/city/state/zip/phone')
      : bad('incomplete', 'Retailer.address/zip/phone', 'LocalBusiness JSON-LD requires name, full address, and phone — incomplete markup forfeits rich results')) });
  out.push({ id: 'seo.sameas', weight: 3, label: 'sameAs entity link available',
    ...(present(r.website) ? ok(r.website, 'Retailer.website') : bad('no website', 'Retailer.website', 'Without a website there is no sameAs anchor for entity reconciliation')) });
  out.push({ id: 'aeo.answerable', weight: 4, label: 'Answer-engine ready (hours + license + location)',
    ...((present(r.hours) && isVerified(r.licenseStatus) && r.lat) ? ok('answerable', 'Retailer.hours/licenseStatus/lat')
      : bad('not answerable', 'Retailer.hours/licenseStatus/lat', 'Assistants answer "open now / licensed / near me" — all three must be present and verified')) });
  out.push({ id: 'seo.neighborhood', weight: 3, label: 'Neighborhood placement possible',
    ...((r.lat && r.lng) ? ok('geocoded', 'Retailer.lat/lng') : bad('no coordinates', 'Retailer.lat/lng', 'Neighborhood pages are a primary local-intent entrance')) });
  return out;
}

function conversionChecks(r, menuCount) {
  const out = [];
  out.push({ id: 'conv.contact', weight: 4, label: 'A contact path exists',
    ...((present(r.phone) || present(r.website) || present(r.email)) ? ok('reachable', 'Retailer.phone/website/email')
      : bad('no contact path', 'Retailer.phone/website/email', 'No way for a customer to act — this caps conversion at zero')) });
  out.push({ id: 'conv.menu', weight: 4, label: 'Menu supports product-level intent',
    ...(menuCount > 0 ? ok(`${menuCount} entries`, 'MenuEntry') : bad('no menu', 'MenuEntry', 'Product-level intent is the highest-converting entry point')) });
  out.push({ id: 'conv.sponsorship', weight: 2, label: 'Sponsorship disclosed, not rank-buying',
    ...(r.isSponsored ? warn('sponsored — must be visibly labeled and must not alter organic order', 'Retailer.isSponsored', 'Verify the UI labels sponsorship and that ordering is unaffected')
      : ok('not sponsored', 'Retailer.isSponsored')) });
  return out;
}

// ---- run
// Node 24 ships a built-in SQLite; avoids a native-compile dependency.
let db;
try {
  const { DatabaseSync } = require('node:sqlite');
  db = new DatabaseSync(DB, { readOnly: true });
} catch (e) {
  try { const B = require('better-sqlite3'); db = new B(DB, { readonly: true }); }
  catch { console.error('No SQLite driver available (node:sqlite or better-sqlite3):', e.message); process.exit(2); }
}
const want = arg('retailer', null);
let retailers = db.prepare('SELECT * FROM Retailer').all();
if (want && !has('all')) retailers = retailers.filter(r => r.id === want || r.name === want);
else if (!has('all')) retailers = retailers.slice(0, 1);
if (!retailers.length) { console.error('No matching retailer.'); process.exit(1); }

const reports = [];
for (const r of retailers) {
  const menuCount = db.prepare('SELECT COUNT(*) c FROM MenuEntry WHERE retailerId = ?').get(r.id).c;
  const results = [
    ...CHECKS.map(c => ({ id: c.id, weight: c.weight, label: c.label, ...c.run(r) })),
    ...menuChecks(db, r.id),
    ...seoChecks(r),
    ...conversionChecks(r, menuCount),
  ];
  const earned = results.reduce((s, x) => s + (x.status === 'PASS' ? x.weight : x.status === 'WARN' ? x.weight * 0.5 : 0), 0);
  const total = results.reduce((s, x) => s + x.weight, 0);
  const score = Math.round((earned / total) * 100);
  const fails = results.filter(x => x.status === 'FAIL');
  const actions = [...fails].sort((a, b) => b.weight - a.weight).slice(0, 5)
    .map((f, i) => ({ rank: i + 1, weight: f.weight, finding: f.label, evidence_field: f.evidence_field, observed: f.detail, action: f.remedy }));

  reports.push({
    retailer: { id: r.id, name: r.name, type: r.type, is_demonstration: !!r.isDemonstration, data_status: r.dataStatus },
    audit_version: 'MERCHANT_VISIBILITY_AUDIT_V1',
    generated_at: new Date().toISOString(),
    truth_label: truthLabel(r, db),
    score, earned_weight: earned, total_weight: total,
    counts: { pass: results.filter(x => x.status === 'PASS').length, warn: results.filter(x => x.status === 'WARN').length, fail: fails.length },
    checks: results,
    top_actions: actions,
    disclaimer: 'Findings are derived only from observable database fields, each cited above. No ranking, traffic, lead, or conversion-lift figure is claimed or implied.',
  });
}

for (const rep of reports) {
  console.log(`\n=== MERCHANT VISIBILITY AUDIT V1 — ${rep.retailer.name} ===`);
  console.log(`  truth label : ${rep.truth_label}`);
  console.log(`  score       : ${rep.score}/100  (${rep.earned_weight}/${rep.total_weight} weighted)`);
  console.log(`  results     : ${rep.counts.pass} pass · ${rep.counts.warn} warn · ${rep.counts.fail} fail`);
  console.log(`  top actions :`);
  rep.top_actions.forEach(a => console.log(`    ${a.rank}. [w${a.weight}] ${a.finding} — ${a.observed}\n         field: ${a.evidence_field}\n         do: ${a.action}`));
}

if (JSONOUT) { fs.writeFileSync(JSONOUT, JSON.stringify(reports.length === 1 ? reports[0] : reports, null, 2)); console.log(`\n  report -> ${JSONOUT}`); }
db.close();
