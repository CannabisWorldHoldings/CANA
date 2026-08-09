/**
 * Entity Genome — the canonical market entity graph (PDF directive D8 / M-014).
 *
 * TRANSPLANT T1 (ONE GRAPH): imported from the ORDERWEEDDC sandbox forge,
 * packages/reality-learning/src/entity-genome.mjs @ commit 2680e88 (15/15
 * tests). Lands as a lib per TRANSPLANT_PLAN.md — the workspace package set
 * is court-protected (tests/workspace-integrity).
 *
 * "Backend universe > customer navigation." The three-sided company reasons
 * over ONE set of entities; customer surfaces (market-page-compiler,
 * discovery-command) are projections of this graph, never the source of truth.
 *
 * Owner-cited sensing lesson (SL-001): the OWNER found Doctors, not Growth
 * Watch — because our genome was built from two competitors' obvious homepage
 * surfaces. This module makes the entity set explicit and extensible so a
 * newly-discovered class is a data change, not a re-architecture.
 *
 * Laws:
 * 1. VERIFIED-TRUTH ENVELOPE: any entity that can mislead about legality or
 *    fulfilment (merchant, deal, service_area) MUST carry a verified envelope
 *    { verified: bool, checked_at }. Missing/false verification is allowed to
 *    EXIST in the graph (owner god-eye needs to see it) but is marked
 *    unverified — customer projections exclude it (fail closed downstream).
 *    T2 VOCABULARY ADOPTION: the crossing status is the HOST's —
 *    DATA_STATUS.VERIFIED_CURRENT (data-status.mjs). Canonical seams win;
 *    the forge-era 'VERIFIED' literal does NOT cross (no aliases, one truth).
 * 2. SPONSORSHIP IS QUARANTINED: only the sponsored_media_unit class may carry
 *    sponsorship. Any other entity with a sponsorship field is INVALID — hidden
 *    organic truth is not for sale (mirrors market-page-compiler law 3).
 * 3. NEVER INVENT: required fields absent → the entity is INVALID, never
 *    defaulted. Unknown class → INVALID. We refuse to fabricate structure.
 * 4. STABLE IDENTITY: every entity hashes to a deterministic digest over its
 *    canonical form (reuses reality.mjs stableDigest) — identity is content,
 *    not a mutable label.
 * 5. RELATIONSHIPS ARE TYPED: a DEAL resolves to merchant / product-or-
 *    category / campaign / validity / geography / claim / outcome (M-011); a
 *    dangling or mistyped reference is INVALID.
 */
import { createHash } from 'node:crypto';
import { DATA_STATUS } from './data-status.mjs';

/* Inlined from the forge's reality.mjs (provenance: ORDERWEEDDC sandbox
 * packages/reality-learning/src/reality.mjs @ commit 2680e88) so T1 lands
 * self-contained — no new workspace package, no cross-package import.
 * When the reality-learning organ transplants later, these collapse back
 * to a single import without changing any digest (same canonical form). */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])]));
  }
  return value;
}
export function stableDigest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
export function parseTime(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('timestamp required');
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error('invalid timestamp');
  return ms;
}

export const ENTITY_CLASSES = new Set([
  'merchant', 'doctor_provider', 'brand', 'product', 'category',
  'strain_cultivar', 'deal', 'campaign', 'menu', 'amenity',
  'neighborhood', 'service_area', 'guide', 'article', 'faq_answer',
  'sponsored_media_unit',
]);

// Canonical merchant kinds (D8). Rail-facing aliases from the customer
// projections map in so the compiler's terms stay valid at the boundary.
export const MERCHANT_KINDS = new Set([
  'STOREFRONT', 'DELIVERY_OPERATOR', 'INTERNET_RETAILER', 'HYBRID',
]);
const MERCHANT_KIND_ALIASES = Object.freeze({
  DISPENSARY: 'STOREFRONT',
  DELIVERY: 'DELIVERY_OPERATOR',
  STORE: 'STOREFRONT',
  HYBRID: 'HYBRID',
});
export function normalizeMerchantKind(kind) {
  if (MERCHANT_KINDS.has(kind)) return kind;
  return MERCHANT_KIND_ALIASES[kind] ?? null;
}

// Classes whose falsehood can mislead about legality/fulfilment → envelope required (law 1).
const ENVELOPE_REQUIRED = new Set(['merchant', 'deal', 'service_area', 'doctor_provider']);
const SPONSORSHIP_FIELDS = ['sponsored', 'sponsorship', 'paid_rank', 'boost'];

const REQUIRED = Object.freeze({
  merchant: ['id', 'name', 'kind'],
  doctor_provider: ['id', 'name'],
  brand: ['id', 'name'],
  product: ['id', 'name', 'category_ref'],
  category: ['id', 'label'],
  strain_cultivar: ['id', 'name'],
  deal: ['id', 'merchant_ref', 'title', 'validity'],
  campaign: ['id', 'merchant_ref', 'objective'],
  menu: ['id', 'merchant_ref'],
  amenity: ['id', 'label'],
  neighborhood: ['id', 'name'],
  service_area: ['id', 'merchant_ref', 'neighborhoods'],
  guide: ['id', 'title'],
  article: ['id', 'title'],
  faq_answer: ['id', 'question', 'answer', 'source_ref'], // law: cite, never hallucinate
  sponsored_media_unit: ['id', 'placement_class', 'creative', 'window', 'sponsored'],
});

function hasEnvelope(e) {
  return e.verified && typeof e.verified === 'object'
    && typeof e.verified.status === 'string'
    && typeof e.verified.checked_at === 'string'
    && Number.isFinite(Date.parse(e.verified.checked_at));
}

/**
 * Validate one entity. Returns { valid, entityClass, verified, reasons,
 * digest }. Throwing is reserved for law 2/3 hard violations (structural
 * corruption); mere non-verification is a soft, reported state (law 1).
 */
export function validateEntity(entity) {
  if (!entity || typeof entity !== 'object') throw new TypeError('entity object required');
  const cls = entity.class;
  const reasons = [];
  if (!ENTITY_CLASSES.has(cls)) throw new Error(`ENTITY_GENOME: unknown class "${cls}" — we never fabricate structure (law 3)`);

  // law 2: sponsorship quarantine
  if (cls !== 'sponsored_media_unit') {
    for (const f of SPONSORSHIP_FIELDS) {
      if (entity[f] !== undefined) {
        throw new Error(`ENTITY_GENOME: ${cls} carries sponsorship field "${f}" — only sponsored_media_unit may (law 2)`);
      }
    }
  }

  // law 3: required fields
  for (const f of REQUIRED[cls]) {
    if (entity[f] === undefined || entity[f] === null || entity[f] === '') {
      throw new Error(`ENTITY_GENOME: ${cls} missing required field "${f}" — never defaulted (law 3)`);
    }
  }

  // merchant kind must be canonical or a known alias
  if (cls === 'merchant' && normalizeMerchantKind(entity.kind) === null) {
    throw new Error(`ENTITY_GENOME: merchant kind "${entity.kind}" is not in the genome (law 3)`);
  }

  // sponsored media unit must be genuinely sponsored + court-passed + windowed (quarantine gate)
  if (cls === 'sponsored_media_unit') {
    if (entity.sponsored !== true) throw new Error('ENTITY_GENOME: sponsored_media_unit must set sponsored:true (law 2)');
    if (entity.court_passed !== true) throw new Error('ENTITY_GENOME: sponsored_media_unit must be court_passed (law 2)');
    if (!entity.window || !entity.window.start || !entity.window.end) throw new Error('ENTITY_GENOME: sponsored_media_unit requires a window (law 2)');
  }

  // law 1: verified-truth envelope (soft — reported, not thrown)
  let verified = true;
  if (ENVELOPE_REQUIRED.has(cls)) {
    if (!hasEnvelope(entity)) {
      verified = false;
      reasons.push(`${cls} lacks a verified envelope — exists for owner god-eye, excluded from customer projections (law 1)`);
    } else if (entity.verified.status !== DATA_STATUS.VERIFIED_CURRENT) {
      verified = false;
      reasons.push(`${cls} envelope status is ${entity.verified.status}, not ${DATA_STATUS.VERIFIED_CURRENT} (law 1 — host data-status vocabulary, T2 adoption)`);
    }
  }

  return Object.freeze({
    valid: true,
    entityClass: cls,
    verified,
    reasons: Object.freeze(reasons),
    digest: stableDigest(entity),
  });
}

/**
 * Validate a typed reference resolves within the graph (law 5).
 * refKey e.g. 'merchant_ref' must point at an id present in idIndex with the
 * expected class.
 */
function assertRef(entity, refKey, expectedClass, idIndex) {
  const ref = entity[refKey];
  const target = idIndex.get(ref);
  if (!target) throw new Error(`ENTITY_GENOME: ${entity.class}.${refKey} "${ref}" is dangling (law 5)`);
  if (target.class !== expectedClass) {
    throw new Error(`ENTITY_GENOME: ${entity.class}.${refKey} points at a ${target.class}, expected ${expectedClass} (law 5)`);
  }
  return target;
}

/**
 * Validate a whole entity graph. Returns { entities: [{entity, result}],
 * verifiedCount, unverifiedCount, byClass }. Throws on any structural (law
 * 2/3/5) violation; soft non-verification is counted, not thrown.
 */
export function validateEntityGraph(entities) {
  if (!Array.isArray(entities)) throw new TypeError('entities array required');
  const idIndex = new Map();
  for (const e of entities) {
    if (!e || !e.id) throw new Error('ENTITY_GENOME: every entity needs an id');
    if (idIndex.has(e.id)) throw new Error(`ENTITY_GENOME: duplicate id "${e.id}"`);
    idIndex.set(e.id, e);
  }
  const results = entities.map((e) => ({ entity: e, result: validateEntity(e) }));

  // law 5: typed relationships resolve
  for (const e of entities) {
    if (e.class === 'deal') {
      assertRef(e, 'merchant_ref', 'merchant', idIndex);
      if (e.campaign_ref) assertRef(e, 'campaign_ref', 'campaign', idIndex);
      if (e.product_ref) assertRef(e, 'product_ref', 'product', idIndex);
      else if (e.category_ref) assertRef(e, 'category_ref', 'category', idIndex);
      if (!e.validity || !e.validity.start || !e.validity.end) throw new Error('ENTITY_GENOME: deal.validity requires start+end (law 5)');
      parseTime(e.validity.start); parseTime(e.validity.end);
    }
    if (e.class === 'service_area') assertRef(e, 'merchant_ref', 'merchant', idIndex);
    if (e.class === 'menu') assertRef(e, 'merchant_ref', 'merchant', idIndex);
    if (e.class === 'campaign') assertRef(e, 'merchant_ref', 'merchant', idIndex);
    if (e.class === 'product' && e.brand_ref) assertRef(e, 'brand_ref', 'brand', idIndex);
  }

  const byClass = {};
  let verifiedCount = 0;
  let unverifiedCount = 0;
  for (const { entity, result } of results) {
    byClass[entity.class] = (byClass[entity.class] ?? 0) + 1;
    if (result.verified) verifiedCount += 1; else unverifiedCount += 1;
  }
  return Object.freeze({ entities: results, verifiedCount, unverifiedCount, byClass: Object.freeze(byClass) });
}
