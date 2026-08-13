/**
 * Stable ASK public surface.
 *
 * Existing Retailer consumers and canonical customer Reality consumers share
 * this import path while their implementations stay separated by truth source.
 */

export {
  CUSTOMER_DISCOVERY_MARKETS,
  CUSTOMER_DISCOVERY_PROJECTION_VERSION,
  CUSTOMER_DISCOVERY_REALITY_GATE_VERSION,
  resolveCustomerMarketContext,
} from './customer-discovery-contract.mjs';
export {
  answerCustomerDiscovery,
  answerCustomerDiscoveryFromReality,
  resolveCustomerDiscovery,
  resolveCustomerDiscoveryIntent,
} from './customer-discovery.mjs';
export { projectCustomerDiscovery } from './customer-discovery-projection.mjs';
export { answerIntent, buildCandidateWhere } from './legacy-retailer-answer.mjs';
