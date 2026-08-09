/**
 * TRANSPLANT T4 (THE BETTER SEARCH): from the forge @ e779707 (10/10 there).
 * Upstream truth gates (genome/projection/service-area) already speak the
 * host's DATA_STATUS.VERIFIED_CURRENT — adopted in T2/T3.
 *
 * Discovery Resolution — the D15/D12 SECOND junction: a compiled discovery
 * command resolved against the ONE entity graph into the verified-eligible
 * merchant + deal set.
 *
 * "flower delivered near Navy Yard tonight" →
 *   compileDiscoveryCommand (language → structured intent, courted 27/27)
 *   → projectGraphToRecords (genome laws at the boundary, courted 13/13)
 *   → THIS: which licensed merchants CAN serve that intent, right now,
 *     provably — and which parts of the intent cannot be resolved yet.
 *
 * Laws:
 * 1. DO NOT INVENT (PDF p.20): any intent facet the graph cannot verify is
 *    returned in `unresolved` with a reason — free-text effect-intent
 *    ("relaxing"), storefront open-state without verified hours, etc. We
 *    narrow results ONLY on verified facts; unverifiable facets never filter
 *    and never rank.
 * 2. ELIGIBILITY OVER RADIUS (D13): delivery intent + neighborhood resolves
 *    through verified service areas; definite cannot-serve is excluded;
 *    unknown fails closed to UNVERIFIED and ranks below eligible.
 * 3. INTENT PERSISTS (D12): the resolution carries the compiled command it
 *    answered, so the next surface (list/map/merchant page) inherits the
 *    SAME intent object — no context restart.
 * 4. DETERMINISTIC, LEVEL 0: same command + graph + clock → same resolution.
 */
import { compileDiscoveryCommand } from './discovery-command.mjs';
import { projectGraphToRecords } from './market-graph-projection.mjs';
import { evaluateDeliveryEligibility, isOpenAt, ELIGIBILITY } from './service-area.mjs';

const RAIL_BY_BUSINESS = Object.freeze({
  delivery: ['DELIVERY', 'HYBRID'],
  dispensary: ['DISPENSARY', 'HYBRID'],
});

const ELIGIBILITY_RANK = Object.freeze({
  ELIGIBLE_OPEN: 0, ELIGIBLE_CLOSED: 1, UNVERIFIED: 2, MARKET_WIDE: 1.5,
});

export function resolveDiscovery(text, entities, context) {
  if (!context || !context.now || Number.isNaN(Date.parse(context.now))) {
    throw new TypeError('context { now } required');
  }
  const command = compileDiscoveryCommand(text, { now: context.now });
  const { records, projection } = projectGraphToRecords(entities, { now: context.now });
  const unresolved = [];

  // law 1: free text has no verified resolution path yet — surfaced, never a filter
  if (command.query_text) {
    unresolved.push(`free text "${command.query_text}" has no verified resolution path yet (strain/effect graph absent) — surfaced, never guessed, never used to narrow results`);
  }

  // candidate merchants by stated business type (unstated → all railed kinds)
  const kinds = command.business_type ? RAIL_BY_BUSINESS[command.business_type] : ['DELIVERY', 'DISPENSARY', 'HYBRID'];
  let merchants = records.merchants.filter((m) => kinds.includes(m.kind));

  const deliveryIntent = command.business_type === 'delivery'
    || (command.business_type === null && command.location.kind === 'NEIGHBORHOOD');

  const rows = merchants.map((m) => {
    let eligibility = 'MARKET_WIDE';
    let facts = {};
    let reasons = [];
    if (deliveryIntent && command.location.kind === 'NEIGHBORHOOD' && (m.kind === 'DELIVERY' || m.kind === 'HYBRID')) {
      const verdict = evaluateDeliveryEligibility(m, { neighborhood: command.location.name, now: context.now });
      eligibility = verdict.status;
      facts = verdict.facts;
      reasons = [...verdict.reasons];
    } else if (m.kind === 'DISPENSARY' || (m.kind === 'HYBRID' && !deliveryIntent)) {
      // storefront open-state: only claim it with verified hours (law 1)
      if (Array.isArray(m.hours) && m.hours.length > 0) {
        eligibility = isOpenAt(m.hours, context.now) ? 'ELIGIBLE_OPEN' : 'ELIGIBLE_CLOSED';
        reasons.push('open-state from verified storefront hours');
      } else {
        reasons.push('storefront hours not in the verified graph — open-state unresolved, not guessed');
      }
    }
    return { merchant_id: m.merchant_id, name: m.name, kind: m.kind, eligibility, facts, reasons, verified: { licensed: true, license: m.license } };
  });

  // law 2: definite cannot-serve excluded on delivery intent
  let resolvedMerchants = rows.filter((r) => r.eligibility !== ELIGIBILITY.OUT_OF_AREA);
  // time intent: OPEN_NOW / TONIGHT keep only merchants NOT known-closed; unknown stays (fail-open on unknown would be inventing — we keep it but ranked below, with its reason visible)
  if (command.time.kind !== 'ANYTIME') {
    resolvedMerchants = resolvedMerchants.filter((r) => r.eligibility !== 'ELIGIBLE_CLOSED');
    unresolved.push(`"${command.time.kind === 'TONIGHT' ? 'tonight' : 'open now'}" applied only where verified hours exist; merchants with unknown hours remain listed with the unknown surfaced`);
  }
  resolvedMerchants.sort((a, b) => (ELIGIBILITY_RANK[a.eligibility] - ELIGIBILITY_RANK[b.eligibility]) || (a.merchant_id < b.merchant_id ? -1 : 1));

  // deals: only for surfaced merchants; category + price + validity are verified facts
  const surfacedIds = new Set(resolvedMerchants.map((r) => r.merchant_id));
  let deals = records.deals.filter((d) => surfacedIds.has(d.merchant_id));
  deals = deals.filter((d) => {
    const validNow = d.validity && Date.parse(d.validity.start) <= Date.parse(context.now) && Date.parse(context.now) < Date.parse(d.validity.end);
    if (!validNow) return false;
    if (command.category && d.category !== command.category) return false;
    if (command.price_cap != null && !(typeof d.price_usd === 'number' && d.price_usd <= command.price_cap)) return false;
    return true;
  });
  deals.sort((a, b) => Date.parse(a.validity.end) - Date.parse(b.validity.end) || (a.id < b.id ? -1 : 1));

  if (command.category && deals.length === 0 && command.wants_deals) {
    unresolved.push(`no verified ${command.category} deals match right now — shown as none, never padded`);
  }

  return Object.freeze({
    command, // law 3: intent persists to the next surface
    merchants: resolvedMerchants,
    deals,
    unresolved: Object.freeze(unresolved),
    provenance: Object.freeze({
      graph_excluded_unverified: projection.excluded_unverified.length,
      considered: merchants.length,
      surfaced: resolvedMerchants.length,
      rank_basis: 'verified eligibility class, then id — never applause, never payment (laws 1-2)',
    }),
  });
}
