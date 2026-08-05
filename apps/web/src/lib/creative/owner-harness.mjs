/**
 * SiteMind Owner Feedback Harness
 * Accepts structured owner decisions, enforces rejection reasons, and updates taste memory with tenant isolation.
 */

import { recordOwnerDecisionRule } from './taste-engine.mjs';

export const OWNER_ACTIONS = Object.freeze([
  'APPROVE',
  'REJECT',
  'APPROVE_WITH_CHANGES',
  'PREFER_A_OVER_B',
  'PREFER_B_OVER_A',
  'SAVE_AS_REFERENCE',
  'PROMOTE_TO_BRAND_STANDARD',
  'RETIRE',
  'SUPERSEDE',
  'REQUEST_STRUCTURAL_MUTATION',
  'REQUEST_COSMETIC_MUTATION',
  'OWNER_APPROVAL_PENDING',
]);

export const REJECTION_REASONS = Object.freeze([
  'wrong brand',
  'weak wordmark',
  'poor composition',
  'generic',
  'too green',
  'too dark',
  'too sterile',
  'cluttered',
  'weak hierarchy',
  'weak mobile crop',
  'poor typography',
  'poor product focus',
  'low trust',
  'low originality',
  'competitor similarity',
  'unsupported claim',
  'wrong audience',
  'wrong offer',
  'wrong placement',
  'rights concern',
  'other',
]);

export async function recordOwnerCreativeDecision({
  creativeId,
  tenantId = 'orderweeddc',
  action,
  rejectionReason,
  rejectionNotes,
  supersedesRuleId,
  isTestFixture = false,
  decisionAuthority = 'OWNER_EXPLICIT',
}) {
  if (!OWNER_ACTIONS.includes(action)) {
    throw new TypeError(`Invalid owner action: ${action}. Must be one of: ${OWNER_ACTIONS.join(', ')}`);
  }

  if (action === 'REJECT' && (!rejectionReason || !REJECTION_REASONS.includes(rejectionReason))) {
    throw new TypeError(`Rejection action requires a valid rejection reason from whitelist.`);
  }

  const isEligible = !isTestFixture && decisionAuthority === 'OWNER_EXPLICIT';

  let ruleRecord = null;
  if (action === 'REJECT' && rejectionReason) {
    ruleRecord = await recordOwnerDecisionRule({
      ruleId: `reject-rule-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      tenantId,
      ruleCategory: 'REJECTED_PATTERN',
      ruleText: `Reject creative matching pattern '${rejectionReason}': ${rejectionNotes ?? ''}`,
      supersedesRuleId,
      isTestFixture: !isEligible,
      eligibleForRealMemory: isEligible,
    });
  } else if (action === 'APPROVE' || action === 'PROMOTE_TO_BRAND_STANDARD') {
    ruleRecord = await recordOwnerDecisionRule({
      ruleId: `taste-rule-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      tenantId,
      ruleCategory: 'VISUAL_PREFERENCE',
      ruleText: `Approved visual style from creative ${creativeId}: ${rejectionNotes ?? 'Owner approved'}`,
      supersedesRuleId,
      isTestFixture: !isEligible,
      eligibleForRealMemory: isEligible,
    });
  }

  return {
    creativeId,
    tenantId,
    action,
    decisionAuthority: isEligible ? 'OWNER_EXPLICIT' : 'SYSTEM_TEST_ONLY',
    rejectionReason: rejectionReason ?? null,
    rejectionNotes: rejectionNotes ?? null,
    ruleRecord,
    recordedAt: new Date().toISOString(),
    isTestFixture: !isEligible,
    eligibleForRealMemory: isEligible,
  };
}
