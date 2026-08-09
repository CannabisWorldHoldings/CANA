/**
 * SOVEREIGN CONTINUATION KERNEL — durable state boundary.
 *
 * The ONLY module allowed to write ContinuationMission / ContinuationTrigger /
 * ContinuationReceipt rows (same isolation rule as geo-repository.mjs for
 * spatial SQL). Routes, scripts, courts and workers call these functions;
 * they never touch the tables directly.
 *
 * All functions take a PrismaClient (or transaction client) as their first
 * argument so callers control connection/transaction scope, and the tests can
 * point the same code at disposable databases.
 *
 * EXACTLY-ONCE FIRING. `runTick` claims a trigger with a conditional
 * updateMany (ARMED -> FIRED). Under concurrent ticks the database
 * adjudicates exactly one winner — the same adjudication philosophy as
 * DemandCreditEntry's @@unique event identity. A tick that loses the claim
 * writes nothing.
 *
 * RECEIPTS ARE THE TRUTH. Every consequential kernel act appends a
 * hash-chained ContinuationReceipt. Status columns are projections; the
 * chain is the history.
 */

import {
  MISSION_STATES,
  TRIGGER_STATES,
  authorityRank,
  ceilingWithin,
  nextRescheduledSpec,
  resolveTriggerDisposition,
  validateTriggerSpec,
} from './continuation-core.mjs';
import { selectTickCandidates } from './continuation-selection.mjs';
import {
  appendReceipt,
  inSerializableTransaction,
  verifyReceiptChain,
} from './continuation-storage.mjs';

export { appendReceipt, verifyReceiptChain } from './continuation-storage.mjs';

function requireNonEmpty(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} is required`);
  }
  return value;
}

/** Create a mission. L1 applies to missions too: purpose, stop condition, budget, ceiling. */
export async function createMission(prisma, spec) {
  requireNonEmpty(spec?.tenant, 'tenant');
  requireNonEmpty(spec?.purpose, 'purpose');
  requireNonEmpty(spec?.createdFrom, 'createdFrom');
  requireNonEmpty(spec?.stopCondition, 'stopCondition');
  authorityRank(spec?.authorityCeiling); // throws on unknown ceiling
  if (!Number.isInteger(spec?.budgetCentsMax) || spec.budgetCentsMax <= 0) {
    throw new Error('budgetCentsMax must be a positive integer');
  }
  return prisma.continuationMission.create({
    data: {
      tenant: spec.tenant,
      purpose: spec.purpose,
      createdFrom: spec.createdFrom,
      status: MISSION_STATES.ACTIVE,
      authorityCeiling: spec.authorityCeiling,
      budgetCentsMax: spec.budgetCentsMax,
      stopCondition: spec.stopCondition,
      expiresAt: spec.expiresAt ?? null,
      stateRef: spec.stateRef ?? null,
      executionGenomeRef: spec.executionGenomeRef ?? null,
      evidenceRequirements: spec.evidenceRequirements ?? null,
    },
  });
}

/**
 * Create a trigger under a mission. Enforces L1 (validation), L3 (child
 * ceiling <= mission ceiling) and L4 (effectful work born PENDING_APPROVAL).
 * Rejection throws — a rejected spec never reaches the table.
 */
async function createTriggerInTransaction(prisma, spec, now) {
  const mission = await prisma.continuationMission.findUnique({ where: { id: spec?.missionId ?? '' } });
  if (!mission) throw new Error(`mission not found: ${String(spec?.missionId)}`);
  if (mission.status !== MISSION_STATES.ACTIVE && mission.status !== MISSION_STATES.WAITING) {
    throw new Error(`mission ${mission.id} is ${mission.status}; only ACTIVE/WAITING missions accept triggers`);
  }

  if (spec?.tenant !== mission.tenant) {
    throw new Error(`trigger tenant ${String(spec?.tenant)} does not match mission tenant ${mission.tenant}`);
  }

  const verdict = validateTriggerSpec(spec, { now });
  if (!verdict.ok) {
    throw new Error(`trigger spec rejected: ${verdict.errors.join('; ')}`);
  }

  // L3: no self-raised authority — the database never stores an escalation.
  if (!ceilingWithin(spec.authorityCeiling, mission.authorityCeiling)) {
    throw new Error(
      `authority ceiling ${spec.authorityCeiling} exceeds mission ceiling ${mission.authorityCeiling} — escalation is a human act`,
    );
  }
  const reservedBudget = await prisma.continuationTrigger.aggregate({
    where: { missionId: mission.id },
    _sum: { budgetCentsMax: true },
  });
  const allocatedBudgetCents = reservedBudget._sum.budgetCentsMax ?? 0;
  if (allocatedBudgetCents + spec.budgetCentsMax > mission.budgetCentsMax) {
    throw new Error(
      `trigger budget allocation ${allocatedBudgetCents + spec.budgetCentsMax} exceeds mission budget ceiling ${mission.budgetCentsMax}`,
    );
  }
  if (spec.triggerType === 'DEPENDENCY') {
    const dependency = await prisma.continuationTrigger.findUnique({
      where: { id: spec.dependsOnTriggerId },
      select: { missionId: true, tenant: true },
    });
    if (!dependency || dependency.missionId !== mission.id || dependency.tenant !== mission.tenant) {
      throw new Error('dependency must belong to the same mission and tenant');
    }
  }

  return prisma.continuationTrigger.create({
    data: {
      missionId: mission.id,
      tenant: spec.tenant,
      triggerType: spec.triggerType,
      reason: spec.reason,
      createdFrom: spec.createdFrom,
      status: verdict.initialStatus,
      nextEligibleAt: spec.nextEligibleAt ?? null,
      eventKey: spec.eventKey ?? null,
      conditionRef: spec.conditionRef ?? null,
      dependsOnTriggerId: spec.dependsOnTriggerId ?? null,
      authorityCeiling: spec.authorityCeiling,
      budgetCentsMax: spec.budgetCentsMax,
      stopCondition: spec.stopCondition,
      evidenceRequirements: spec.evidenceRequirements ?? null,
      continuationPolicy: spec.continuationPolicy ?? null,
      retryPolicy: spec.retryPolicy ?? null,
      expiresAt: spec.expiresAt,
    },
  });
}

export async function createTrigger(prisma, spec, { now = new Date() } = {}) {
  if (typeof prisma?.$transaction !== 'function') {
    return createTriggerInTransaction(prisma, spec, now);
  }
  return inSerializableTransaction(prisma, (tx) => createTriggerInTransaction(tx, spec, now));
}

/** The ONLY path from PENDING_APPROVAL to ARMED. L4. */
export async function approveTrigger(prisma, { triggerId, approvedBy, tickId }) {
  requireNonEmpty(approvedBy, 'approvedBy');
  const approvalTickId = tickId ?? `approval-${Date.now()}`;
  return inSerializableTransaction(prisma, async (tx) => {
    const claimed = await tx.continuationTrigger.updateMany({
      where: { id: triggerId, status: TRIGGER_STATES.PENDING_APPROVAL },
      data: { status: TRIGGER_STATES.ARMED },
    });
    if (claimed.count !== 1) return { approved: false, reason: 'trigger was not PENDING_APPROVAL' };
    const trigger = await tx.continuationTrigger.findUnique({ where: { id: triggerId } });
    const receipt = await appendReceipt(tx, {
      missionId: trigger.missionId,
      triggerId,
      tickId: approvalTickId,
      action: 'APPROVED',
      detail: `approved by ${approvedBy}`,
    }, { retryOnConflict: false });
    return { approved: true, receipt };
  });
}

/**
 * One tick: evaluate ARMED triggers against the injected clock, observed
 * events and evaluated conditions. Idempotent and concurrency-safe — any
 * runtime may call it, at any frequency, from any machine.
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ now?: Date, tickId?: string, events?: string[],
 *           conditionResults?: Record<string, boolean>, limit?: number }} options
 */
export async function runTick(prisma, options = {}) {
  const now = options.now ?? new Date();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new Error('runTick requires a valid injected clock');
  }
  const tickId = options.tickId ?? `tick-${now.getTime()}-${Math.random().toString(36).slice(2, 10)}`;
  const events = new Set(options.events ?? []);
  const conditionResults = new Map(Object.entries(options.conditionResults ?? {}));
  const limit = Math.min(Math.max(1, Number(options.limit) || 50), 500);

  const candidates = await selectTickCandidates(prisma, {
    conditionResults,
    events,
    limit,
    now,
  });

  // Resolve dependency satisfaction from durable state, not memory.
  const dependencyIds = candidates
    .map((t) => t.dependsOnTriggerId)
    .filter((id) => typeof id === 'string' && id.length > 0);
  const satisfiedDependencies = new Set(
    dependencyIds.length === 0
      ? []
      : (
          await prisma.continuationTrigger.findMany({
            where: { id: { in: dependencyIds }, status: TRIGGER_STATES.FIRED },
            select: { id: true },
          })
        ).map((t) => t.id),
  );

  const fired = [];
  const expired = [];
  const waiting = [];
  const receipts = [];
  const successors = [];

  for (const trigger of candidates) {
    const disposition = resolveTriggerDisposition(trigger, {
      now,
      events,
      satisfiedDependencies,
      conditionResults,
    });

    if (disposition.action === 'WAIT' || disposition.action === 'NONE') {
      waiting.push({ id: trigger.id, why: disposition.why });
      continue;
    }

    if (disposition.action === 'EXPIRE') {
      const outcome = await inSerializableTransaction(prisma, async (tx) => {
        const claimed = await tx.continuationTrigger.updateMany({
          where: { id: trigger.id, status: TRIGGER_STATES.ARMED },
          data: { status: TRIGGER_STATES.EXPIRED },
        });
        if (claimed.count !== 1) return null;
        const receipt = await appendReceipt(tx, {
          missionId: trigger.missionId,
          triggerId: trigger.id,
          tickId,
          action: 'EXPIRED',
          detail: disposition.why,
        }, { retryOnConflict: false });
        return { receipt };
      });
      if (outcome) {
        expired.push(trigger.id);
        receipts.push(outcome.receipt);
      }
      continue;
    }

    // FIRE — claim, truth receipt and bounded successor commit as one unit.
    const outcome = await inSerializableTransaction(prisma, async (tx) => {
      const claimed = await tx.continuationTrigger.updateMany({
        where: { id: trigger.id, status: TRIGGER_STATES.ARMED },
        data: { status: TRIGGER_STATES.FIRED, firedAt: now },
      });
      if (claimed.count !== 1) return null;
      const transitionReceipts = [];
      transitionReceipts.push(await appendReceipt(tx, {
        missionId: trigger.missionId,
        triggerId: trigger.id,
        tickId,
        action: 'FIRED',
        detail: disposition.why,
        evidence: JSON.stringify({
          triggerType: trigger.triggerType,
          reason: trigger.reason,
          authorityCeiling: trigger.authorityCeiling,
          firedAt: now.toISOString(),
        }),
      }, { retryOnConflict: false }));

      // Bounded recurrence (L6): successor inherits ceiling verbatim, expiry outranks.
      const successorSpec = nextRescheduledSpec(trigger, { now });
      let successorId = null;
      if (successorSpec) {
        const successor = await createTrigger(tx, successorSpec, { now });
        successorId = successor.id;
        transitionReceipts.push(await appendReceipt(tx, {
          missionId: trigger.missionId,
          triggerId: trigger.id,
          tickId,
          action: 'RESCHEDULED',
          detail: `successor ${successor.id} eligible at ${successorSpec.nextEligibleAt.toISOString()}`,
        }, { retryOnConflict: false }));
      }
      return { receipts: transitionReceipts, successorId };
    });
    if (outcome) {
      fired.push(trigger.id);
      receipts.push(...outcome.receipts);
      if (outcome.successorId) successors.push(outcome.successorId);
    }
  }

  return { tickId, now: now.toISOString(), fired, expired, successors, waiting: waiting.length, receipts };
}
