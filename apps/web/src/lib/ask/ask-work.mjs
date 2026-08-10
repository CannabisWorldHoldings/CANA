import { createHash } from 'node:crypto';
import { createMission, createTrigger } from '../continuation/continuation-repository.mjs';
import { inSerializableTransaction } from '../continuation/continuation-storage.mjs';
import { persistenceSafeIntent } from './intent-ir.mjs';
import {
  PUBLIC_SUBMISSION_SURFACES,
  publicSubmissionErrorCode,
  reservePublicSubmission,
} from '../public-submission.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;

export function askPersistenceScope(domain) {
  const labels = typeof domain === 'string' ? domain.split('.') : [];
  if (
    typeof domain !== 'string' ||
    domain.length > 253 ||
    labels.length < 2 ||
    labels.some(
      (label) =>
        label.length < 1 ||
        label.length > 63 ||
        !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
    )
  ) {
    throw new TypeError('ASK persistence requires a canonical tenant domain');
  }
  return `tenant:${domain}`;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function validFrontier(frontier, tenant) {
  return !!frontier
    && frontier.schema_version === 'cana-answerability-frontier/v1'
    && frontier.tenant === tenant
    && /^sha256:[a-f0-9]{64}$/.test(frontier.frontier_key ?? '')
    && /^sha256:[a-f0-9]{64}$/.test(frontier.evidence_digest ?? '')
    && Array.isArray(frontier.required_predicates)
    && Array.isArray(frontier.blocking_predicates)
    && frontier.intent_scope
    && typeof frontier.intent_scope === 'object';
}

export function frontierOpportunityKey({ tenant, kind, frontier }) {
  askPersistenceScope(tenant);
  if (!['MARKET_GAP', 'CAPABILITY_GAP'].includes(kind) || !validFrontier(frontier, tenant)) {
    throw new Error('CANA_ASK_FRONTIER_INVALID');
  }
  return digest({
    version: 2,
    tenant,
    kind,
    frontier_key: frontier.frontier_key,
  });
}

export function frontierWorkRequirements({ opportunityId, frontier }) {
  if (typeof opportunityId !== 'string' || !opportunityId || !validFrontier(frontier, frontier?.tenant)) {
    throw new Error('CANA_ASK_FRONTIER_WORK_INVALID');
  }
  return Object.freeze({
    consumer: 'ask_market_gap_recheck',
    recheck: 'answerability_frontier',
    opportunityId,
    frontierKey: frontier.frontier_key,
    frontierEvidenceDigest: frontier.evidence_digest,
    tenant: frontier.tenant,
    intentScope: frontier.intent_scope,
    requiredPredicates: frontier.required_predicates,
    loopMode: 'REFLECTION_ONLY',
  });
}

function boundedInteger(value, maximum, label) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`CANA_ASK_${label}_INVALID`);
  return Math.min(value, maximum);
}

export function computeDemandPriority({
  admittedSignalCount,
  uniqueDemandCount,
  blockingPredicates,
  freshnessUrgency = 0,
  contradictionSeverity = 0,
  decisionCriticality = 0,
}) {
  const signals = boundedInteger(admittedSignalCount, 100, 'SIGNAL_COUNT');
  const unique = boundedInteger(uniqueDemandCount, 100, 'UNIQUE_DEMAND_COUNT');
  const blockers = [...new Set(blockingPredicates ?? [])].length;
  const freshness = boundedInteger(freshnessUrgency, 10, 'FRESHNESS_URGENCY');
  const contradictions = boundedInteger(contradictionSeverity, 10, 'CONTRADICTION_SEVERITY');
  const criticality = boundedInteger(decisionCriticality, 10, 'DECISION_CRITICALITY');
  const score = Math.min(10_000,
    signals * 2
    + unique * 5
    + blockers * 10
    + freshness * 30
    + contradictions * 50
    + criticality * 100);
  return Object.freeze({
    score,
    components: Object.freeze({
      admitted_signal_count: signals,
      unique_demand_count: unique,
      blocking_predicate_count: blockers,
      freshness_urgency: freshness,
      contradiction_severity: contradictions,
      decision_criticality: criticality,
    }),
    hypothesized_value: null,
  });
}

function opportunityPolicy(spec, intent, frontier, opportunityId) {
  if (spec.kind === 'MARKET_GAP') {
    const requirements = frontierWorkRequirements({ opportunityId, frontier });
    return {
      purpose: 'Monitor the evidence-bound MARKET_GAP until it closes, is dismissed, or expires',
      reason: `Make MARKET_GAP work due for intent "${intent.raw_query}"; a registered consumer must re-check the evidence-gated store`,
      stopCondition: 'Opportunity leaves OPEN, the exact Answerability Frontier becomes current and complete, or recurrence expires',
      evidenceRequirements: requirements,
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
      frontierKey: frontier.frontier_key,
      frontierEvidenceDigest: frontier.evidence_digest,
      tenant: frontier.tenant,
      loopMode: 'REFLECTION_ONLY',
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
  const persistedIntent = persistenceSafeIntent(intent);
  const intentDigest = digest({ version: 1, intent: persistedIntent });
  const persist = (reserveSubmission) => inSerializableTransaction(prisma, async (tx) => {
      if (reserveSubmission) {
        await reservePublicSubmission(tx, {
          clientIdentity: askPersistenceScope(domain),
          surface: PUBLIC_SUBMISSION_SURFACES.ASK,
          subject: JSON.stringify({ version: 2, domain, intentDigest }),
          now,
        });
      }

      let opportunity = null;
      let continuationArmed = false;
      if (answer.opportunitySpec) {
        const frontier = answer.answerability_frontier;
        const dedupeKey = frontierOpportunityKey({
          tenant: domain,
          kind: answer.opportunitySpec.kind,
          frontier,
        });
        await tx.$queryRawUnsafe(
          'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))::text AS lock_result',
          `ask-frontier:${domain}:${dedupeKey}`,
        );
        let created = await tx.opportunity.findUnique({
          where: { tenant_dedupeKey: { tenant: domain, dedupeKey } },
        });
        if (!created) {
          created = await tx.opportunity.create({
            data: {
            ...answer.opportunitySpec,
            tenant: domain,
            dedupeKey,
            signal: intentDigest,
            evidence: JSON.stringify({
              intent_ir: persistedIntent,
              zero_result_reason: answer.zero_result_reason,
              verified_candidate_count: answer.verified_candidate_count,
              unsupported_known_dimensions: answer.unsupported_known_dimensions,
              answerability_frontier: frontier,
              observed_at: now.toISOString(),
            }),
            observedState: JSON.stringify({
              frontier_key: frontier.frontier_key,
              evidence_digest: frontier.evidence_digest,
              required_predicates: frontier.required_predicates,
              blocking_predicates: frontier.blocking_predicates,
              verified_candidate_count: answer.verified_candidate_count,
              unsupported_known_dimensions: answer.unsupported_known_dimensions,
            }),
            verification: 'UNKNOWN',
            status: 'OPEN',
          },
          });
        }
        let followUpTriggerId = created.followUpTriggerId;
        if (!followUpTriggerId && created.status === 'OPEN' && created.kind === 'MARKET_GAP') {
          const policy = opportunityPolicy(answer.opportunitySpec, {
            raw_query: intentDigest,
            unsupported_known_dimensions: answer.unsupported_known_dimensions,
          }, frontier, created.id);
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
            evidenceRequirements: JSON.stringify(policy.evidenceRequirements),
          }, { now });
          followUpTriggerId = trigger.id;
          await tx.opportunity.update({
            where: { id: created.id },
            data: { followUpTriggerId },
          });
        }
        opportunity = { id: created.id, kind: created.kind, follow_up_trigger_id: followUpTriggerId };
        continuationArmed = followUpTriggerId !== null;
      }

      await tx.askIntentSignal.create({
        data: {
          tenant: domain,
          rawQuery: intentDigest,
          intentIr: JSON.stringify(persistedIntent),
          answerSummary: JSON.stringify({
            verified_candidate_count: answer.verified_candidate_count,
            zero_verified_result: answer.zero_verified_result,
            zero_result_reason: answer.zero_result_reason,
            unknown_dimensions: intent.unknown_dimensions,
            opportunity_emitted: !!answer.opportunitySpec,
            frontier_key: answer.answerability_frontier?.frontier_key ?? null,
            frontier_evidence_digest: answer.answerability_frontier?.evidence_digest ?? null,
            blocking_predicates: answer.answerability_frontier?.blocking_predicates ?? [],
          }),
          candidateCount: answer.verified_candidate_count,
          opportunityId: opportunity?.id ?? null,
        },
      });

      if (opportunity) {
        const admittedSignalCount = await tx.askIntentSignal.count({
          where: { tenant: domain, opportunityId: opportunity.id },
        });
        const frontier = answer.answerability_frontier;
        const demandPriority = computeDemandPriority({
          admittedSignalCount,
          uniqueDemandCount: admittedSignalCount > 0 ? 1 : 0,
          blockingPredicates: frontier.blocking_predicates,
          freshnessUrgency: frontier.stale_predicates.length > 0 ? 5 : 0,
          contradictionSeverity: frontier.contradicted_predicates.length > 0 ? 5 : 0,
          decisionCriticality: frontier.required_predicates.some((predicate) => (
            ['license_number', 'license_status', 'operating_status'].includes(predicate)
          )) ? 5 : 1,
        });
        await tx.opportunity.update({
          where: { id: opportunity.id },
          data: {
            evidence: JSON.stringify({
              intent_ir: persistedIntent,
              zero_result_reason: answer.zero_result_reason,
              verified_candidate_count: answer.verified_candidate_count,
              unsupported_known_dimensions: answer.unsupported_known_dimensions,
              answerability_frontier: frontier,
              observed_at: now.toISOString(),
            }),
            observedState: JSON.stringify({
              frontier_key: frontier.frontier_key,
              evidence_digest: frontier.evidence_digest,
              required_predicates: frontier.required_predicates,
              blocking_predicates: frontier.blocking_predicates,
              verified_candidate_count: answer.verified_candidate_count,
              unsupported_known_dimensions: answer.unsupported_known_dimensions,
              demand_priority: demandPriority,
            }),
          },
        });
        opportunity.priority_score = demandPriority.score;
      }

      return {
        state: 'RECORDED',
        opportunity,
        signalRecorded: true,
        opportunityRecorded: opportunity !== null,
        continuationArmed,
      };
    });
  try {
    return await persist(true);
  } catch (error) {
    let failure = error;
    if (error?.code === 'PUBLIC_SUBMISSION_DUPLICATE') {
      // The failed serializable transaction has already rolled back. Reuse the
      // existing pseudonymous reservation while retaining this ask as a new
      // demand signal; the frontier lock still deduplicates all durable work.
      try {
        return await persist(false);
      } catch (retryError) {
        failure = retryError;
      }
    }
    const code = publicSubmissionErrorCode(failure);
    if (code === 'duplicate') {
      return { state: 'DUPLICATE', opportunity: null, signalRecorded: false, opportunityRecorded: false, continuationArmed: false };
    }
    if (code === 'rate') {
      return { state: 'RATE_LIMITED', opportunity: null, signalRecorded: false, opportunityRecorded: false, continuationArmed: false };
    }
    return { state: 'FAILED', opportunity: null, signalRecorded: false, opportunityRecorded: false, continuationArmed: false };
  }
}
