import { loadCurrentClaimDecisions } from '../reality/market-claim-adapter.mjs';
import { compileIntent } from './intent-ir.mjs';
import {
  CUSTOMER_DISCOVERY_MARKETS,
  CUSTOMER_UNSUPPORTED_DIMENSIONS,
  resolveCustomerMarketContext,
} from './customer-discovery-contract.mjs';
import {
  projectCustomerDiscovery,
  projectCustomerDiscoveryCandidate,
} from './customer-discovery-projection.mjs';
import {
  answerVerifiedRealityIntent,
  selectVerifiedRealityMerchant,
} from './customer-reality-answer.mjs';

export function resolveCustomerMerchantProfileFromReality({
  merchantId,
  marketId,
  tenantDomain,
  claimDecisions,
  now = new Date(),
}) {
  const market = resolveCustomerMarketContext(marketId);
  const resolved = selectVerifiedRealityMerchant({
    merchantId,
    market,
    tenantDomain,
    claimDecisions,
    now,
  });
  return resolved ? Object.freeze({
    market,
    intent: resolved.intent,
    result: projectCustomerDiscoveryCandidate({
      candidate: resolved.candidate,
      intent: resolved.intent,
      market,
      asOf: now,
    }),
  }) : null;
}

export async function resolveCustomerMerchantProfile(prisma, {
  merchantId,
  marketId = null,
  tenantDomain,
  now = new Date(),
}) {
  const marketIds = marketId === null ? CUSTOMER_DISCOVERY_MARKETS : [marketId];
  let selected = null;
  for (const candidateMarketId of marketIds) {
    const market = resolveCustomerMarketContext(candidateMarketId);
    const claimDecisions = await loadCurrentClaimDecisions(prisma, {
      tenant: tenantDomain,
      sourceKey: market.evidence.source_key,
      asOf: now,
    });
    const resolved = resolveCustomerMerchantProfileFromReality({
      merchantId,
      marketId: candidateMarketId,
      tenantDomain,
      claimDecisions,
      now,
    });
    if (!resolved) continue;
    if (selected) throw new Error('CANA_CUSTOMER_MERCHANT_IDENTITY_AMBIGUOUS');
    selected = resolved;
  }
  return selected;
}

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
