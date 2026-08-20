/**
 * TRANSPLANT T2 (PROJECTION): imported from the ORDERWEEDDC sandbox forge
 * apps/web/src/lib/market-graph-projection.mjs @ commit 7e792ce (13/13 there;
 * the 6 compiler-junction tests travel with T3, which brings the compiler).
 *
 * Market Graph Projection — the D12 junction: ONE entity graph (D8 genome,
 * ./entity-genome.mjs) projected into the market-page compiler's
 * records. The graph is the source of truth; every customer surface is a
 * projection of it — this module is the first wired junction of the ONE
 * DISCOVERY GRAPH.
 *
 * Laws enforced AT THE BOUNDARY:
 * 1. UNVERIFIED NEVER CROSSES (genome law 1): entities lacking a VERIFIED_CURRENT
 *    envelope (host data-status vocabulary, adopted in T2) exist in the graph for the owner god-eye but are EXCLUDED from
 *    customer projections here — and the exclusion is counted, never silent.
 * 2. STRUCTURE IS PRE-VALIDATED: validateEntityGraph runs first; a dangling
 *    or mistyped reference, sponsorship on an organic entity, or an unknown
 *    class THROWS before a single record is produced (fail closed).
 * 3. HONEST NON-PROJECTION: a verified entity whose class has no customer
 *    rail yet (e.g. INTERNET_RETAILER) is listed as unprojected WITH a
 *    reason — we never fake a surface for it and never drop it silently.
 * 4. THE AUDITABLE DATUM TRAVELS (MM-008): the merchant's license record
 *    (number/authority/source_url) rides through the projection so the
 *    compiler can render click-through verification; the envelope supplies
 *    status + checked_at (the machine-checked truth gate).
 * 5. DETERMINISTIC: same graph + clock → identical records.
 */
import { validateEntityGraph, normalizeMerchantKind } from './entity-genome.mjs';

// canonical genome kinds → the compiler's rail vocabulary
const KIND_TO_RAIL = Object.freeze({
  STOREFRONT: 'DISPENSARY',
  DELIVERY_OPERATOR: 'DELIVERY',
  HYBRID: 'HYBRID',
  // INTERNET_RETAILER: no physical rail on the market page yet — law 3
});

const CONSUMED_CLASSES = Object.freeze([
  'merchant', 'service_area', 'deal', 'faq_answer', 'sponsored_media_unit', 'category',
]);

export function projectGraphToRecords(entities, context) {
  if (!context || !context.now || Number.isNaN(Date.parse(context.now))) {
    throw new TypeError('context { now } required');
  }
  // law 2: structural validation first — throws on genome law violations
  const graph = validateEntityGraph(entities);

  const projection = {
    excluded_unverified: [],
    unprojected: [],
    reserved_for_other_surfaces: [],
    consumed_classes: CONSUMED_CLASSES,
  };

  const categoriesById = new Map();
  const serviceAreasByMerchant = new Map();
  const rows = graph.entities;

  // pass 1: reference data (categories) + verified service areas
  for (const { entity: e, result: r } of rows) {
    if (e.class === 'category') categoriesById.set(e.id, e);
    if (e.class === 'service_area') {
      if (!r.verified) { projection.excluded_unverified.push({ id: e.id, class: e.class }); continue; }
      serviceAreasByMerchant.set(e.merchant_ref, e);
    }
  }

  // pass 2: merchants (law 1 gate + law 3 honest non-projection + law 4 datum)
  const merchants = [];
  for (const { entity: e, result: r } of rows) {
    if (e.class !== 'merchant') continue;
    if (!r.verified) { projection.excluded_unverified.push({ id: e.id, class: e.class }); continue; }
    const canonical = normalizeMerchantKind(e.kind);
    const rail = KIND_TO_RAIL[canonical];
    if (!rail) {
      projection.unprojected.push({ id: e.id, class: 'merchant', kind: canonical, reason: 'no customer rail for this merchant kind yet — surfaced honestly, never faked (law 3)' });
      continue;
    }
    // law 4: envelope is the truth gate; license record is the auditable datum
    const license = { status: e.verified.status, checked_at: e.verified.checked_at, ...(e.license ?? {}) };
    const m = {
      merchant_id: e.id,
      name: e.name,
      kind: rail,
      license,
      neighborhood: e.neighborhood ?? null,
    };
    if (typeof e.distance_miles === 'number') m.distance_miles = e.distance_miles;
    const sa = serviceAreasByMerchant.get(e.id);
    if (sa) {
      m.delivery = {
        service_area: { neighborhoods: sa.neighborhoods },
        verified_at: sa.verified.checked_at,
      };
      if (Array.isArray(sa.hours)) m.delivery.hours = sa.hours;
      if (typeof sa.minimum_usd === 'number') m.delivery.minimum_usd = sa.minimum_usd;
      if (typeof sa.fee_usd === 'number') m.delivery.fee_usd = sa.fee_usd;
      if (Array.isArray(sa.eta_minutes)) m.delivery.eta_minutes = sa.eta_minutes;
    }
    merchants.push(m);
  }

  // pass 3: deals / questions / placements
  const deals = [];
  const questions = [];
  const placements = [];
  for (const { entity: e, result: r } of rows) {
    if (e.class === 'deal') {
      if (!r.verified) { projection.excluded_unverified.push({ id: e.id, class: e.class }); continue; }
      const cat = e.category_ref ? categoriesById.get(e.category_ref) : null;
      const d = {
        id: e.id,
        merchant_id: e.merchant_ref,
        title: e.title,
        category: cat ? String(cat.label).toLowerCase() : (e.category ?? null),
        checked_at: e.verified.checked_at,
        validity: e.validity,
      };
      if (typeof e.price_usd === 'number') d.price_usd = e.price_usd;
      deals.push(d);
    } else if (e.class === 'faq_answer') {
      questions.push({ id: e.id, question: e.question, answer: e.answer, source_ref: e.source_ref });
    } else if (e.class === 'sponsored_media_unit') {
      placements.push({
        id: e.id,
        advertiser: e.advertiser ?? e.merchant_ref ?? null,
        sponsored: true,
        court_passed: e.court_passed === true,
        creative: e.creative,
        window: e.window,
        placement_class: e.placement_class,
      });
    } else if (!CONSUMED_CLASSES.includes(e.class)) {
      projection.reserved_for_other_surfaces.push({ id: e.id, class: e.class });
    }
  }

  return Object.freeze({
    records: Object.freeze({ merchants, deals, questions, placements }),
    projection: Object.freeze({
      ...projection,
      counts: Object.freeze({
        merchants: merchants.length,
        deals: deals.length,
        questions: questions.length,
        placements: placements.length,
        excluded_unverified: projection.excluded_unverified.length,
        unprojected: projection.unprojected.length,
      }),
      graph_by_class: graph.byClass,
      graph_unverified: graph.unverifiedCount,
    }),
  });
}
