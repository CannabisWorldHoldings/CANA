import { createHash } from 'node:crypto';

import { createMission, createTrigger } from '../continuation/continuation-repository.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;
const APPROACHING_WINDOW_MS = 7 * DAY_MS;
const TENANT_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function tenantKey(value) {
  const tenant = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!TENANT_PATTERN.test(tenant)) fail('CANA_FRESHNESS_DEBT_TENANT_INVALID');
  return tenant;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function boundedCount(value) {
  const count = Number(value ?? 0);
  return Number.isInteger(count) && count > 0 ? Math.min(count, 10_000) : 0;
}

export function computeFreshnessDebt({ tenant, claims, asOf = new Date() }) {
  tenant = tenantKey(tenant);
  const clock = asOf instanceof Date ? asOf : new Date(asOf);
  if (!Number.isFinite(clock.getTime()) || !Array.isArray(claims)) fail('CANA_FRESHNESS_DEBT_INPUT_INVALID');
  const items = claims.map((claim) => {
    const expiry = new Date(claim?.freshness_expires_at ?? claim?.freshnessExpiresAt);
    const validExpiry = Number.isFinite(expiry.getTime());
    const remainingMs = validExpiry ? expiry.getTime() - clock.getTime() : null;
    const state = remainingMs === null
      ? 'FRESHNESS_UNKNOWN'
      : remainingMs <= 0
        ? 'STALE'
        : remainingMs <= APPROACHING_WINDOW_MS
          ? 'APPROACHING_STALE'
          : 'CURRENT';
    const demandCount = boundedCount(claim?.demand_count);
    const dependentDecisions = boundedCount(claim?.dependent_decisions);
    const urgency = state === 'STALE' ? 100 : state === 'APPROACHING_STALE' ? 50 : state === 'FRESHNESS_UNKNOWN' ? 75 : 0;
    const priorityScore = urgency + Math.min(demandCount, 100) * 10 + Math.min(dependentDecisions, 100) * 5;
    const item = {
      schema_version: 'cana-freshness-debt-item/v1',
      tenant,
      claim_id: String(claim?.id ?? ''),
      predicate: String(claim?.predicate ?? claim?.claimType ?? ''),
      freshness_state: state,
      freshness_expires_at: validExpiry ? expiry.toISOString() : null,
      remaining_ms: remainingMs,
      demand_count: demandCount,
      dependent_decisions: dependentDecisions,
      source_available: claim?.source_available === true,
      decision_eligible: claim?.decision_eligible === true || claim?.decisionEligible === true,
      estimated_acquisition_cost_cents: Number.isInteger(claim?.estimated_acquisition_cost_cents)
        ? Math.max(0, claim.estimated_acquisition_cost_cents)
        : null,
      priority_components: {
        freshness_urgency: urgency,
        observed_demand: Math.min(demandCount, 100) * 10,
        decisions_unlocked: Math.min(dependentDecisions, 100) * 5,
      },
      priority_score: priorityScore,
      requires_revalidation: state !== 'CURRENT' && claim?.source_available === true,
      truth_state: 'UNCHANGED_BY_PRIORITY_ENGINE',
    };
    return Object.freeze({ ...item, work_key: digest({
      version: 1,
      tenant,
      claim_id: item.claim_id,
      predicate: item.predicate,
      freshness_expires_at: item.freshness_expires_at,
    }) });
  }).sort((left, right) => right.priority_score - left.priority_score
    || String(left.freshness_expires_at).localeCompare(String(right.freshness_expires_at))
    || left.claim_id.localeCompare(right.claim_id));
  return Object.freeze({
    schema_version: 'cana-freshness-debt-summary/v1',
    tenant,
    as_of: clock.toISOString(),
    stale_claims: items.filter((item) => item.freshness_state === 'STALE').length,
    approaching_stale_claims: items.filter((item) => item.freshness_state === 'APPROACHING_STALE').length,
    unknown_freshness_claims: items.filter((item) => item.freshness_state === 'FRESHNESS_UNKNOWN').length,
    revalidation_candidates: items.filter((item) => item.requires_revalidation).length,
    items: Object.freeze(items),
  });
}

export function createRevalidationWorkSpec(item, { now = new Date() } = {}) {
  const clock = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(clock.getTime()) || !item?.requires_revalidation || !item?.source_available) {
    fail('CANA_FRESHNESS_REVALIDATION_NOT_REQUIRED');
  }
  const expiresAt = new Date(clock.getTime() + 7 * DAY_MS);
  const requirements = Object.freeze({
    consumer: 'reality_claim_revalidation',
    recheck: 'acquisition_bound_verification_court',
    loop_mode: 'REFLECTION_ONLY',
    claim_id: item.claim_id,
    predicate: item.predicate,
    work_key: item.work_key,
    required_acquisition_state: 'COMPLETED',
    required_completeness: 'COMPLETE',
  });
  return Object.freeze({
    schema_version: 'cana-freshness-revalidation-work/v1',
    work_key: item.work_key,
    mission: Object.freeze({
      tenant: item.tenant,
      purpose: `Revalidate ${item.predicate} for claim ${item.claim_id}`,
      createdFrom: 'REALITY_FRESHNESS_DEBT',
      authorityCeiling: 'OBSERVE_ONLY',
      budgetCentsMax: 300,
      stopCondition: 'Claim receives a current acquisition-bound court decision, is revoked, or work expires',
      expiresAt,
      stateRef: JSON.stringify({ claim_id: item.claim_id, work_key: item.work_key }),
      evidenceRequirements: JSON.stringify(requirements),
    }),
    trigger: Object.freeze({
      tenant: item.tenant,
      triggerType: 'REVALIDATION',
      reason: `Freshness debt ${item.freshness_state} with priority ${item.priority_score}`,
      createdFrom: `FRESHNESS_DEBT:${item.work_key}`,
      authorityCeiling: 'OBSERVE_ONLY',
      budgetCentsMax: 100,
      stopCondition: 'A registered verifier settles the exact claim or bounded recurrence expires',
      nextEligibleAt: clock,
      expiresAt,
      continuationPolicy: JSON.stringify({ kind: 'RESCHEDULE', intervalMs: DAY_MS, remaining: 2 }),
      evidenceRequirements: requirements,
    }),
    truth_mutations: 0,
    acquisition_requests: 0,
  });
}

export async function scheduleFreshnessRevalidation(prisma, item, { now = new Date() } = {}) {
  const spec = createRevalidationWorkSpec(item, { now });
  const operation = async (tx) => {
    const opportunity = await tx.opportunity.upsert({
      where: { tenant_dedupeKey: { tenant: item.tenant, dedupeKey: item.work_key } },
      update: {},
      create: {
        tenant: item.tenant,
        dedupeKey: item.work_key,
        kind: 'FRESHNESS_DEBT',
        evidence: JSON.stringify(spec.trigger.evidenceRequirements),
        observedState: JSON.stringify(item),
        signal: digest({ claim_id: item.claim_id, priority: item.priority_components }),
        hypothesizedValue: null,
        confidence: null,
        recommendedAction: 'Run the acquisition-bound Verification Court with fresh official evidence',
        requiredAuthority: 'OBSERVE_ONLY',
        estimatedCostCents: item.estimated_acquisition_cost_cents,
        risk: 'STALE_TRUTH_BLOCKS_DECISIONS',
        rollback: 'Append a refusal receipt; never mutate prior evidence',
        measurementPlan: 'Measure current acquisition receipt, court decision, and resulting freshness debt',
        verification: 'UNKNOWN',
        status: 'OPEN',
      },
    });
    await tx.$queryRawUnsafe('SELECT "id" FROM "Opportunity" WHERE "id" = $1 FOR UPDATE', opportunity.id);
    const locked = await tx.opportunity.findUnique({ where: { id: opportunity.id } });
    if (locked.followUpTriggerId) {
      return Object.freeze({ state: 'REUSED', opportunity_id: locked.id, trigger_id: locked.followUpTriggerId });
    }
    const mission = await createMission(tx, spec.mission);
    const trigger = await createTrigger(tx, {
      ...spec.trigger,
      missionId: mission.id,
      evidenceRequirements: JSON.stringify(spec.trigger.evidenceRequirements),
    }, { now });
    await tx.opportunity.update({ where: { id: locked.id }, data: { followUpTriggerId: trigger.id } });
    return Object.freeze({
      state: 'CREATED',
      opportunity_id: locked.id,
      mission_id: mission.id,
      trigger_id: trigger.id,
      authority_ceiling: trigger.authorityCeiling,
      truth_mutations: 0,
    });
  };
  if (typeof prisma?.$transaction !== 'function') return operation(prisma);
  return prisma.$transaction(operation, { isolationLevel: 'Serializable', timeout: 10_000 });
}
