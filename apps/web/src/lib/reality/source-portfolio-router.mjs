import { ABCA_LIVE_CONTRACT } from './live-abca-adapter.mjs';
import { DC_ABCA_SOURCE } from './reality-compiler.mjs';

export const LIVE_SOURCE_REGISTRY = Object.freeze([
  Object.freeze({
    source_key: ABCA_LIVE_CONTRACT.sourceKey,
    source_id: ABCA_LIVE_CONTRACT.sourceId,
    source_url: ABCA_LIVE_CONTRACT.layerUrl,
    source_class: DC_ABCA_SOURCE.authority_class,
    independence_group: 'dc-abca-dcgis-layer-31',
    authoritative_predicates: DC_ABCA_SOURCE.authoritative_predicates,
    live_admitted: true,
    credential_mode: 'PUBLIC_NONE',
    fixed_origin: true,
  }),
]);

export function routeRealitySource({ predicate, candidates = LIVE_SOURCE_REGISTRY, maximumCostCents = 0 }) {
  if (typeof predicate !== 'string' || predicate.length === 0
    || !Array.isArray(candidates)
    || !Number.isInteger(maximumCostCents)
    || maximumCostCents < 0) {
    throw new Error('CANA_REALITY_SOURCE_ROUTE_INPUT_INVALID');
  }
  const eligible = candidates.filter((candidate) => (
    candidate?.live_admitted === true
    && candidate.fixed_origin === true
    && Array.isArray(candidate.authoritative_predicates)
    && candidate.authoritative_predicates.includes(predicate)
    && ['HEALTHY', 'PROBE_ALLOWED', undefined].includes(candidate.circuit_state)
    && Number.isInteger(candidate.estimated_cost_cents ?? 0)
    && (candidate.estimated_cost_cents ?? 0) <= maximumCostCents
  ));
  eligible.sort((left, right) => (left.estimated_cost_cents ?? 0) - (right.estimated_cost_cents ?? 0)
    || Number(right.reliability_score ?? 0) - Number(left.reliability_score ?? 0)
    || String(left.source_key).localeCompare(String(right.source_key)));
  if (eligible.length === 0) {
    return Object.freeze({
      state: 'UNKNOWN',
      reason: 'NO_ADMITTED_AUTHORITATIVE_SOURCE',
      predicate,
      selected_source: null,
      authority_mutations: 0,
    });
  }
  const selected = eligible[0];
  return Object.freeze({
    state: 'SELECTED',
    predicate,
    selected_source: selected.source_key,
    source_id: selected.source_id,
    independence_group: selected.independence_group,
    estimated_cost_cents: selected.estimated_cost_cents ?? 0,
    authority_basis: selected.source_class,
    authority_mutations: 0,
  });
}
