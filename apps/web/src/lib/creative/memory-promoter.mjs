/**
 * SiteMind Multi-Stage Memory Promotion Rules Engine
 * Enforces strict evidence gates between RAW_OBSERVATION and GLOBAL_RULE.
 */

export const PROMOTION_STAGES = Object.freeze([
  'RAW_OBSERVATION',
  'CANDIDATE_LEARNING',
  'OWNER_SUPPORTED',
  'REPEATED_OWNER_PATTERN',
  'EXPERIMENT_SUPPORTED',
  'CROSS_CAMPAIGN_SUPPORTED',
  'GLOBAL_RULE',
  'MERCHANT_SPECIFIC_RULE',
  'CHANNEL_SPECIFIC_RULE',
  'TEMPORARY_SEASONAL_RULE',
  'REJECTED',
  'SUPERSEDE',
]);

export function promoteCreativeLearning({
  observationId,
  currentStage,
  ownerDecision,
  decisionAuthority = 'OWNER_EXPLICIT',
  experimentMetrics,
  isTestFixture = false,
}) {
  if (!PROMOTION_STAGES.includes(currentStage)) {
    throw new TypeError(`Invalid promotion stage: ${currentStage}`);
  }

  // Test fixtures or automated pre-selections can NEVER enter real performance or global rule memory
  if (isTestFixture || decisionAuthority !== 'OWNER_EXPLICIT') {
    return {
      observationId,
      previousStage: currentStage,
      promotedStage: 'CANDIDATE_LEARNING',
      allowed: false,
      reason: 'Test fixture or automated preselection cannot be promoted to real owner or global memory.',
      isTestFixture: true,
      eligibleForRealMemory: false,
    };
  }

  // Rule 1: Cannot jump from RAW_OBSERVATION to EXPERIMENT_SUPPORTED without an explicit experiment
  if (currentStage === 'RAW_OBSERVATION' && !experimentMetrics) {
    if (ownerDecision === 'APPROVE' && decisionAuthority === 'OWNER_EXPLICIT') {
      return {
        observationId,
        previousStage: currentStage,
        promotedStage: 'OWNER_SUPPORTED',
        allowed: true,
        reason: 'Owner approved untested creative. Promoted to OWNER_SUPPORTED.',
        isTestFixture: false,
        eligibleForRealMemory: true,
      };
    }

    return {
      observationId,
      previousStage: currentStage,
      promotedStage: 'CANDIDATE_LEARNING',
      allowed: true,
      reason: 'Raw observation registered. Awaiting owner review or experiment design.',
      isTestFixture: false,
      eligibleForRealMemory: true,
    };
  }

  // Rule 2: Experiment support requires completed first-party experiment data with non-null metrics
  if (experimentMetrics) {
    const { sampleSize, clickThroughRate, conversionRate } = experimentMetrics;

    if (!sampleSize || sampleSize < 1000 || clickThroughRate == null || conversionRate == null) {
      return {
        observationId,
        previousStage: currentStage,
        promotedStage: currentStage,
        allowed: false,
        reason: 'Experiment support blocked: Sample size < 1000 or missing verified performance metrics.',
        isTestFixture: false,
        eligibleForRealMemory: true,
      };
    }

    return {
      observationId,
      previousStage: currentStage,
      promotedStage: 'EXPERIMENT_SUPPORTED',
      allowed: true,
      reason: `Verified first-party experiment support (sampleSize=${sampleSize}, CTR=${clickThroughRate}).`,
      isTestFixture: false,
      eligibleForRealMemory: true,
    };
  }

  return {
    observationId,
    previousStage: currentStage,
    promotedStage: currentStage,
    allowed: false,
    reason: 'No promotion path available for current state.',
    isTestFixture: false,
    eligibleForRealMemory: true,
  };
}
