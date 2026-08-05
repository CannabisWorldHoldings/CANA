/**
 * SiteMind Experiment & Attribution Bridge
 * First-party event tracking and null-safe outcome data updates.
 */

export async function createCreativeExperiment(input) {
  const isFixture = input.isTestFixture ?? false;
  return {
    experimentId: input.experimentId,
    creativeId: input.creativeId,
    campaignId: input.campaignId,
    businessId: input.businessId,
    hypothesis: input.hypothesis,
    treatmentConcept: input.treatmentConcept,
    controlConcept: input.controlConcept,
    runtimeDays: input.runtimeDays ?? 14,
    status: 'DESIGNED_NOT_EXECUTED',
    createdAt: new Date().toISOString(),
    isTestFixture: isFixture,
  };
}

export async function updateCreativeOutcomeData({
  creativeId,
  experimentId,
  sampleSize = null,
  impressions = null,
  clicks = null,
  conversions = null,
  clickThroughRate = null,
  conversionRate = null,
  costPerAcquisition = null,
}) {
  return {
    creativeId,
    experimentId,
    performanceState: 'PERFORMANCE_UNMEASURED',
    metrics: {
      sampleSize,
      impressions,
      clicks,
      conversions,
      clickThroughRate,
      conversionRate,
      costPerAcquisition,
    },
    updatedAt: new Date().toISOString(),
  };
}
