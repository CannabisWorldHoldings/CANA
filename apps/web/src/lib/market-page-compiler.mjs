/**
 * TRANSPLANT T3 (MARKET TRUTH): from the forge @ 074604f + b7e3b70 (14/14
 * there). Host vocabulary adopted: the licensed gate is
 * DATA_STATUS.VERIFIED_CURRENT (data-status.mjs) — one truth, no aliases.
 *
 * Local Market Page Compiler — one city surface compiled from VERIFIED
 * records, module by module. (PDF directive D10 / mechanism M-005.)
 *
 * Reference anatomy (recon C6, P-F7 — Where's Weed DC): hero ad → priced
 * claim-deals → delivery rail → dispensary rail → local questions. Their
 * gaps are our laws (MM-005, MM-006): they rank deals by vanity ❤ counts,
 * run an UNSOLD hero on house filler, and surface ZERO platform-issued
 * verified truth. This compiler refuses all three failure modes.
 *
 * Laws:
 * 1. VERIFIED-ONLY SURFACE: an item enters a module only with a VERIFIED
 *    license and fresh checked_at. Stale/unlicensed items are EXCLUDED and
 *    counted in module provenance — the customer surface shows truth only.
 * 2. NO FABRICATED DEMAND (MM-005): ranking uses verified fields only —
 *    deals rank by expiry-soonest then freshest-checked. Popularity fields
 *    (likes, hearts, views) are IGNORED even if supplied, and their
 *    presence is flagged in integrity notes. We never rank on applause.
 * 3. SPONSORSHIP IS EXPLICIT AND QUARANTINED (M-013): paid creative exists
 *    ONLY in the hero_media module, and only court-passed, authorized-asset,
 *    sponsored-labeled placements enter it. An organic record carrying
 *    sponsorship fields makes the compiler THROW — hidden organic truth is
 *    not for sale, fail closed.
 * 4. UNSOLD INVENTORY IS OWNER INTELLIGENCE (MM-005): no sellable hero →
 *    module reports state UNSOLD_INVENTORY with fallback EDITORIAL_HERO
 *    (the protected champion) — a god-eye signal, never a leprechaun.
 * 5. DELIVERY IS FIRST-CLASS (D6/D13): the delivery rail ranks by verified
 *    service-area ELIGIBILITY (service-area.mjs) when the customer's
 *    neighborhood is known; otherwise honestly by open-state then id, and
 *    rank_basis says which.
 * 6. LOCAL QUESTIONS CITE LAW (M-010): a question enters only with a
 *    source_ref into the law register. No doorway SEO, no hallucinated law.
 * 7. NO SCAFFOLDS: a module with zero eligible items is ABSENT from the
 *    page, never rendered empty.
 * 8. PROVENANCE EVERYWHERE: every module carries { eligible, excluded,
 *    rank_basis }; the page carries assumptions + integrity notes.
 *
 * Deterministic, LEVEL 0, injected clock. The Gauntlet challenger page
 * consumes this output; the compiler itself never touches pixels.
 */

import { rankDeliveryRelevance, ELIGIBILITY } from './service-area.mjs';
import { DATA_STATUS } from './data-status.mjs';

export const FRESHNESS_MAX_HOURS = 24;

const fresh = (checkedAt, now, maxHours = FRESHNESS_MAX_HOURS) =>
  checkedAt && !Number.isNaN(Date.parse(checkedAt)) &&
  Date.parse(now) - Date.parse(checkedAt) <= maxHours * 3600_000;

const licensed = (m) => m && m.license && m.license.status === DATA_STATUS.VERIFIED_CURRENT;

/**
 * The auditable verified datum (MM-008 beat): a trust mark is worthless if the
 * customer can't verify it. Both competitors stop at a bare checkmark (Weedmaps)
 * or nothing (Where's Weed). We surface the underlying facts — real license
 * number + issuing authority + status + machine-checked timestamp + optional
 * source URL — so every glyph is click-through to its source. Absent fields stay
 * absent (never invented); a VERIFIED status with no number is downgraded to a
 * bare mark and flagged, because an unexplained ✓ is exactly the gap we refuse.
 */
function verifiedDatum(m, now, integrity, moduleName) {
  const L = m.license;
  const datum = { licensed: true, status: L.status, checked_at: L.checked_at };
  if (typeof L.number === 'string' && L.number) datum.license_number = L.number;
  if (typeof L.authority === 'string' && L.authority) datum.authority = L.authority;
  if (typeof L.source_url === 'string' && L.source_url) datum.source_url = L.source_url;
  datum.auditable = Boolean(datum.license_number && datum.authority);
  if (!datum.auditable && integrity) {
    integrity.push(`${moduleName} merchant ${m.merchant_id} is VERIFIED but carries no license number/authority — surfaced as a bare mark; the auditable datum is the MM-008 beat we still owe this record`);
  }
  return datum;
}

const POPULARITY_FIELDS = ['likes', 'hearts', 'views', 'popularity', 'like_count'];
const SPONSOR_FIELDS = ['sponsored', 'sponsorship', 'paid_rank', 'boost'];

function assertOrganic(record, moduleName, integrity) {
  for (const f of SPONSOR_FIELDS) {
    if (record[f] !== undefined) {
      throw new Error(
        `ORGANIC_TRUTH_VIOLATION: ${moduleName} record ${record.id ?? record.merchant_id ?? '?'} carries sponsorship field "${f}" — organic modules refuse payment (law 3)`,
      );
    }
  }
  for (const f of POPULARITY_FIELDS) {
    if (record[f] !== undefined) {
      integrity.push(`ignored popularity field "${f}" on ${moduleName} record ${record.id ?? record.merchant_id ?? '?'} — we never rank on applause (law 2)`);
    }
  }
}

/**
 * Merchant visual identity (owner law: VISUAL IDENTITY FOLLOWS CHOICE).
 * Hierarchy: authorized merchant media passes through untouched; absent media
 * NEVER gets fabricated — it resolves to an intentional HOUSE_FALLBACK and
 * raises MERCHANT_MEDIA_MISSING (a merchant-onboarding / asset-acquisition
 * opportunity surfaced to the owner god-eye, counted in provenance).
 */
function resolveMerchantMedia(m, integrity, flagged) {
  if (m.media && m.media.kind && m.media.kind !== 'HOUSE_FALLBACK') {
    return { kind: m.media.kind, asset: m.media.asset ?? null, rights: m.media.rights ?? null, updated_at: m.media.updated_at ?? null };
  }
  if (!flagged.has(m.merchant_id)) {
    flagged.add(m.merchant_id);
    integrity.push(`MERCHANT_MEDIA_MISSING: ${m.merchant_id} has no authorized media — house identity shown; onboarding/asset-acquisition opportunity (never fabricated)`);
  }
  return { kind: 'HOUSE_FALLBACK' };
}

function compileHeroMedia(placements, now, integrity) {
  const eligible = [];
  let excluded = 0;
  for (const p of placements ?? []) {
    const ok = p.sponsored === true && p.court_passed === true &&
      p.creative && p.creative.asset_hash &&
      p.window && Date.parse(p.window.start) <= Date.parse(now) && Date.parse(now) < Date.parse(p.window.end);
    if (ok) eligible.push({ id: p.id, advertiser: p.advertiser, creative: p.creative, label: 'Sponsored', window: p.window });
    else excluded += 1;
  }
  if (eligible.length === 0) {
    integrity.push('hero inventory UNSOLD — surfaced to owner god-eye, editorial champion shown to customers (law 4)');
    return {
      kind: 'hero_media',
      state: 'UNSOLD_INVENTORY',
      fallback: 'EDITORIAL_HERO',
      items: [],
      provenance: { eligible: 0, excluded, rank_basis: 'n/a — unsold' },
    };
  }
  eligible.sort((a, b) => Date.parse(a.window.end) - Date.parse(b.window.end) || (a.id < b.id ? -1 : 1));
  return {
    kind: 'hero_media',
    state: 'SOLD',
    items: eligible,
    provenance: { eligible: eligible.length, excluded, rank_basis: 'court-passed sponsored placements, window-end ascending; label always visible (law 3)' },
  };
}

function compileDeals(deals, merchantsById, now, integrity) {
  const eligible = [];
  let excludedStale = 0;
  let excludedUnlicensed = 0;
  let excludedInvalid = 0;
  for (const d of deals ?? []) {
    assertOrganic(d, 'deals', integrity);
    const m = merchantsById.get(d.merchant_id);
    if (!licensed(m)) { excludedUnlicensed += 1; continue; }
    if (!fresh(d.checked_at, now)) { excludedStale += 1; continue; }
    const valid = d.validity && Date.parse(d.validity.start) <= Date.parse(now) && Date.parse(now) < Date.parse(d.validity.end);
    if (!valid || typeof d.price_usd !== 'number') { excludedInvalid += 1; continue; }
    eligible.push({
      id: d.id,
      merchant_id: d.merchant_id,
      merchant_name: m.name,
      title: d.title,
      category: d.category ?? null,
      price_usd: d.price_usd,
      expires_at: d.validity.end,
      checked_at: d.checked_at,
      verified: { ...verifiedDatum(m, now, integrity, 'deals'), checked_today: true },
    });
  }
  eligible.sort((a, b) => Date.parse(a.expires_at) - Date.parse(b.expires_at)
    || Date.parse(b.checked_at) - Date.parse(a.checked_at)
    || (a.id < b.id ? -1 : 1));
  return {
    kind: 'deals',
    items: eligible,
    provenance: {
      eligible: eligible.length,
      excluded: { stale: excludedStale, unlicensed: excludedUnlicensed, invalid: excludedInvalid },
      rank_basis: 'expiry-soonest, then freshest-checked — verified urgency, never applause (law 2)',
    },
  };
}

function compileDeliveryRail(merchants, context, integrity, mediaFlagged) {
  const candidates = [];
  let excludedUnlicensed = 0;
  for (const m of merchants ?? []) {
    if (m.kind !== 'DELIVERY' && m.kind !== 'HYBRID') continue;
    assertOrganic(m, 'delivery_services', integrity);
    if (!licensed(m)) { excludedUnlicensed += 1; continue; }
    candidates.push(m);
  }
  let items;
  let rankBasis;
  if (context.neighborhood) {
    const ranked = rankDeliveryRelevance(candidates, {
      neighborhood: context.neighborhood,
      now: context.now,
    });
    items = ranked
      .filter((r) => r.verdict.status !== ELIGIBILITY.OUT_OF_AREA)
      .map((r) => {
        const facts = { ...r.verdict.facts };
        // R2: surface the VERIFIED coverage list — real market understanding,
        // never shown on fail-closed rows (an unverified claim is no claim)
        if (r.verdict.status !== ELIGIBILITY.UNVERIFIED && r.merchant.delivery?.service_area?.neighborhoods) {
          facts.serves = [...r.merchant.delivery.service_area.neighborhoods];
        }
        return {
          merchant_id: r.merchant.merchant_id,
          name: r.merchant.name,
          eligibility: r.verdict.status,
          facts,
          reasons: r.verdict.reasons,
          verified: verifiedDatum(r.merchant, context.now, integrity, 'delivery_services'),
          media: resolveMerchantMedia(r.merchant, integrity, mediaFlagged),
        };
      });
    rankBasis = `service-area eligibility for ${context.neighborhood} (D13: eligibility over radius); definite cannot-serve excluded`;
  } else {
    items = candidates
      .map((m) => ({ merchant_id: m.merchant_id, name: m.name, eligibility: 'MARKET_WIDE', facts: {}, verified: verifiedDatum(m, context.now, integrity, 'delivery_services'), media: resolveMerchantMedia(m, integrity, mediaFlagged) }))
      .sort((a, b) => (a.merchant_id < b.merchant_id ? -1 : 1));
    rankBasis = 'no customer neighborhood — market-wide listing, id-ordered; eligibility ranking activates when location is known (honest default)';
  }
  return {
    kind: 'delivery_services',
    items,
    provenance: { eligible: items.length, excluded: { unlicensed: excludedUnlicensed }, rank_basis: rankBasis },
  };
}

function compileDispensaryRail(merchants, now, integrity, mediaFlagged) {
  const items = [];
  let excludedUnlicensed = 0;
  let excludedStale = 0;
  for (const m of merchants ?? []) {
    if (m.kind !== 'DISPENSARY' && m.kind !== 'HYBRID') continue;
    assertOrganic(m, 'dispensaries', integrity);
    if (!licensed(m)) { excludedUnlicensed += 1; continue; }
    if (!fresh(m.license.checked_at, now)) { excludedStale += 1; continue; }
    items.push({
      merchant_id: m.merchant_id,
      name: m.name,
      neighborhood: m.neighborhood ?? null,
      verified: verifiedDatum(m, now, integrity, 'dispensaries'),
      media: resolveMerchantMedia(m, integrity, mediaFlagged),
    });
  }
  items.sort((a, b) => (a.merchant_id < b.merchant_id ? -1 : 1));
  return {
    kind: 'dispensaries',
    items,
    provenance: { eligible: items.length, excluded: { unlicensed: excludedUnlicensed, stale: excludedStale }, rank_basis: 'verified storefronts, id-ordered (deterministic); no applause ranking (law 2)' },
  };
}

function compileLocalQuestions(questions, integrity) {
  const items = [];
  let excludedUncited = 0;
  for (const q of questions ?? []) {
    if (!q.source_ref) { excludedUncited += 1; integrity.push(`question "${q.id}" excluded — no law-register citation (law 6, never hallucinate law)`); continue; }
    items.push({ id: q.id, question: q.question, answer: q.answer, source_ref: q.source_ref });
  }
  items.sort((a, b) => (a.id < b.id ? -1 : 1));
  return {
    kind: 'local_questions',
    items,
    provenance: { eligible: items.length, excluded: { uncited: excludedUncited }, rank_basis: 'law-register-cited questions only, id-ordered' },
  };
}

/**
 * records: { placements?, deals?, merchants?, questions? }
 * context: { market, now, neighborhood? }
 */
export function compileMarketPage(records, context) {
  if (!records || typeof records !== 'object') throw new TypeError('records required');
  if (!context || !context.market || !context.now || Number.isNaN(Date.parse(context.now))) {
    throw new TypeError('context { market, now } required');
  }
  const integrity = [];
  const mediaFlagged = new Set();
  const merchantsById = new Map((records.merchants ?? []).map((m) => [m.merchant_id, m]));

  const candidates = [
    compileHeroMedia(records.placements, context.now, integrity),
    compileDeals(records.deals, merchantsById, context.now, integrity),
    compileDeliveryRail(records.merchants, context, integrity, mediaFlagged),
    compileDispensaryRail(records.merchants, context.now, integrity, mediaFlagged),
    compileLocalQuestions(records.questions, integrity),
  ];

  // Law 7: hero_media stays even when unsold (owner signal); other empty modules vanish.
  const modules = candidates.filter((m) => m.kind === 'hero_media' || m.items.length > 0);

  return Object.freeze({
    market: context.market,
    neighborhood: context.neighborhood ?? null,
    generated_at: new Date(context.now).toISOString(),
    modules,
    integrity: Object.freeze(integrity),
    laws: Object.freeze([
      'verified-only surface', 'no fabricated demand', 'sponsorship explicit and quarantined',
      'unsold inventory is owner intelligence', 'delivery is first-class', 'local questions cite law',
      'no scaffolds', 'provenance everywhere',
    ]),
  });
}
