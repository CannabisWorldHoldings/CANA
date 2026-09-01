import { deepFreeze, digest } from './core.mjs';

export function discoverOpportunities({ demandGraph, supply }) {
  const opportunities = [];
  const supplyByKey = new Map();
  for (const item of supply) {
    if (item.epistemicState !== 'KNOWN') continue;
    const key = [item.market ?? 'UNKNOWN', item.neighborhood ?? 'UNKNOWN', item.category ?? 'UNKNOWN', item.fulfillment ?? 'ANY'].join('::');
    if (!supplyByKey.has(key)) supplyByKey.set(key, []);
    supplyByKey.get(key).push(item);
  }

  for (const cell of demandGraph.rows) {
    if (cell.count < 3) continue;
    const reachable = supplyByKey.get(cell.key) ?? [];
    if (reachable.length === 0) {
      opportunities.push(makeOpportunity('UNMET_DEMAND', cell, {
        demandSignals: cell.count,
        reachableSupplyCount: 0,
        evidenceDigests: cell.evidence,
      }, Math.min(1, cell.count / 20)));
      continue;
    }
    if (cell.medianPriceCapUsd != null) {
      const priceFloor = Math.min(...reachable.map((r) => r.priceUsd).filter(Number.isFinite));
      if (Number.isFinite(priceFloor) && priceFloor > cell.medianPriceCapUsd) {
        opportunities.push(makeOpportunity('PRICE_MISMATCH', cell, {
          demandSignals: cell.count,
          medianPriceCapUsd: cell.medianPriceCapUsd,
          reachablePriceFloorUsd: priceFloor,
          evidenceDigests: cell.evidence,
        }, Math.min(1, (priceFloor - cell.medianPriceCapUsd) / Math.max(1, cell.medianPriceCapUsd))));
      }
    }
    if (cell.zeroResults / Math.max(1, cell.count) >= 0.4) {
      opportunities.push(makeOpportunity('ANSWERABILITY_GAP', cell, {
        demandSignals: cell.count,
        zeroResultRate: cell.zeroResults / cell.count,
        evidenceDigests: cell.evidence,
      }, cell.zeroResults / cell.count));
    }
  }
  return deepFreeze(opportunities.sort((a, b) => b.score - a.score));
}

function makeOpportunity(kind, cell, evidence, score) {
  return deepFreeze({
    opportunityId: digest({ kind, key: cell.key, evidence }, 'opp'),
    kind,
    cellKey: cell.key,
    score,
    uncertainty: cell.count < 10 ? 'HIGH' : cell.count < 30 ? 'MEDIUM' : 'LOW',
    epistemicState: 'INFERRED',
    evidence,
    falsificationCondition: 'New verified supply or subsequent observed demand invalidates the mismatch.',
  });
}
