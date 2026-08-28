import { RealityGraph } from './reality-graph.mjs';
import { buildDemandGraph } from './demand-graph.mjs';
import { discoverOpportunities } from './opportunity.mjs';
import { auditKernelState } from './audit.mjs';
import { digest, sealPlain } from './core.mjs';

/**
 * Read-only nervous-system cycle. It deliberately stops before intervention.
 * Authorization/execution remains a separate canonical CANA flow.
 */
export async function runReadOnlyOrganismCycle(adapter, now = new Date()) {
  const observations = await adapter.loadObservations();
  const intentEvents = await adapter.loadIntentEvents();
  const supply = await adapter.loadVerifiedSupply();
  const reality = new RealityGraph(observations, now);
  const demand = buildDemandGraph(intentEvents);
  const opportunities = discoverOpportunities({ demandGraph: demand, supply });
  const worldStateDigest = digest({ reality: reality.ledger(), demand: demand.digest, opportunityIds: opportunities.map((o) => o.opportunityId) }, 'world-state');
  const audit = auditKernelState({ observations });
  return sealPlain({
    phases: [
      { phase: 'PERCEIVE', detail: reality.ledger() },
      { phase: 'UNDERSTAND_DEMAND', detail: demand.totals },
      { phase: 'DISCOVER', detail: { opportunityCount: opportunities.length } },
      { phase: 'ADVERSARIAL_VERIFY', detail: audit },
    ],
    worldStateDigest,
    realityLedger: reality.ledger(),
    demand,
    opportunities,
    audit,
    nextAuthorityBoundary: 'PROPOSE_ONLY — no action is authorized by this cycle',
  });
}
