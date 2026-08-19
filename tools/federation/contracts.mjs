#!/usr/bin/env node
/**
 * CANA FEDERATION — GATE B: AGENT PASSPORTS + TASK/RESULT CONTRACTS
 *
 * Typed delegation instead of free-form agent conversation (§11–§12).
 * Fail-closed: an unqualified passport, an unbounded task, or an
 * evidence-free result is marked invalid with reasons.
 *
 * PERMANENT AUTHORITY LAW (§4) is enforced structurally:
 *   CAPABILITY ≠ AUTHORITY — a passport lists capabilities AND a separate
 *   authority level; possessing a capability never implies permission.
 *   Owner-gated actions are refused at contract-validation time regardless
 *   of authority level, because this substrate has no owner-gate channel.
 */
import { createHash } from 'node:crypto';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const text = (v) => typeof v === 'string' && v.trim().length > 0;
const num = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const joinParts = (...parts) => parts.map((p) => { const t = String(p ?? ''); return `${t.length}:${t}`; }).join('|');

/** Actions that stay owner-gated no matter what any passport claims. */
export const OWNER_GATED_ACTIONS = [
  'merge_pr', 'deploy_production', 'dns_change', 'mutate_production_db',
  'merchant_outreach', 'mass_email', 'spend_money', 'paid_api',
  'publish_merchant_imagery', 'public_commercial_claim', 'push_remote',
];

export const AUTHORITY_LEVELS = ['OBSERVER', 'PROPOSER', 'LOCAL_EXECUTOR', 'LANE_SUPERVISOR'];

/** Who a worker is, what it CAN do, and separately what it MAY do. */
export function makeAgentPassport(p) {
  const errors = [];
  if (!text(p?.agentId)) errors.push('agentId required');
  if (!text(p?.roleFamily)) errors.push('roleFamily required — role is sovereignty, not a vendor name');
  if (!Array.isArray(p?.capabilities) || p.capabilities.length === 0) errors.push('capabilities[] required');
  if (!AUTHORITY_LEVELS.includes(p?.authorityLevel)) errors.push(`authorityLevel must be one of ${AUTHORITY_LEVELS.join('|')}`);
  if (!Array.isArray(p?.forbiddenActions)) errors.push('forbiddenActions[] required');
  const missingGates = OWNER_GATED_ACTIONS.filter((a) => !(p?.forbiddenActions ?? []).includes(a));
  if (missingGates.length > 0) errors.push(`owner-gated actions must be explicitly forbidden on every passport; missing: ${missingGates.join(', ')}`);
  if (p?.qualifiedModels != null && !Array.isArray(p.qualifiedModels)) errors.push('qualifiedModels must be a list when present');
  if (!num(p?.costCeilingUsd)) errors.push('costCeilingUsd required (finite >= 0)');
  return {
    passport_id: 'ap_' + sha(joinParts(p?.agentId, p?.roleFamily)).slice(0, 16),
    agent_id: p?.agentId ?? null,
    role_family: p?.roleFamily ?? null,
    capabilities: p?.capabilities ?? [],
    qualified_models: p?.qualifiedModels ?? [],
    memory_read_scope: p?.memoryReadScope ?? [],
    memory_write_scope: p?.memoryWriteScope ?? [],
    allowed_actions: p?.allowedActions ?? [],
    forbidden_actions: p?.forbiddenActions ?? [],
    authority_level: p?.authorityLevel ?? null,
    cost_ceiling_usd: p?.costCeilingUsd ?? null,
    benchmark_receipts: p?.benchmarkReceipts ?? [],
    valid: errors.length === 0,
    errors,
  };
}

/** A bounded unit of delegated work (§12). No stop rule, no task. */
export function makeTaskContract(t) {
  const errors = [];
  if (!text(t?.missionId)) errors.push('missionId required');
  if (!text(t?.goal)) errors.push('goal required');
  if (!text(t?.requiredCapability)) errors.push('requiredCapability required');
  if (!text(t?.successPredicate)) errors.push('successPredicate required — unsuccess-testable work is not delegable');
  if (!text(t?.stopRule)) errors.push('stopRule required — unbounded delegation is forbidden');
  if (!text(t?.rollbackExpectation)) errors.push('rollbackExpectation required');
  if (!num(t?.costBudgetUsd)) errors.push('costBudgetUsd required (finite >= 0)');
  if (!text(t?.expectedArtifact)) errors.push('expectedArtifact required');
  const passport = t?.passport;
  if (!passport?.valid) errors.push('a VALID AgentPassport is required');
  else {
    if (!passport.capabilities.includes(t?.requiredCapability)) {
      errors.push(`passport ${passport.agent_id} lacks required capability "${t?.requiredCapability}" — CAPABILITY GATE`);
    }
    if ((t?.requestedActions ?? []).some((a) => passport.forbidden_actions.includes(a))) {
      errors.push('task requests an action the passport forbids — AUTHORITY GATE');
    }
    if (num(t?.costBudgetUsd) && t.costBudgetUsd > passport.cost_ceiling_usd) {
      errors.push(`task budget ${t.costBudgetUsd} exceeds passport ceiling ${passport.cost_ceiling_usd} — BUDGET GATE`);
    }
  }
  return {
    task_id: 'tc_' + sha(joinParts(t?.missionId, t?.goal, passport?.passport_id)).slice(0, 16),
    mission_id: t?.missionId ?? null,
    goal: t?.goal ?? null,
    required_capability: t?.requiredCapability ?? null,
    passport_id: passport?.passport_id ?? null,
    inputs: t?.inputs ?? [],
    requested_actions: t?.requestedActions ?? [],
    expected_artifact: t?.expectedArtifact ?? null,
    success_predicate: t?.successPredicate ?? null,
    stop_rule: t?.stopRule ?? null,
    rollback_expectation: t?.rollbackExpectation ?? null,
    cost_budget_usd: t?.costBudgetUsd ?? null,
    valid: errors.length === 0,
    errors,
  };
}

/** What the worker actually returns. Evidence-free results are invalid. */
export function makeResultContract(r) {
  const errors = [];
  if (!r?.task?.valid) errors.push('result must bind a VALID TaskContract');
  if (!text(r?.artifact)) errors.push('artifact required (path or ref)');
  if (!Array.isArray(r?.evidence) || r.evidence.length === 0) errors.push('evidence[] required — an unevidenced result is a claim, not a result');
  for (const e of r?.evidence ?? []) if (!text(e?.ref)) errors.push('every evidence item needs a retrievable ref');
  if (!Array.isArray(r?.failedChecks)) errors.push('failedChecks[] required (empty allowed, absent not)');
  if (!num(r?.costUsd)) errors.push('costUsd required');
  if (!text(r?.uncertainty)) errors.push('uncertainty required — state what remains unknown, or state NONE_DECLARED and own it');
  return {
    result_id: 'rc_' + sha(joinParts(r?.task?.task_id, r?.artifact)).slice(0, 16),
    task_id: r?.task?.task_id ?? null,
    artifact: r?.artifact ?? null,
    evidence: r?.evidence ?? [],
    uncertainty: r?.uncertainty ?? null,
    failed_checks: r?.failedChecks ?? [],
    cost_usd: r?.costUsd ?? null,
    recommended_next_action: r?.recommendedNextAction ?? null,
    valid: errors.length === 0,
    errors,
  };
}
