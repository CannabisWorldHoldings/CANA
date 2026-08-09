/**
 * SOVEREIGN CONTINUATION KERNEL — pure core (no I/O, no clock, no database).
 *
 * Owner mandate (2026-08-09): CANA itself must remember what must happen
 * later. A conversation ending, a model failing, a provider outage or a
 * machine restart must not erase a future mission. This module owns the
 * continuation SEMANTICS; ../continuation/continuation-repository.mjs owns
 * the durable state; external runtimes (cPanel cron worker, Hyperagent,
 * Temporal, a laptop) merely WAKE the state by invoking a tick. None of them
 * is the sovereign scheduler.
 *
 * Laws enforced here (falsification-tested in tests/continuation-core.test.mjs):
 *
 *  L1  BOUNDED BY CONSTRUCTION. A trigger spec without an explicit purpose
 *      (reason), stop condition, budget ceiling, authority ceiling and expiry
 *      is REJECTED. There is no such thing as an unbounded continuation.
 *  L2  EXPIRED NEVER FIRES. Expiry is evaluated before dueness. A trigger due
 *      at 09:00 that expired at 08:00 EXPIRES; it does not fire late.
 *  L3  NO SELF-RAISED AUTHORITY. A child continuation's authority ceiling can
 *      never exceed its creator's ceiling. Escalation is a human act.
 *  L4  EFFECTFUL WORK IS BORN UNARMED. OBSERVE_ONLY/PROPOSE_ONLY triggers may
 *      arm automatically; EFFECTFUL_WITH_APPROVAL is born PENDING_APPROVAL
 *      and only an explicit approval arms it.
 *  L5  UNKNOWN CONDITIONS DO NOT FIRE. A CONDITION_WATCH whose condition has
 *      no evaluated result waits. Absence of evidence is not truth.
 *  L6  RECURRENCE IS FINITE. A reschedule policy must carry a finite
 *      `remaining` count, and no successor may be born eligible at or beyond
 *      the hard expiry. No uncontrolled infinite loops.
 *
 * Everything here is deterministic: the caller injects `now`, observed
 * events and condition evaluations. Condition evaluators are capability
 * providers; the kernel never reaches out to reality on its own.
 */

export const TRIGGER_TYPES = Object.freeze({
  SCHEDULED: 'SCHEDULED',
  EVENT: 'EVENT',
  CONDITION_WATCH: 'CONDITION_WATCH',
  DEPENDENCY: 'DEPENDENCY',
  FOLLOW_UP: 'FOLLOW_UP',
  REVALIDATION: 'REVALIDATION',
  LEARNING: 'LEARNING',
});

export const TRIGGER_STATES = Object.freeze({
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  ARMED: 'ARMED',
  FIRED: 'FIRED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
  REJECTED: 'REJECTED',
});

export const MISSION_STATES = Object.freeze({
  PROPOSED: 'PROPOSED',
  ACTIVE: 'ACTIVE',
  WAITING: 'WAITING',
  COMPLETED: 'COMPLETED',
  ABANDONED: 'ABANDONED',
  EXPIRED: 'EXPIRED',
});

/**
 * Authority ceilings, least to most consequential. Rank order is the law;
 * names are the vocabulary. OBSERVE_ONLY reads reality; PROPOSE_ONLY may
 * create proposals/opportunities/records for humans; EFFECTFUL_WITH_APPROVAL
 * may change reality but only through approval + commit-time authority.
 */
const AUTHORITY_RANKS = Object.freeze({
  OBSERVE_ONLY: 0,
  PROPOSE_ONLY: 1,
  EFFECTFUL_WITH_APPROVAL: 2,
});

export const AUTHORITY_CEILINGS = Object.freeze(
  Object.fromEntries(Object.keys(AUTHORITY_RANKS).map((k) => [k, k])),
);

export function authorityRank(ceiling) {
  const rank = AUTHORITY_RANKS[ceiling];
  if (rank === undefined) throw new Error(`unknown authority ceiling: ${String(ceiling)}`);
  return rank;
}

/** True when `child` does not exceed `parent`. L3. */
export function ceilingWithin(child, parent) {
  return authorityRank(child) <= authorityRank(parent);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function asValidDate(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value);
    if (Number.isFinite(d.getTime())) return d;
  }
  return null;
}

/** Parse and validate a continuation policy JSON string. L6. */
export function parseContinuationPolicy(raw) {
  if (raw === null || raw === undefined) return { ok: true, policy: null };
  let parsed;
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return { ok: false, error: 'continuationPolicy is not valid JSON' };
  }
  if (parsed === null) return { ok: true, policy: null };
  if (parsed.kind !== 'RESCHEDULE') {
    return { ok: false, error: `unknown continuationPolicy kind: ${String(parsed.kind)}` };
  }
  // typeof checks BEFORE coercion: Number(null) is 0, and JSON.stringify
  // turns Infinity into null — coercion would smuggle absence past the law.
  if (typeof parsed.intervalMs !== 'number' || !Number.isFinite(parsed.intervalMs) || parsed.intervalMs <= 0) {
    return { ok: false, error: 'continuationPolicy.intervalMs must be a positive finite number' };
  }
  if (typeof parsed.remaining !== 'number' || !Number.isInteger(parsed.remaining) || parsed.remaining < 0) {
    return { ok: false, error: 'continuationPolicy.remaining must be an explicit finite non-negative integer' };
  }
  const { intervalMs, remaining } = parsed;
  return { ok: true, policy: { kind: 'RESCHEDULE', intervalMs, remaining } };
}

const TYPE_REQUIREMENTS = Object.freeze({
  SCHEDULED: 'nextEligibleAt',
  FOLLOW_UP: 'nextEligibleAt',
  REVALIDATION: 'nextEligibleAt',
  LEARNING: 'nextEligibleAt',
  EVENT: 'eventKey',
  CONDITION_WATCH: 'conditionRef',
  DEPENDENCY: 'dependsOnTriggerId',
});

/**
 * Validate a trigger spec. L1 + L4. Returns
 * `{ ok: true, initialStatus }` or `{ ok: false, errors: string[] }`.
 * Never throws for bad input — rejection is a state, not an exception.
 */
export function validateTriggerSpec(spec, { now = new Date() } = {}) {
  const errors = [];
  if (!spec || typeof spec !== 'object') return { ok: false, errors: ['spec must be an object'] };

  if (!isNonEmptyString(spec.missionId)) errors.push('missionId is required');
  if (!isNonEmptyString(spec.tenant)) errors.push('tenant is required');
  if (!TRIGGER_TYPES[spec.triggerType]) errors.push(`triggerType must be one of ${Object.keys(TRIGGER_TYPES).join('|')}`);
  if (!isNonEmptyString(spec.reason)) errors.push('reason (purpose) is required — a trigger with no reason is rejected');
  if (!isNonEmptyString(spec.createdFrom)) errors.push('createdFrom (provenance) is required');
  if (!isNonEmptyString(spec.stopCondition)) errors.push('stopCondition is required — no unbounded continuations');

  if (!Number.isInteger(spec.budgetCentsMax) || spec.budgetCentsMax <= 0) {
    errors.push('budgetCentsMax must be a positive integer — a continuation without a budget ceiling is rejected');
  }

  try {
    authorityRank(spec.authorityCeiling);
  } catch {
    errors.push(`authorityCeiling must be one of ${Object.keys(AUTHORITY_RANKS).join('|')}`);
  }

  const expiresAt = asValidDate(spec.expiresAt);
  if (!expiresAt) errors.push('expiresAt is required — every trigger has a hard expiry');
  else if (expiresAt.getTime() <= now.getTime()) errors.push('expiresAt must be in the future');

  const requiredField = TYPE_REQUIREMENTS[spec.triggerType];
  if (requiredField) {
    if (requiredField === 'nextEligibleAt') {
      if (!asValidDate(spec.nextEligibleAt)) errors.push(`${spec.triggerType} triggers require a valid nextEligibleAt`);
    } else if (!isNonEmptyString(spec[requiredField])) {
      errors.push(`${spec.triggerType} triggers require ${requiredField}`);
    }
  }

  const policy = parseContinuationPolicy(spec.continuationPolicy);
  if (!policy.ok) errors.push(policy.error);

  if (errors.length > 0) return { ok: false, errors };

  const initialStatus =
    spec.authorityCeiling === AUTHORITY_CEILINGS.EFFECTFUL_WITH_APPROVAL
      ? TRIGGER_STATES.PENDING_APPROVAL
      : TRIGGER_STATES.ARMED;
  return { ok: true, initialStatus };
}

/**
 * Decide what a tick should do with one trigger. Pure. L2 + L5.
 *
 * @param {object} trigger row-shaped object
 * @param {{ now: Date, events?: Set<string>, satisfiedDependencies?: Set<string>,
 *           conditionResults?: Map<string, boolean> }} ctx
 * @returns {{ action: 'FIRE'|'WAIT'|'EXPIRE'|'NONE', why: string }}
 */
export function resolveTriggerDisposition(trigger, ctx) {
  const now = ctx?.now instanceof Date ? ctx.now : null;
  if (!now) throw new Error('resolveTriggerDisposition requires ctx.now (injected clock)');

  if (trigger.status !== TRIGGER_STATES.ARMED) {
    return { action: 'NONE', why: `status is ${trigger.status}, only ARMED triggers are evaluated` };
  }

  // L2: expiry is checked BEFORE dueness. Expired work never fires late.
  const expiresAt = asValidDate(trigger.expiresAt);
  if (!expiresAt) return { action: 'EXPIRE', why: 'expiresAt is unreadable — fail closed, never fire' };
  if (expiresAt.getTime() <= now.getTime()) {
    return { action: 'EXPIRE', why: `expired at ${expiresAt.toISOString()}` };
  }

  switch (trigger.triggerType) {
    case TRIGGER_TYPES.SCHEDULED:
    case TRIGGER_TYPES.FOLLOW_UP:
    case TRIGGER_TYPES.REVALIDATION:
    case TRIGGER_TYPES.LEARNING: {
      const due = asValidDate(trigger.nextEligibleAt);
      if (!due) return { action: 'WAIT', why: 'nextEligibleAt unreadable — waiting, never guessing' };
      return due.getTime() <= now.getTime()
        ? { action: 'FIRE', why: `due since ${due.toISOString()}` }
        : { action: 'WAIT', why: `eligible at ${due.toISOString()}` };
    }
    case TRIGGER_TYPES.EVENT: {
      const events = ctx.events ?? new Set();
      return events.has(trigger.eventKey)
        ? { action: 'FIRE', why: `event observed: ${trigger.eventKey}` }
        : { action: 'WAIT', why: `waiting for event: ${trigger.eventKey}` };
    }
    case TRIGGER_TYPES.CONDITION_WATCH: {
      const results = ctx.conditionResults ?? new Map();
      if (!results.has(trigger.conditionRef)) {
        // L5: an unevaluated condition is UNKNOWN. Unknown does not fire.
        return { action: 'WAIT', why: `condition not evaluated this tick: ${trigger.conditionRef} (UNKNOWN does not fire)` };
      }
      return results.get(trigger.conditionRef) === true
        ? { action: 'FIRE', why: `condition true: ${trigger.conditionRef}` }
        : { action: 'WAIT', why: `condition false: ${trigger.conditionRef}` };
    }
    case TRIGGER_TYPES.DEPENDENCY: {
      const satisfied = ctx.satisfiedDependencies ?? new Set();
      return satisfied.has(trigger.dependsOnTriggerId)
        ? { action: 'FIRE', why: `dependency fired: ${trigger.dependsOnTriggerId}` }
        : { action: 'WAIT', why: `dependency not fired: ${trigger.dependsOnTriggerId}` };
    }
    default:
      return { action: 'WAIT', why: `unknown trigger type ${String(trigger.triggerType)} — fail closed, never fire` };
  }
}

/**
 * Compute the successor spec for a fired trigger with a RESCHEDULE policy.
 * Returns null when recurrence is exhausted or the successor would be born
 * eligible at/after the hard expiry. L6: expiry outranks recurrence.
 */
export function nextRescheduledSpec(trigger, { now }) {
  const parsed = parseContinuationPolicy(trigger.continuationPolicy);
  if (!parsed.ok || !parsed.policy) return null;
  const { intervalMs, remaining } = parsed.policy;
  if (remaining <= 0) return null;

  const expiresAt = asValidDate(trigger.expiresAt);
  const nextEligibleAt = new Date(now.getTime() + intervalMs);
  if (!expiresAt || nextEligibleAt.getTime() >= expiresAt.getTime()) return null;

  return {
    missionId: trigger.missionId,
    tenant: trigger.tenant,
    triggerType: trigger.triggerType,
    reason: trigger.reason,
    createdFrom: `RESCHEDULE_OF:${trigger.id}`,
    stopCondition: trigger.stopCondition,
    budgetCentsMax: trigger.budgetCentsMax,
    // L3: a successor NEVER exceeds its parent's ceiling — same ceiling, verbatim.
    authorityCeiling: trigger.authorityCeiling,
    nextEligibleAt,
    eventKey: trigger.eventKey ?? null,
    conditionRef: trigger.conditionRef ?? null,
    dependsOnTriggerId: null,
    evidenceRequirements: trigger.evidenceRequirements ?? null,
    retryPolicy: trigger.retryPolicy ?? null,
    expiresAt,
    continuationPolicy: JSON.stringify({ kind: 'RESCHEDULE', intervalMs, remaining: remaining - 1 }),
  };
}

export const GENESIS_HASH = 'CONTINUATION_GENESIS';

/** Canonical JSON: stable key order so hashes are reproducible. */
function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

/**
 * Hash a receipt body into the per-mission chain (pattern: demand-credit
 * ledger). The hash binds sequence, mission, trigger, tick, action, detail
 * and evidence to the previous hash — receipts are tamper-evident.
 */
export async function receiptHash(body, prevHash) {
  const { createHash } = await import('node:crypto');
  const preimage = `${prevHash}|${canonicalJson({
    seq: body.seq,
    missionId: body.missionId,
    triggerId: body.triggerId ?? null,
    tickId: body.tickId,
    action: body.action,
    detail: body.detail ?? null,
    evidence: body.evidence ?? null,
  })}`;
  return createHash('sha256').update(preimage, 'utf8').digest('hex');
}
