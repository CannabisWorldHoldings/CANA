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
    return parsed;
  } catch (error) {
    throw new Error(`CANA_ASK_GAP_EVIDENCE_INVALID: ${error.message}`);
  }
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
      recheck: 'verified_candidate_count',
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
    const closed = answer.verified_candidate_count > 0;
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
        state,
        observed_at: now.toISOString(),
      }),
    }, { retryOnConflict: false });
    return Object.freeze({ state, verified_candidate_count: answer.verified_candidate_count, receipt_id: receipt.id });
  });
}
