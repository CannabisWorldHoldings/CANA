import { MARKET_CONTRACT_REGISTRY } from '../reality/market-contract-registry.mjs';

export const CUSTOMER_DISCOVERY_PROJECTION_VERSION = 'cana-customer-discovery-projection/v1';
export const CUSTOMER_DISCOVERY_REALITY_GATE_VERSION = 'verified-reality-current-claim+subject-cohort/v1';

const MARKET_JURISDICTIONS = Object.freeze({
  'US-DC': 'DC',
  'US-MD': 'MD',
  'US-VA': 'VA',
});

export const CUSTOMER_DISCOVERY_MARKETS = Object.freeze(Object.keys(MARKET_JURISDICTIONS));

export const CUSTOMER_REALITY_RULES = Object.freeze({
  'US-DC': Object.freeze({
    required: Object.freeze([
      'facility_name',
      'license_number',
      'license_status',
      'operating_status',
      'regulated_address',
    ]),
    listing: null,
  }),
  'US-MD': Object.freeze({
    required: Object.freeze(['facility_name', 'mca_registry_listing_exists', 'regulated_address']),
    listing: 'mca_registry_listing_exists',
  }),
  'US-VA': Object.freeze({
    required: Object.freeze(['address', 'cca_registry_listing_exists', 'name']),
    listing: 'cca_registry_listing_exists',
  }),
});

export function customerDiscoveryFailure(code) {
  throw new Error(code);
}

export function projectionClock(asOf) {
  const clock = asOf instanceof Date ? asOf : new Date(asOf);
  if (!Number.isFinite(clock.getTime())) customerDiscoveryFailure('CANA_CUSTOMER_DISCOVERY_CLOCK_INVALID');
  return clock;
}

export function resolveCustomerMarketContext(marketId) {
  if (!Object.hasOwn(MARKET_JURISDICTIONS, marketId)) {
    customerDiscoveryFailure('CANA_CUSTOMER_DISCOVERY_MARKET_UNSUPPORTED');
  }
  const contract = MARKET_CONTRACT_REGISTRY.find((entry) => entry.market_id === marketId);
  if (!contract) customerDiscoveryFailure('CANA_CUSTOMER_DISCOVERY_MARKET_CONTRACT_MISSING');
  return Object.freeze({
    state: 'KNOWN',
    market_id: marketId,
    jurisdiction_code: MARKET_JURISDICTIONS[marketId],
    evidence: Object.freeze({
      source_key: contract.source_key,
      source_id: contract.source_id,
      source_url: contract.source_url,
      contract_digest: contract.contract_digest,
    }),
  });
}

export function admittedMarketContext(market) {
  const expected = resolveCustomerMarketContext(market?.market_id);
  if (
    market?.state !== expected.state
    || market?.jurisdiction_code !== expected.jurisdiction_code
    || market?.evidence?.source_key !== expected.evidence.source_key
    || market?.evidence?.source_id !== expected.evidence.source_id
    || market?.evidence?.source_url !== expected.evidence.source_url
    || market?.evidence?.contract_digest !== expected.evidence.contract_digest
  ) customerDiscoveryFailure('CANA_CUSTOMER_DISCOVERY_MARKET_CONTEXT_INVALID');
  return expected;
}
