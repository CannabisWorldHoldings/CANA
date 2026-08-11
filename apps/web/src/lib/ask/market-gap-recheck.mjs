import {
  appendReceipt,
  inSerializableTransaction,
  loadVerifiedFiredConsumerAuthority,
} from '../continuation/continuation-storage.mjs';
import { answerIntent } from './ask-service.mjs';

function parseEvidence(value) {
  try {
    const parsed = JSON.parse(value);
    if (!parsed?.intent_ir || typeof parsed.intent_ir !== 'object') throw new Error('intent_ir missing');
    if (!parsed?.answerability_frontier || typeof parsed.answerability_frontier !== 'object') {
      throw new Error('answerability_frontier missing');
    }
    return parsed;
  } catch (error) {
    throw new Error(`CANA_ASK_GAP_EVIDENCE_INVALID: ${error.message}`);
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function adjudicateFrontierRecheck({
  storedFrontier,
  requirement,
  currentFrontier,
  verifiedCandidateCount,
}) {
  const bindingMatches = requirement?.consumer === 'ask_market_gap_recheck'
    && requirement?.recheck === 'answerability_frontier'
    && requirement?.loopMode === 'REFLECTION_ONLY'
    && requirement?.tenant === storedFrontier?.tenant
    && requirement?.frontierKey === storedFrontier?.frontier_key
    && requirement?.frontierEvidenceDigest === storedFrontier?.evidence_digest
    && canonicalJson(requirement?.intentScope) === canonicalJson(storedFrontier?.intent_scope)
    && canonicalJson(requirement?.requiredPredicates) === canonicalJson(storedFrontier?.required_predicates);
  if (!bindingMatches) return Object.freeze({ decision: 'REFUSED', reason: 'FRONTIER_BINDING_MISMATCH' });
  if (
    currentFrontier?.tenant !== storedFrontier.tenant
    || canonicalJson(currentFrontier?.intent_scope) !== canonicalJson(storedFrontier.intent_scope)
    || canonicalJson(currentFrontier?.required_predicates) !== canonicalJson(storedFrontier.required_predicates)
  ) {
    return Object.freeze({ decision: 'REFUSED', reason: 'FRONTIER_SCOPE_MISMATCH' });
  }
  if (
    currentFrontier?.answerable === true
    && typeof currentFrontier.answerable_subject_ref === 'string'
    && currentFrontier.answerable_subject_ref.length > 0
    && Array.isArray(currentFrontier.blocking_predicates)
    && currentFrontier.blocking_predicates.length === 0
    && Number.isInteger(verifiedCandidateCount)
    && verifiedCandidateCount > 0
  ) {
    return Object.freeze({ decision: 'CLOSE', reason: 'EXACT_FRONTIER_ANSWERABLE' });
  }
  return Object.freeze({ decision: 'PERSISTENT', reason: 'FRONTIER_NOT_ANSWERABLE' });
}

export async function recheckMarketGap(prisma, {
  tenant,
  receiptId,
  tickId,
  now = new Date(),
}) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('CANA_ASK_GAP_CLOCK_INVALID');
  return inSerializableTransaction(prisma, async (tx) => {
    const authority = await loadVerifiedFiredConsumerAuthority(tx, {
      receiptId,
      tenant,
      tickId,
      consumer: 'ask_market_gap_recheck',
      recheck: 'answerability_frontier',
    });
    if (!authority.ok) return Object.freeze({ state: 'REFUSED', reason: authority.reason });
    const { mission, trigger, requirement } = authority;
    const priorReceipt = await tx.continuationReceipt.findFirst({
      where: { triggerId: trigger.id, tickId: authority.receipt.tickId, action: 'REFLECTED' },
      select: { id: true },
    });
    if (priorReceipt) return Object.freeze({ state: 'DUPLICATE' });
    if (!['ACTIVE', 'WAITING'].includes(mission.status)) {
      return Object.freeze({ state: 'REFUSED', reason: 'MISSION_NOT_CONSUMABLE' });
    }
    const opportunity = await tx.opportunity.findFirst({
      where: { id: requirement.opportunityId, tenant },
    });
    if (!opportunity || opportunity.kind !== 'MARKET_GAP') {
      return Object.freeze({ state: 'REFUSED', reason: 'TENANT_SCOPED_MARKET_GAP_NOT_FOUND' });
    }
    if (opportunity.status !== 'OPEN') {
      return Object.freeze({ state: 'NOOP', reason: `OPPORTUNITY_${opportunity.status}` });
    }
    if (
      opportunity.followUpTriggerId !== trigger.id
      || trigger.createdFrom !== `OPPORTUNITY:${opportunity.id}`
    ) {
      return Object.freeze({ state: 'REFUSED', reason: 'OPPORTUNITY_TRIGGER_BINDING_MISMATCH' });
    }
    const evidence = parseEvidence(opportunity.evidence);
    const brand = await tx.brand.findUnique({ where: { domain: tenant }, select: { id: true } });
    if (!brand) return Object.freeze({ state: 'PERSISTENT', reason: 'TENANT_BRAND_NOT_FOUND', verified_candidate_count: 0 });
    const answer = await answerIntent(tx, {
      intent: evidence.intent_ir,
      brandId: brand.id,
      tenantDomain: tenant,
      now,
    });
    const frontierDecision = adjudicateFrontierRecheck({
      storedFrontier: evidence.answerability_frontier,
      requirement,
      currentFrontier: answer.answerability_frontier,
      verifiedCandidateCount: answer.verified_candidate_count,
    });
    if (frontierDecision.decision === 'REFUSED') {
      return Object.freeze({ state: 'REFUSED', reason: frontierDecision.reason });
    }
    const closed = frontierDecision.decision === 'CLOSE';
    let state = 'PERSISTENT';
    if (closed) {
      const claimed = await tx.opportunity.updateMany({
        where: { id: requirement.opportunityId, tenant, status: 'OPEN' },
        data: {
          status: 'CLOSED',
          verification: 'SUPPORTED',
          observedState: JSON.stringify({
            verified_candidate_count: answer.verified_candidate_count,
            closed_at: now.toISOString(),
            query_gate: 'currentPublicRecordWhere + isPubliclyVerified',
            frontier_key: answer.answerability_frontier.frontier_key,
            evidence_digest: answer.answerability_frontier.evidence_digest,
            required_predicates: answer.answerability_frontier.required_predicates,
            blocking_predicates: answer.answerability_frontier.blocking_predicates,
          }),
        },
      });
      state = claimed.count === 1 ? 'CLOSED' : 'NOOP';
      if (claimed.count === 1) {
        await tx.continuationMission.updateMany({
          where: { id: mission.id, tenant, status: { in: ['ACTIVE', 'WAITING'] } },
          data: { status: 'COMPLETED' },
        });
        await tx.continuationTrigger.updateMany({
          where: { missionId: mission.id, tenant, status: 'ARMED' },
          data: { status: 'CANCELLED' },
        });
      }
    }
    const receipt = await appendReceipt(tx, {
      missionId: mission.id,
      triggerId: trigger.id,
      tickId: authority.receipt.tickId,
      action: 'REFLECTED',
      detail: state === 'CLOSED' ? 'MARKET_GAP closed by verified current candidates' : 'MARKET_GAP remains open',
      evidence: JSON.stringify({
        consumer: 'ask_market_gap_recheck',
        opportunity_id: requirement.opportunityId,
        tenant,
        verified_candidate_count: answer.verified_candidate_count,
        frontier_key: answer.answerability_frontier.frontier_key,
        frontier_evidence_digest: answer.answerability_frontier.evidence_digest,
        blocking_predicates: answer.answerability_frontier.blocking_predicates,
        frontier_decision: frontierDecision.decision,
        state,
        observed_at: now.toISOString(),
      }),
    }, { retryOnConflict: false });
    return Object.freeze({ state, verified_candidate_count: answer.verified_candidate_count, receipt_id: receipt.id });
  });
}

export async function recordMarketGapRecheckFailure(prisma, {
  tenant,
  receiptId,
  tickId,
  now = new Date(),
  error,
}) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('CANA_ASK_GAP_CLOCK_INVALID');
  return inSerializableTransaction(prisma, async (tx) => {
    const authority = await loadVerifiedFiredConsumerAuthority(tx, {
      receiptId,
      tenant,
      tickId,
      consumer: 'ask_market_gap_recheck',
      recheck: 'answerability_frontier',
    });
    if (!authority.ok) return Object.freeze({ state: 'REFUSED', reason: authority.reason });
    const reflected = await tx.continuationReceipt.findFirst({
      where: { triggerId: authority.trigger.id, tickId: authority.receipt.tickId, action: 'REFLECTED' },
      select: { id: true },
    });
    if (reflected) return Object.freeze({ state: 'DUPLICATE', receipt_id: reflected.id });
    const priorFailure = await tx.continuationReceipt.findFirst({
      where: { triggerId: authority.trigger.id, tickId: authority.receipt.tickId, action: 'CONSUMER_FAILED' },
      select: { id: true },
    });
    if (priorFailure) return Object.freeze({ state: 'RETRY_PENDING', receipt_id: priorFailure.id });
    const errorCode = typeof error?.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(error.code)
      ? error.code
      : 'CONSUMER_EXECUTION_FAILED';
    const receipt = await appendReceipt(tx, {
      missionId: authority.mission.id,
      triggerId: authority.trigger.id,
      tickId: authority.receipt.tickId,
      action: 'CONSUMER_FAILED',
      detail: 'MARKET_GAP consumer failed; durable retry remains pending',
      evidence: JSON.stringify({
        consumer: 'ask_market_gap_recheck',
        opportunity_id: authority.requirement.opportunityId,
        tenant,
        error_code: errorCode,
        failed_at: now.toISOString(),
        retry_state: 'PENDING',
      }),
    }, { retryOnConflict: false });
    return Object.freeze({ state: 'RETRY_PENDING', receipt_id: receipt.id });
  });
}
