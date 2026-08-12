import { ABCA_LIVE_CONTRACT } from './live-abca-adapter.mjs';
import { VA_CCA_LIVE_CONTRACT } from './live-va-cca-adapter.mjs';
import { MD_MCA_LIVE_CONTRACT } from './live-md-mca-adapter.mjs';
import { DC_ABCA_SOURCE, VA_CCA_SOURCE, MD_MCA_SOURCE } from './reality-compiler.mjs';

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
  Object.freeze({
    source_key: VA_CCA_LIVE_CONTRACT.sourceKey,
    source_id: VA_CCA_LIVE_CONTRACT.sourceId,
    source_url: VA_CCA_LIVE_CONTRACT.pageUrl,
    source_class: VA_CCA_SOURCE.authority_class,
    independence_group: 'va-cca-registry-pages',
    authoritative_predicates: VA_CCA_SOURCE.authoritative_predicates,
    live_admitted: true,
    credential_mode: 'PUBLIC_NONE',
    fixed_origin: true,
  }),
  Object.freeze({
    source_key: MD_MCA_LIVE_CONTRACT.sourceKey,
    source_id: MD_MCA_LIVE_CONTRACT.sourceId,
    source_url: MD_MCA_LIVE_CONTRACT.pageUrl,
    source_class: MD_MCA_SOURCE.authority_class,
    independence_group: 'md-mca-registry-pages',
    authoritative_predicates: MD_MCA_SOURCE.authoritative_predicates,
    live_admitted: true,
    credential_mode: 'PUBLIC_NONE',
    fixed_origin: true,
  }),
]);

function admittedCandidate(candidate) {
  const registered = LIVE_SOURCE_REGISTRY.find((source) => source.source_key === candidate?.source_key);
  if (!registered
    || candidate.source_id !== registered.source_id
    || candidate.source_url !== registered.source_url
    || candidate.source_class !== registered.source_class
    || candidate.independence_group !== registered.independence_group
    || candidate.live_admitted !== registered.live_admitted
    || candidate.fixed_origin !== registered.fixed_origin
    || JSON.stringify(candidate.authoritative_predicates) !== JSON.stringify(registered.authoritative_predicates)) {
    return null;
  }
  return {
    ...registered,
    circuit_state: candidate.circuit_state,
    estimated_cost_cents: candidate.estimated_cost_cents,
    reliability_score: candidate.reliability_score,
  };
}

export function routeRealitySource({ predicate, candidates = LIVE_SOURCE_REGISTRY, maximumCostCents = 0 }) {
  if (typeof predicate !== 'string' || predicate.length === 0
    || !Array.isArray(candidates)
    || !Number.isInteger(maximumCostCents)
    || maximumCostCents < 0) {
    throw new Error('CANA_REALITY_SOURCE_ROUTE_INPUT_INVALID');
  }
  const eligible = candidates.map(admittedCandidate).filter((candidate) => (
    candidate !== null
    && candidate.live_admitted === true
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
