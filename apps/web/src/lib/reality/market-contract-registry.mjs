// MARKET CONTRACT REGISTRY — the generalization seam discovered by
// Transfer Test #1 (Virginia).
//
// Before this module, market-claim-adapter validated acquisition lineage
// against the hardcoded D.C. ABCA live contract, which structurally rejected
// every non-ABCA source. This registry makes claim-lineage validation a
// per-market contract lookup while preserving the exact rejection behavior
// for unregistered sources: an unknown source_key resolves to null and the
// acquisition is refused, exactly as before.
//
// LAWS:
//   - Only contracts defined by a live adapter module (with a canonical
//     digest over the frozen contract) may appear here. No ad-hoc entries.
//   - Entries are frozen; the registry is frozen; lookups return the frozen
//     entry or null — never a synthesized fallback.
//   - Adding a market means adding its adapter contract + one entry here +
//     the source-portfolio-router registration. Nothing else changes.

import { ABCA_LIVE_CONTRACT, ABCA_LIVE_CONTRACT_DIGEST } from './live-abca-adapter.mjs';
import { VA_CCA_LIVE_CONTRACT, VA_CCA_LIVE_CONTRACT_DIGEST } from './live-va-cca-adapter.mjs';
import { MD_MCA_LIVE_CONTRACT, MD_MCA_LIVE_CONTRACT_DIGEST } from './live-md-mca-adapter.mjs';

export const MARKET_CONTRACT_REGISTRY = Object.freeze([
  Object.freeze({
    market_id: 'US-DC',
    source_key: ABCA_LIVE_CONTRACT.sourceKey,
    source_id: ABCA_LIVE_CONTRACT.sourceId,
    source_url: ABCA_LIVE_CONTRACT.layerUrl,
    contract_digest: ABCA_LIVE_CONTRACT_DIGEST,
  }),
  Object.freeze({
    market_id: 'US-VA',
    source_key: VA_CCA_LIVE_CONTRACT.sourceKey,
    source_id: VA_CCA_LIVE_CONTRACT.sourceId,
    source_url: VA_CCA_LIVE_CONTRACT.pageUrl,
    contract_digest: VA_CCA_LIVE_CONTRACT_DIGEST,
  }),
  Object.freeze({
    market_id: 'US-MD',
    source_key: MD_MCA_LIVE_CONTRACT.sourceKey,
    source_id: MD_MCA_LIVE_CONTRACT.sourceId,
    source_url: MD_MCA_LIVE_CONTRACT.pageUrl,
    contract_digest: MD_MCA_LIVE_CONTRACT_DIGEST,
  }),
]);

/**
 * Resolve the admitted market contract for an acquisition source key.
 * Returns the frozen registry entry, or null when the source key is not an
 * admitted contract — callers must treat null as refusal.
 */
export function marketContractForSourceKey(sourceKey) {
  if (typeof sourceKey !== 'string' || sourceKey.length === 0) return null;
  return MARKET_CONTRACT_REGISTRY.find((entry) => entry.source_key === sourceKey) ?? null;
}
