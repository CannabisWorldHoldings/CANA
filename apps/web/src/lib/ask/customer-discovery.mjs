import { loadCurrentClaimDecisions } from '../reality/market-claim-adapter.mjs';
import { compileIntent } from './intent-ir.mjs';
import {
  CUSTOMER_UNSUPPORTED_DIMENSIONS,
  resolveCustomerMarketContext,
} from './customer-discovery-contract.mjs';
import { projectCustomerDiscovery } from './customer-discovery-projection.mjs';
import { answerVerifiedRealityIntent } from './customer-reality-answer.mjs';

export async function resolveCustomerDiscoveryIntent(prisma, {
  intent,
  marketId,
  tenantDomain,
  now = new Date(),
}) {
  const market = resolveCustomerMarketContext(marketId);
  const locationKnown = intent?.dimensions?.location?.status === 'KNOWN';
  const unsupportedKnown = CUSTOMER_UNSUPPORTED_DIMENSIONS
    .some((name) => intent?.dimensions?.[name]?.status === 'KNOWN');
  const claimDecisions = locationKnown && !unsupportedKnown
    ? await loadCurrentClaimDecisions(prisma, {
        tenant: tenantDomain,
        sourceKey: market.evidence.source_key,
        asOf: now,
      })
    : [];
  const answer = answerVerifiedRealityIntent({ intent, market, tenantDomain, claimDecisions, now });
  const projection = projectCustomerDiscovery({ intent, market, answer, asOf: now });
  return Object.freeze({ intent, market, answer, projection });
}

export async function resolveCustomerDiscovery(prisma, {
  rawQuery,
  marketId,
  tenantDomain,
  now = new Date(),
}) {
  const intent = compileIntent(rawQuery, { now, marketId });
  return resolveCustomerDiscoveryIntent(prisma, { intent, marketId, tenantDomain, now });
}

export async function answerCustomerDiscovery(prisma, options) {
  return (await resolveCustomerDiscovery(prisma, options)).projection;
}

export function answerCustomerDiscoveryFromReality({
  rawQuery,
  marketId,
  tenantDomain,
  claimDecisions,
  now = new Date(),
}) {
  const market = resolveCustomerMarketContext(marketId);
  const intent = compileIntent(rawQuery, { now, marketId });
  const answer = answerVerifiedRealityIntent({ intent, market, tenantDomain, claimDecisions, now });
  return projectCustomerDiscovery({ intent, market, answer, asOf: now });
}
