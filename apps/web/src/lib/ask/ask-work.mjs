import { createMission, createTrigger } from '../continuation/continuation-repository.mjs';
import {
  PUBLIC_SUBMISSION_SURFACES,
  publicSubmissionErrorCode,
  reservePublicSubmission,
} from '../public-submission.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;

export function askPersistenceScope(domain) {
  if (typeof domain !== 'string' || !/^[a-z0-9.-]{1,253}$/.test(domain)) {
    throw new TypeError('ASK persistence requires a canonical tenant domain');
  }
  return `tenant:${domain}`;
}

function opportunityPolicy(spec, intent) {
  if (spec.kind === 'MARKET_GAP') {
    return {
      purpose: 'Monitor the evidence-bound MARKET_GAP until it closes, is dismissed, or expires',
      reason: `Make MARKET_GAP work due for intent "${intent.raw_query}"; a registered consumer must re-check the evidence-gated store`,
      stopCondition: 'Opportunity leaves OPEN, a registered re-check finds verified candidates, or recurrence expires',
      evidenceRequirements: {
        consumer: 'ask_market_gap_recheck',
        recheck: 'verified_candidate_count',
      },
    };
  }
  if (spec.kind !== 'CAPABILITY_GAP') {
    throw new Error(`unsupported ASK opportunity kind: ${String(spec.kind)}`);
  }
  return {
    purpose: 'Monitor the evidence-bound CAPABILITY_GAP until support exists, it is dismissed, or expires',
    reason: `Make CAPABILITY_GAP work due for intent "${intent.raw_query}"; a registered consumer must re-evaluate supported dimensions`,
    stopCondition: 'Opportunity leaves OPEN, a registered capability check makes the intent decision-eligible, or recurrence expires',
    evidenceRequirements: {
      consumer: 'ask_capability_gap_recheck',
      recheck: 'supported_verified_dimensions',
      dimensions: intent.unsupported_known_dimensions ?? [],
    },
  };
}

/**
 * Persist one public ASK observation as one bounded atomic unit. The public
 * reservation provides pseudonymous deduplication and throttling; no raw
 * network identity is stored. A failed dependent write rolls the whole unit
 * back, so no orphan opportunity, mission, trigger, signal, or reservation
 * can survive.
 */
export async function recordAskWork(
  prisma,
  { answer, domain, intent, now = new Date() },
) {
  try {
    return await prisma.$transaction(async (tx) => {
      await reservePublicSubmission(tx, {
        clientIdentity: askPersistenceScope(domain),
        surface: PUBLIC_SUBMISSION_SURFACES.ASK,
        subject: JSON.stringify({ version: 1, domain, query: intent.raw_query }),
        now,
      });

      let opportunity = null;
      let continuationArmed = false;
      if (answer.opportunitySpec) {
        const created = await tx.opportunity.create({
          data: { ...answer.opportunitySpec, verification: 'UNKNOWN', status: 'OPEN' },
        });
        const policy = opportunityPolicy(answer.opportunitySpec, {
          raw_query: intent.raw_query,
          unsupported_known_dimensions: answer.unsupported_known_dimensions,
        });
        const mission = await createMission(tx, {
          tenant: domain,
          purpose: `${policy.purpose}: ${created.id}`,
          createdFrom: 'TRACK_A_ASK',
          authorityCeiling: 'OBSERVE_ONLY',
          budgetCentsMax: 500,
          stopCondition: policy.stopCondition,
        });
        const trigger = await createTrigger(tx, {
          missionId: mission.id,
          tenant: domain,
          triggerType: 'FOLLOW_UP',
          reason: policy.reason,
          createdFrom: `OPPORTUNITY:${created.id}`,
          authorityCeiling: 'OBSERVE_ONLY',
          budgetCentsMax: 100,
          stopCondition: policy.stopCondition,
          nextEligibleAt: new Date(now.getTime() + DAY_MS),
          expiresAt: new Date(now.getTime() + 7 * DAY_MS),
          continuationPolicy: JSON.stringify({ kind: 'RESCHEDULE', intervalMs: DAY_MS, remaining: 2 }),
          evidenceRequirements: JSON.stringify({ ...policy.evidenceRequirements, opportunityId: created.id }),
        }, { now });
        await tx.opportunity.update({
          where: { id: created.id },
          data: { followUpTriggerId: trigger.id },
        });
        opportunity = { id: created.id, kind: created.kind, follow_up_trigger_id: trigger.id };
        continuationArmed = true;
      }

      await tx.askIntentSignal.create({
        data: {
          tenant: domain,
          rawQuery: intent.raw_query,
          intentIr: JSON.stringify(intent),
          answerSummary: JSON.stringify({
            verified_candidate_count: answer.verified_candidate_count,
            zero_verified_result: answer.zero_verified_result,
            zero_result_reason: answer.zero_result_reason,
            unknown_dimensions: intent.unknown_dimensions,
            opportunity_emitted: !!answer.opportunitySpec,
          }),
          candidateCount: answer.verified_candidate_count,
          opportunityId: opportunity?.id ?? null,
        },
      });

      return {
        state: 'RECORDED',
        opportunity,
        signalRecorded: true,
        opportunityRecorded: opportunity !== null,
        continuationArmed,
      };
    }, { isolationLevel: 'Serializable', timeout: 10_000 });
  } catch (error) {
    const code = publicSubmissionErrorCode(error);
    if (code === 'duplicate') {
      return { state: 'DUPLICATE', opportunity: null, signalRecorded: false, opportunityRecorded: false, continuationArmed: false };
    }
    if (code === 'rate') {
      return { state: 'RATE_LIMITED', opportunity: null, signalRecorded: false, opportunityRecorded: false, continuationArmed: false };
    }
    return { state: 'FAILED', opportunity: null, signalRecorded: false, opportunityRecorded: false, continuationArmed: false };
  }
}
