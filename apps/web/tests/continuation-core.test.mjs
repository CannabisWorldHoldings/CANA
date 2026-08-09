/**
 * SOVEREIGN CONTINUATION KERNEL — pure-core falsification suite.
 *
 * Each law from src/lib/continuation/continuation-core.mjs is attacked here:
 *  L1 unbounded specs are REJECTED (no purpose / stop condition / budget /
 *     ceiling / expiry -> no trigger)
 *  L2 EXPIRED NEVER FIRES, even when due
 *  L3 no self-raised authority
 *  L4 effectful work is born PENDING_APPROVAL
 *  L5 unknown conditions do not fire
 *  L6 recurrence is finite and expiry outranks it
 *
 * No database, no clock reads — everything injected.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTHORITY_CEILINGS,
  ceilingWithin,
  nextRescheduledSpec,
  parseContinuationPolicy,
  resolveTriggerDisposition,
  validateTriggerSpec,
} from '../src/lib/continuation/continuation-core.mjs';

const NOW = new Date('2026-08-09T12:00:00Z');
const FUTURE = new Date('2026-08-16T12:00:00Z');
const PAST = new Date('2026-08-01T12:00:00Z');

function validSpec(overrides = {}) {
  return {
    missionId: 'mission-1',
    tenant: 'orderweeddc.com',
    triggerType: 'SCHEDULED',
    reason: 'nightly market-gap recheck',
    createdFrom: 'OWNER_REQUEST',
    stopCondition: 'gap closed or recurrence exhausted',
    budgetCentsMax: 100,
    authorityCeiling: AUTHORITY_CEILINGS.OBSERVE_ONLY,
    nextEligibleAt: new Date('2026-08-10T12:00:00Z'),
    expiresAt: FUTURE,
    ...overrides,
  };
}

// ---------------------------------------------------------------- L1
test('L1: a spec missing stopCondition is REJECTED', () => {
  const verdict = validateTriggerSpec(validSpec({ stopCondition: '  ' }), { now: NOW });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.errors.some((e) => e.includes('stopCondition')), verdict.errors.join(';'));
});

test('L1: a spec missing reason (purpose) is REJECTED', () => {
  const verdict = validateTriggerSpec(validSpec({ reason: '' }), { now: NOW });
  assert.equal(verdict.ok, false);
});

test('L1: a spec with no budget ceiling is REJECTED', () => {
  for (const bad of [0, -5, 2.5, NaN, Infinity, null, undefined, 'lots']) {
    const verdict = validateTriggerSpec(validSpec({ budgetCentsMax: bad }), { now: NOW });
    assert.equal(verdict.ok, false, `budget ${String(bad)} must be rejected`);
  }
});

test('L1: a spec with no expiry, or a past expiry, is REJECTED', () => {
  assert.equal(validateTriggerSpec(validSpec({ expiresAt: undefined }), { now: NOW }).ok, false);
  assert.equal(validateTriggerSpec(validSpec({ expiresAt: PAST }), { now: NOW }).ok, false);
});

test('L1: an unknown authority ceiling is REJECTED', () => {
  const verdict = validateTriggerSpec(validSpec({ authorityCeiling: 'GOD_MODE' }), { now: NOW });
  assert.equal(verdict.ok, false);
});

test('L1: type-specific bindings are required (EVENT needs eventKey, etc.)', () => {
  assert.equal(validateTriggerSpec(validSpec({ triggerType: 'EVENT', eventKey: undefined }), { now: NOW }).ok, false);
  assert.equal(validateTriggerSpec(validSpec({ triggerType: 'CONDITION_WATCH', conditionRef: undefined }), { now: NOW }).ok, false);
  assert.equal(validateTriggerSpec(validSpec({ triggerType: 'DEPENDENCY', dependsOnTriggerId: undefined }), { now: NOW }).ok, false);
  assert.equal(validateTriggerSpec(validSpec({ triggerType: 'SCHEDULED', nextEligibleAt: undefined }), { now: NOW }).ok, false);
});

// ---------------------------------------------------------------- L4
test('L4: OBSERVE_ONLY arms automatically; EFFECTFUL is born PENDING_APPROVAL', () => {
  const observe = validateTriggerSpec(validSpec(), { now: NOW });
  assert.deepEqual([observe.ok, observe.initialStatus], [true, 'ARMED']);

  const effectful = validateTriggerSpec(
    validSpec({ authorityCeiling: AUTHORITY_CEILINGS.EFFECTFUL_WITH_APPROVAL }),
    { now: NOW },
  );
  assert.deepEqual([effectful.ok, effectful.initialStatus], [true, 'PENDING_APPROVAL']);
});

// ---------------------------------------------------------------- L3
test('L3: authority ordering — a child may never exceed its parent', () => {
  assert.equal(ceilingWithin('OBSERVE_ONLY', 'PROPOSE_ONLY'), true);
  assert.equal(ceilingWithin('PROPOSE_ONLY', 'PROPOSE_ONLY'), true);
  assert.equal(ceilingWithin('EFFECTFUL_WITH_APPROVAL', 'PROPOSE_ONLY'), false);
  assert.equal(ceilingWithin('PROPOSE_ONLY', 'OBSERVE_ONLY'), false);
  assert.throws(() => ceilingWithin('SUDO', 'OBSERVE_ONLY'));
});

// ---------------------------------------------------------------- L2
test('L2: a trigger that is BOTH due and expired EXPIRES — it never fires late', () => {
  const trigger = {
    status: 'ARMED',
    triggerType: 'SCHEDULED',
    nextEligibleAt: new Date('2026-08-09T09:00:00Z'), // due
    expiresAt: new Date('2026-08-09T10:00:00Z'), // expired before now
  };
  const disposition = resolveTriggerDisposition(trigger, { now: NOW });
  assert.equal(disposition.action, 'EXPIRE', disposition.why);
});

test('L2: an unreadable expiry fails closed to EXPIRE, never FIRE', () => {
  const trigger = { status: 'ARMED', triggerType: 'SCHEDULED', nextEligibleAt: PAST, expiresAt: 'not-a-date' };
  assert.equal(resolveTriggerDisposition(trigger, { now: NOW }).action, 'EXPIRE');
});

test('dueness: not-yet-due waits; due fires', () => {
  const base = { status: 'ARMED', triggerType: 'FOLLOW_UP', expiresAt: FUTURE };
  assert.equal(resolveTriggerDisposition({ ...base, nextEligibleAt: FUTURE }, { now: NOW }).action, 'WAIT');
  assert.equal(resolveTriggerDisposition({ ...base, nextEligibleAt: PAST }, { now: NOW }).action, 'FIRE');
});

test('EVENT: fires only on the exact observed event key', () => {
  const trigger = { status: 'ARMED', triggerType: 'EVENT', eventKey: 'pr.merged:CANA#29', expiresAt: FUTURE };
  assert.equal(resolveTriggerDisposition(trigger, { now: NOW, events: new Set() }).action, 'WAIT');
  assert.equal(resolveTriggerDisposition(trigger, { now: NOW, events: new Set(['pr.merged:CANA#30']) }).action, 'WAIT');
  assert.equal(resolveTriggerDisposition(trigger, { now: NOW, events: new Set(['pr.merged:CANA#29']) }).action, 'FIRE');
});

// ---------------------------------------------------------------- L5
test('L5: an UNEVALUATED condition waits (unknown never fires); false waits; true fires', () => {
  const trigger = { status: 'ARMED', triggerType: 'CONDITION_WATCH', conditionRef: 'gap.persists', expiresAt: FUTURE };
  assert.equal(resolveTriggerDisposition(trigger, { now: NOW }).action, 'WAIT');
  assert.equal(
    resolveTriggerDisposition(trigger, { now: NOW, conditionResults: new Map([['gap.persists', false]]) }).action,
    'WAIT',
  );
  assert.equal(
    resolveTriggerDisposition(trigger, { now: NOW, conditionResults: new Map([['gap.persists', true]]) }).action,
    'FIRE',
  );
});

test('DEPENDENCY: unmet dependency NEVER fires; met dependency fires', () => {
  const trigger = { status: 'ARMED', triggerType: 'DEPENDENCY', dependsOnTriggerId: 't-1', expiresAt: FUTURE };
  assert.equal(resolveTriggerDisposition(trigger, { now: NOW }).action, 'WAIT');
  assert.equal(resolveTriggerDisposition(trigger, { now: NOW, satisfiedDependencies: new Set(['t-2']) }).action, 'WAIT');
  assert.equal(resolveTriggerDisposition(trigger, { now: NOW, satisfiedDependencies: new Set(['t-1']) }).action, 'FIRE');
});

test('non-ARMED triggers are never evaluated for firing', () => {
  for (const status of ['PENDING_APPROVAL', 'FIRED', 'EXPIRED', 'CANCELLED', 'REJECTED']) {
    const trigger = { status, triggerType: 'SCHEDULED', nextEligibleAt: PAST, expiresAt: FUTURE };
    assert.equal(resolveTriggerDisposition(trigger, { now: NOW }).action, 'NONE', status);
  }
});

// ---------------------------------------------------------------- L6
test('L6: continuation policy must be finite and well-formed', () => {
  assert.equal(parseContinuationPolicy(null).policy, null);
  assert.equal(parseContinuationPolicy(JSON.stringify({ kind: 'RESCHEDULE', intervalMs: 1000, remaining: 2 })).ok, true);
  assert.equal(parseContinuationPolicy(JSON.stringify({ kind: 'RESCHEDULE', intervalMs: -1, remaining: 2 })).ok, false);
  assert.equal(parseContinuationPolicy(JSON.stringify({ kind: 'RESCHEDULE', intervalMs: 1000, remaining: Infinity })).ok, false);
  assert.equal(parseContinuationPolicy({ kind: 'RESCHEDULE', intervalMs: null, remaining: 2 }).ok, false);
  assert.equal(parseContinuationPolicy({ kind: 'RESCHEDULE', intervalMs: 1000, remaining: null }).ok, false);
  assert.equal(parseContinuationPolicy({ kind: 'RESCHEDULE', intervalMs: NaN, remaining: 2 }).ok, false);
  assert.equal(parseContinuationPolicy(JSON.stringify({ kind: 'FOREVER' })).ok, false);
  assert.equal(parseContinuationPolicy('not json').ok, false);
});

test('L6: an invalid injected clock cannot create an invalid successor', () => {
  const trigger = {
    id: 't-clock', missionId: 'm-1', tenant: 'x', triggerType: 'FOLLOW_UP', reason: 'recheck',
    stopCondition: 'closed', budgetCentsMax: 100, authorityCeiling: 'OBSERVE_ONLY',
    expiresAt: FUTURE,
    continuationPolicy: JSON.stringify({ kind: 'RESCHEDULE', intervalMs: 1000, remaining: 1 }),
  };
  assert.equal(nextRescheduledSpec(trigger, { now: new Date('invalid') }), null);
});

test('L6: remaining=0 produces NO successor — recurrence is finite', () => {
  const trigger = {
    id: 't-1', missionId: 'm-1', tenant: 'x', triggerType: 'FOLLOW_UP', reason: 'r',
    stopCondition: 's', budgetCentsMax: 100, authorityCeiling: 'OBSERVE_ONLY',
    expiresAt: FUTURE,
    continuationPolicy: JSON.stringify({ kind: 'RESCHEDULE', intervalMs: 1000, remaining: 0 }),
  };
  assert.equal(nextRescheduledSpec(trigger, { now: NOW }), null);
});

test('L6: expiry outranks recurrence — no successor born at/after the hard expiry', () => {
  const trigger = {
    id: 't-1', missionId: 'm-1', tenant: 'x', triggerType: 'FOLLOW_UP', reason: 'r',
    stopCondition: 's', budgetCentsMax: 100, authorityCeiling: 'OBSERVE_ONLY',
    expiresAt: new Date(NOW.getTime() + 500), // expires in 500ms
    continuationPolicy: JSON.stringify({ kind: 'RESCHEDULE', intervalMs: 1000, remaining: 5 }),
  };
  assert.equal(nextRescheduledSpec(trigger, { now: NOW }), null);
});

test('L6+L3: a successor decrements remaining and inherits the ceiling VERBATIM', () => {
  const trigger = {
    id: 't-1', missionId: 'm-1', tenant: 'x', triggerType: 'FOLLOW_UP', reason: 'recheck',
    stopCondition: 'closed', budgetCentsMax: 100, authorityCeiling: 'OBSERVE_ONLY',
    expiresAt: FUTURE,
    continuationPolicy: JSON.stringify({ kind: 'RESCHEDULE', intervalMs: 60_000, remaining: 2 }),
  };
  const successor = nextRescheduledSpec(trigger, { now: NOW });
  assert.ok(successor);
  assert.equal(successor.authorityCeiling, 'OBSERVE_ONLY');
  assert.equal(JSON.parse(successor.continuationPolicy).remaining, 1);
  assert.equal(successor.nextEligibleAt.getTime(), NOW.getTime() + 60_000);
  assert.equal(successor.createdFrom, 'RESCHEDULE_OF:t-1');
  // the chain terminates: 2 -> 1 -> 0 -> null
  const third = nextRescheduledSpec({ ...trigger, continuationPolicy: successor.continuationPolicy }, { now: NOW });
  assert.equal(JSON.parse(third.continuationPolicy).remaining, 0);
  assert.equal(nextRescheduledSpec({ ...trigger, continuationPolicy: third.continuationPolicy }, { now: NOW }), null);
});
