import { assert, digest, iso, newId, sealPlain } from './core.mjs';
import {
  ACTIONS,
  requirePrincipalReceipt,
  requireRealityCellAuthority,
} from './authority.mjs';
import { settleRealityCellLedger } from './assignment.mjs';
import { makeReceipt, resolveCanonicalReceipt } from './receipts.mjs';
import { twoProportion } from './stats.mjs';

const ASSIGNMENT_METHODS = new Set(['RANDOMIZED', 'QUASI_EXPERIMENTAL', 'OBSERVATIONAL']);
const REALITY_ANALYSIS_METHODS = new Set(['TWO_PROPORTION_Z']);
const CLAIM_CEILINGS = new Set(['ACTIVITY', 'ASSOCIATION', 'CAUSAL_EFFECT', 'ECONOMIC_EFFECT']);
const GOODHART_QUESTION = 'HOW COULD AN AGENT IMPROVE THE PRIMARY METRIC WHILE MAKING THE REAL CUSTOMER / MERCHANT / SYSTEM WORSE?';

export const REALITY_CELL_CONTRACT_VERSION = 'cana.reality-cell-preregistration/1.0.0';

function value(input, camel, snake = null) {
  if (input?.[camel] !== undefined) return input[camel];
  return snake ? input?.[snake] : undefined;
}

function required(input, camel, snake = null) {
  const result = value(input, camel, snake);
  assert(result !== undefined && result !== null && result !== '', `${camel} required`, 'PREREG_FIELD_REQUIRED');
  return result;
}

function validateAllocation(allocation) {
  const control = Number(allocation?.control);
  const treatment = Number(allocation?.treatment);
  assert(control > 0 && treatment > 0 && Math.abs(control + treatment - 1) < 1e-12, 'allocation must contain positive shares summing to one', 'PREREG_ALLOCATION_INVALID');
  return { control, treatment };
}

function validateGoodhart(goodhartAnalysis, guardrails) {
  assert(goodhartAnalysis?.question === GOODHART_QUESTION, 'canonical Goodhart question must be answered', 'GOODHART_ANALYSIS_REQUIRED');
  assert(Array.isArray(goodhartAnalysis.failureModes) && goodhartAnalysis.failureModes.length > 0, 'at least one concrete Goodhart failure mode required', 'GOODHART_FAILURE_MODE_REQUIRED');
  const guardrailIds = new Set(guardrails.map((guardrail) => guardrail.id));
  for (const failureMode of goodhartAnalysis.failureModes) {
    assert(typeof failureMode?.description === 'string' && failureMode.description.trim(), 'Goodhart failure description required', 'GOODHART_FAILURE_MODE_INVALID');
    assert(Array.isArray(failureMode.guardrailIds) && failureMode.guardrailIds.length > 0, 'Goodhart failure must bind guardrails', 'GOODHART_GUARDRAIL_REQUIRED');
    for (const id of failureMode.guardrailIds) assert(guardrailIds.has(id), `unknown Goodhart guardrail ${id}`, 'GOODHART_GUARDRAIL_UNKNOWN');
  }
}

function validateMetric(metric, field) {
  assert(metric && typeof metric === 'object' && !Array.isArray(metric), `${field} must be an object`, 'PREREG_METRIC_INVALID');
  assert(typeof metric.id === 'string' && metric.id, `${field}.id required`, 'PREREG_METRIC_INVALID');
  assert(['BINARY', 'NUMERIC'].includes(metric.type), `${field}.type invalid`, 'PREREG_METRIC_INVALID');
  return metric;
}

function validateExperienceDefinition(definition, field) {
  assert(definition && typeof definition === 'object' && !Array.isArray(definition), `${field} must be an object`, 'PREREG_EXPERIENCE_INVALID');
  assert(typeof definition.candidateDigest === 'string' && definition.candidateDigest, `${field}.candidateDigest required`, 'PREREG_EXPERIENCE_INVALID');
  assert(typeof definition.experienceVersion === 'string' && definition.experienceVersion, `${field}.experienceVersion required`, 'PREREG_EXPERIENCE_INVALID');
  return definition;
}

function realityCellBody(contract) {
  return {
    contractVersion: contract.contractVersion,
    experimentId: contract.experimentId,
    merchantId: contract.merchantId,
    tenantId: contract.tenantId,
    hypothesis: contract.hypothesis,
    experimentalUnit: contract.experimentalUnit,
    eligibilityCriteria: contract.eligibilityCriteria,
    assignmentMethod: contract.assignmentMethod,
    allocation: contract.allocation,
    assignmentSaltCommitment: contract.assignmentSaltCommitment,
    controlDefinition: contract.controlDefinition,
    treatmentDefinition: contract.treatmentDefinition,
    baseline: contract.baseline,
    exposureDefinition: contract.exposureDefinition,
    primaryMetric: contract.primaryMetric,
    secondaryMetrics: contract.secondaryMetrics,
    guardrails: contract.guardrails,
    minimumSample: contract.minimumSample,
    analysisMethod: contract.analysisMethod,
    confidencePolicy: contract.confidencePolicy,
    interferenceAssumptions: contract.interferenceAssumptions,
    stopConditions: contract.stopConditions,
    harmConditions: contract.harmConditions,
    maximumClaimCeiling: contract.maximumClaimCeiling,
    rollbackContract: contract.rollbackContract,
    ownerAuthorityRequirement: contract.ownerAuthorityRequirement,
    merchantAuthorityRequirement: contract.merchantAuthorityRequirement,
    observationWindow: contract.observationWindow,
    goodhartAnalysis: contract.goodhartAnalysis,
    evidenceRealm: contract.evidenceRealm,
    proposerId: contract.proposerId,
    preregisteredAt: contract.preregisteredAt,
    randomizationSanityPolicy: contract.randomizationSanityPolicy,
  };
}

// Legacy WELD v3 experiment contract remains available for its existing callers.
export function preregisterExperiment(input) {
  for (const field of ['hypothesis', 'unit', 'primaryMetric', 'exposureDefinition', 'analysisMethod', 'minimumPerArm', 'stopRule', 'rollbackPlan', 'comparator', 'assignmentMethod', 'interferenceAssumptions', 'maximumClaimCeiling']) {
    assert(input[field] !== undefined && input[field] !== null, `${field} required`, 'PREREG_FIELD_REQUIRED');
  }
  assert(ASSIGNMENT_METHODS.has(input.assignmentMethod), `unsupported assignmentMethod ${input.assignmentMethod}`);
  assert(Number.isInteger(input.minimumPerArm) && input.minimumPerArm >= 1, 'minimumPerArm must be positive integer', 'PREREG_MINIMUM_INVALID');
  const body = {
    experimentId: input.experimentId ?? newId('exp'),
    hypothesis: input.hypothesis,
    unit: input.unit,
    primaryMetric: input.primaryMetric,
    secondaryMetrics: input.secondaryMetrics ?? [],
    guardrails: input.guardrails ?? [],
    population: input.population ?? null,
    treatment: input.treatment,
    comparator: input.comparator,
    assignmentMethod: input.assignmentMethod,
    allocation: input.allocation ?? { control: 0.5, treatment: 0.5 },
    assignmentSaltCommitment: input.assignmentSaltCommitment ?? null,
    exposureDefinition: input.exposureDefinition,
    analysisMethod: input.analysisMethod,
    minimumPerArm: input.minimumPerArm,
    stopRule: input.stopRule,
    rollbackPlan: input.rollbackPlan,
    interferenceAssumptions: input.interferenceAssumptions,
    maximumClaimCeiling: input.maximumClaimCeiling,
    expectedEffect: input.expectedEffect ?? null,
    alternatives: input.alternatives ?? [],
    createdAt: new Date().toISOString(),
    proposerId: input.proposerId,
  };
  return sealPlain({ ...body, preRegDigest: digest(body, 'experiment-prereg'), status: 'PROPOSED', authorizedBy: null });
}

export function preregisterRealityCell(input) {
  const assignmentMethod = required(input, 'assignmentMethod', 'assignment_method');
  assert(ASSIGNMENT_METHODS.has(assignmentMethod), `unsupported assignmentMethod ${assignmentMethod}`, 'PREREG_ASSIGNMENT_INVALID');
  const analysisMethod = required(input, 'analysisMethod', 'analysis_method');
  assert(REALITY_ANALYSIS_METHODS.has(analysisMethod), `unsupported Reality Cell analysis method ${analysisMethod}`, 'PREREG_ANALYSIS_INVALID');
  const minimumSample = required(input, 'minimumSample', 'minimum_sample');
  assert(Number.isInteger(minimumSample?.perArm) && minimumSample.perArm > 0, 'minimumSample.perArm must be a positive integer', 'PREREG_MINIMUM_INVALID');
  const confidencePolicy = required(input, 'confidencePolicy', 'confidence_policy');
  assert(Number(confidencePolicy.alpha) > 0 && Number(confidencePolicy.alpha) < 1, 'confidencePolicy.alpha invalid', 'PREREG_CONFIDENCE_INVALID');
  assert(Math.abs(Number(confidencePolicy.confidence) + Number(confidencePolicy.alpha) - 1) < 1e-9, 'confidence and alpha must sum to one', 'PREREG_CONFIDENCE_INVALID');
  const observationWindow = required(input, 'observationWindow', 'observation_window');
  const startsAt = iso(observationWindow.startsAt);
  const endsAt = iso(observationWindow.endsAt);
  assert(new Date(endsAt).getTime() > new Date(startsAt).getTime(), 'observation window must end after it starts', 'PREREG_WINDOW_INVALID');
  const primaryMetric = validateMetric(required(input, 'primaryMetric', 'primary_metric'), 'primaryMetric');
  const secondaryMetrics = value(input, 'secondaryMetrics', 'secondary_metrics') ?? [];
  assert(Array.isArray(secondaryMetrics), 'secondaryMetrics must be an array', 'PREREG_METRIC_INVALID');
  secondaryMetrics.forEach((metric) => validateMetric(metric, 'secondaryMetric'));
  const guardrails = required(input, 'guardrails');
  assert(Array.isArray(guardrails) && guardrails.length > 0, 'at least one guardrail required', 'PREREG_GUARDRAIL_REQUIRED');
  for (const guardrail of guardrails) {
    assert(guardrail?.id && guardrail?.metric && guardrail?.harmWhen && Number.isFinite(Number(guardrail.threshold)), 'guardrail incomplete', 'PREREG_GUARDRAIL_INVALID');
  }
  const goodhartAnalysis = required(input, 'goodhartAnalysis', 'goodhart_analysis');
  validateGoodhart(goodhartAnalysis, guardrails);
  const maximumClaimCeiling = required(input, 'maximumClaimCeiling', 'maximum_claim_ceiling');
  assert(CLAIM_CEILINGS.has(maximumClaimCeiling), 'maximum claim ceiling invalid', 'PREREG_CLAIM_CEILING_INVALID');
  const evidenceRealm = value(input, 'evidenceRealm', 'evidence_realm') ?? 'VERIFIED_REAL';
  assert(['VERIFIED_REAL', 'SIMULATED', 'FIXTURE'].includes(evidenceRealm), 'Reality Cell evidence realm invalid', 'PREREG_REALM_INVALID');
  const rollbackContract = required(input, 'rollbackContract', 'rollback_contract');
  assert(typeof rollbackContract?.digest === 'string' && rollbackContract.digest, 'rollbackContract.digest required', 'PREREG_ROLLBACK_INVALID');
  const ownerAuthorityRequirement = required(input, 'ownerAuthorityRequirement', 'owner_authority_requirement');
  assert(ownerAuthorityRequirement?.principal === 'CANONICAL_OWNER' && ownerAuthorityRequirement?.action === ACTIONS.AUTHORIZE_REALITY_CELL, 'canonical Owner authority requirement invalid', 'PREREG_OWNER_AUTHORITY_INVALID');
  const merchantAuthorityRequirement = required(input, 'merchantAuthorityRequirement', 'merchant_authority_requirement');
  assert(merchantAuthorityRequirement?.required === true && Array.isArray(merchantAuthorityRequirement.allowedEffectSet) && merchantAuthorityRequirement.allowedEffectSet.length > 0, 'merchant authority requirement invalid', 'PREREG_MERCHANT_AUTHORITY_INVALID');
  const stopConditions = required(input, 'stopConditions', 'stop_conditions');
  const harmConditions = required(input, 'harmConditions', 'harm_conditions');
  assert(Array.isArray(stopConditions) && stopConditions.length > 0, 'stop conditions required', 'PREREG_STOP_CONDITIONS_INVALID');
  assert(Array.isArray(harmConditions) && harmConditions.length > 0, 'harm conditions required', 'PREREG_HARM_CONDITIONS_INVALID');
  const controlDefinition = validateExperienceDefinition(required(input, 'controlDefinition', 'control_definition'), 'controlDefinition');
  const treatmentDefinition = validateExperienceDefinition(required(input, 'treatmentDefinition', 'treatment_definition'), 'treatmentDefinition');
  assert(controlDefinition.candidateDigest !== treatmentDefinition.candidateDigest, 'control and treatment candidates must be distinct', 'PREREG_EXPERIENCE_INVALID');
  const body = {
    contractVersion: REALITY_CELL_CONTRACT_VERSION,
    experimentId: value(input, 'experimentId', 'experiment_id') ?? newId('reality_cell'),
    merchantId: required(input, 'merchantId', 'merchant_id'),
    tenantId: required(input, 'tenantId', 'tenant_id'),
    hypothesis: required(input, 'hypothesis'),
    experimentalUnit: required(input, 'experimentalUnit', 'experimental_unit'),
    eligibilityCriteria: required(input, 'eligibilityCriteria', 'eligibility_criteria'),
    assignmentMethod,
    allocation: validateAllocation(value(input, 'allocation') ?? { control: 0.5, treatment: 0.5 }),
    assignmentSaltCommitment: required(input, 'assignmentSaltCommitment', 'assignment_salt_commitment'),
    controlDefinition,
    treatmentDefinition,
    baseline: required(input, 'baseline'),
    exposureDefinition: required(input, 'exposureDefinition', 'exposure_definition'),
    primaryMetric,
    secondaryMetrics,
    guardrails,
    minimumSample,
    analysisMethod,
    confidencePolicy,
    interferenceAssumptions: required(input, 'interferenceAssumptions', 'interference_assumptions'),
    stopConditions,
    harmConditions,
    maximumClaimCeiling,
    rollbackContract,
    ownerAuthorityRequirement,
    merchantAuthorityRequirement,
    observationWindow: { startsAt, endsAt },
    goodhartAnalysis,
    evidenceRealm,
    proposerId: required(input, 'proposerId', 'proposer_id'),
    preregisteredAt: iso(value(input, 'preregisteredAt', 'preregistered_at') ?? new Date()),
    randomizationSanityPolicy: value(input, 'randomizationSanityPolicy', 'randomization_sanity_policy') ?? { maximumAbsoluteZ: 5 },
  };
  assert(Number(body.randomizationSanityPolicy.maximumAbsoluteZ) >= 3, 'randomization sanity threshold is too weak', 'PREREG_RANDOMIZATION_POLICY_INVALID');
  const preregistrationDigest = digest(body, 'reality-cell-preregistration');
  return sealPlain({
    ...body,
    preregistrationDigest,
    preRegDigest: preregistrationDigest,
    minimumPerArm: minimumSample.perArm,
    primaryMetricId: primaryMetric.id,
    status: 'PREREGISTERED',
    authorityBinding: null,
  });
}

export function verifyRealityCellPreregistration(experiment) {
  assert(experiment?.contractVersion === REALITY_CELL_CONTRACT_VERSION, 'Reality Cell preregistration contract required', 'PREREG_CONTRACT_INVALID');
  const expected = digest(realityCellBody(experiment), 'reality-cell-preregistration');
  assert(experiment.preregistrationDigest === expected && experiment.preRegDigest === expected, 'post-hoc preregistration mutation detected', 'PREREGISTRATION_MUTATED');
  validateGoodhart(experiment.goodhartAnalysis, experiment.guardrails);
  return experiment;
}

export function assessRealityCellReadiness({ experiment, candidate }) {
  try {
    verifyRealityCellPreregistration(experiment);
    assert(candidate?.candidateDigest === experiment.treatmentDefinition.candidateDigest, 'treatment candidate digest mismatch', 'CANDIDATE_DIGEST_MISMATCH');
    assert(candidate?.tenantId === experiment.tenantId && candidate?.merchantId === experiment.merchantId, 'candidate tenant or merchant mismatch', 'REALITY_CELL_TENANT_MISMATCH');
    return sealPlain({
      experimentId: experiment.experimentId,
      preregistrationDigest: experiment.preregistrationDigest,
      candidateDigest: candidate.candidateDigest,
      status: 'READY_FOR_AUTHORITY',
      authorityGranted: false,
      realWorldExecutionAllowed: false,
      blocker: 'AWAITING_OWNER_AND_MERCHANT_AUTHORIZATION',
    });
  } catch (error) {
    return sealPlain({
      experimentId: experiment?.experimentId ?? null,
      preregistrationDigest: experiment?.preregistrationDigest ?? null,
      candidateDigest: candidate?.candidateDigest ?? null,
      status: 'NOT_READY',
      authorityGranted: false,
      realWorldExecutionAllowed: false,
      blocker: error.code ?? 'REALITY_CELL_CONTRACT_INVALID',
    });
  }
}

export function bindRealityCellAuthority(experiment, authorityBinding) {
  verifyRealityCellPreregistration(experiment);
  assert(authorityBinding?.experimentId === experiment.experimentId, 'authority experiment mismatch', 'REALITY_AUTHORITY_EXPERIMENT_MISMATCH');
  assert(authorityBinding?.preregistrationDigest === experiment.preregistrationDigest, 'authority preregistration mismatch', 'REALITY_AUTHORITY_PREREGISTRATION_MISMATCH');
  assert(authorityBinding?.candidateDigest === experiment.treatmentDefinition.candidateDigest, 'authority candidate mismatch', 'REALITY_AUTHORITY_CANDIDATE_MISMATCH');
  return sealPlain({
    ...experiment,
    status: authorityBinding.realWorldExecutionAllowed ? 'AUTHORIZED' : 'AUTHORIZED_FIXTURE_ONLY',
    authorityBinding,
  });
}

export async function authorizeExperiment(experiment, evidenceAdapter, principalReceiptDigest) {
  assert(experiment.status === 'PROPOSED', 'experiment must be proposed');
  const grant = await requirePrincipalReceipt(evidenceAdapter, principalReceiptDigest, ACTIONS.AUTHORIZE_EXPERIMENT);
  return sealPlain({ ...experiment, status: 'AUTHORIZED', authorizedBy: grant.subject, authorityDigest: grant.authorityDigest, principalReceiptDigest });
}

export async function startExperiment(experiment, evidenceAdapter, principalReceiptDigest) {
  assert(experiment.status === 'AUTHORIZED', 'experiment must be authorized');
  await requirePrincipalReceipt(evidenceAdapter, principalReceiptDigest, ACTIONS.EXECUTE_EXPERIMENT);
  return sealPlain({ ...experiment, status: 'RUNNING', startedAt: new Date().toISOString() });
}

export async function settleExperiment(experiment, evidenceAdapter, principalReceiptDigest) {
  assert(['RUNNING', 'AUTHORIZED'].includes(experiment.status), 'experiment must be authorized/running');
  await requirePrincipalReceipt(evidenceAdapter, principalReceiptDigest, ACTIONS.SETTLE_EXPERIMENT);
  const ledger = await evidenceAdapter.loadExperimentLedger(experiment.experimentId);
  assert(ledger && Array.isArray(ledger.assignments) && Array.isArray(ledger.exposures) && Array.isArray(ledger.outcomes), 'experiment ledger incomplete', 'EXPERIMENT_LEDGER_INCOMPLETE');
  const assignments = new Map();
  for (const receiptDigest of ledger.assignments) {
    const receipt = await resolveCanonicalReceipt(evidenceAdapter, receiptDigest, { kind: 'ASSIGNMENT', subjectDigest: experiment.preRegDigest, minimumRealm: 'VERIFIED_LOCAL' });
    const unitHash = receipt.payload?.unitHash;
    assert(unitHash && !assignments.has(unitHash), 'duplicate assignment unit', 'DUPLICATE_ASSIGNMENT');
    assignments.set(unitHash, receipt);
  }
  const exposures = new Map();
  for (const receiptDigest of ledger.exposures) {
    const receipt = await resolveCanonicalReceipt(evidenceAdapter, receiptDigest, { kind: 'EXPOSURE', subjectDigest: experiment.preRegDigest, minimumRealm: 'VERIFIED_LOCAL' });
    const unitHash = receipt.payload?.unitHash;
    assert(assignments.has(unitHash), 'exposure without assignment', 'EXPOSURE_WITHOUT_ASSIGNMENT');
    assert(receipt.payload?.assignmentReceiptDigest === assignments.get(unitHash).receiptDigest, 'exposure assignment mismatch', 'EXPOSURE_ASSIGNMENT_MISMATCH');
    exposures.set(unitHash, receipt);
  }
  const outcomes = new Map();
  for (const receiptDigest of ledger.outcomes) {
    const receipt = await resolveCanonicalReceipt(evidenceAdapter, receiptDigest, { kind: 'OUTCOME', subjectDigest: experiment.preRegDigest, minimumRealm: 'VERIFIED_LOCAL' });
    const unitHash = receipt.payload?.unitHash;
    assert(exposures.has(unitHash), 'outcome without verified exposure', 'OUTCOME_WITHOUT_EXPOSURE');
    outcomes.set(unitHash, receipt);
  }
  let controlN = 0;
  let treatmentN = 0;
  let controlSuccesses = 0;
  let treatmentSuccesses = 0;
  for (const [unitHash, outcome] of outcomes) {
    const arm = assignments.get(unitHash).payload.arm;
    const success = Boolean(outcome.payload?.success);
    if (arm === 'CONTROL') {
      controlN += 1;
      if (success) controlSuccesses += 1;
    } else if (arm === 'TREATMENT') {
      treatmentN += 1;
      if (success) treatmentSuccesses += 1;
    }
  }
  const stats = twoProportion(controlSuccesses, controlN, treatmentSuccesses, treatmentN);
  const sufficient = controlN >= experiment.minimumPerArm && treatmentN >= experiment.minimumPerArm;
  const effectSeparatedFromZero = Boolean(stats && (stats.ciLo > 0 || stats.ciHi < 0));
  let causalStatus = 'INSUFFICIENT_EVIDENCE';
  if (sufficient) {
    if (experiment.assignmentMethod === 'RANDOMIZED' && effectSeparatedFromZero) causalStatus = 'CAUSALLY_SUPPORTED';
    else if (effectSeparatedFromZero) causalStatus = 'SUPPORTED_ASSOCIATION';
    else causalStatus = 'OBSERVED_NO_DECISIVE_EFFECT';
  }
  const outcomeSummary = { controlSuccesses, controlN, treatmentSuccesses, treatmentN, assignmentReceiptDigests: ledger.assignments, exposureReceiptDigests: ledger.exposures, outcomeReceiptDigests: ledger.outcomes };
  const body = { ...experiment, status: 'SETTLED', settledAt: new Date().toISOString(), outcome: outcomeSummary, stats, minimumPerArm: experiment.minimumPerArm, sufficient, effectSeparatedFromZero, causalStatus };
  return sealPlain({ ...body, settlementDigest: digest({ preRegDigest: experiment.preRegDigest, outcomeSummary, stats, causalStatus, analysisMethod: experiment.analysisMethod }, 'experiment-settlement') });
}

function invalidRealityCellSettlement(experiment, error, now) {
  const payload = {
    experimentId: experiment?.experimentId ?? null,
    preregistrationDigest: experiment?.preregistrationDigest ?? null,
    classification: 'INVALID_EXPERIMENT',
    reason: error?.code ?? 'INVALID_EXPERIMENT',
    evidenceRealm: experiment?.evidenceRealm ?? 'UNKNOWN',
    settledAt: iso(now),
    realWorldClaim: false,
  };
  const receipt = makeReceipt({
    kind: 'EXPERIMENT_SETTLEMENT',
    subjectDigest: experiment?.preregistrationDigest ?? 'invalid:missing-preregistration',
    realm: experiment?.evidenceRealm ?? 'UNKNOWN',
    issuer: 'canonical-reality-cell-settlement',
    payload,
  });
  return sealPlain({ ...payload, status: 'SETTLED', settlementDigest: receipt.receiptDigest, receipt });
}

export async function settleRealityCell(experiment, evidenceAdapter, { now = new Date() } = {}) {
  try {
    verifyRealityCellPreregistration(experiment);
    assert(['AUTHORIZED', 'AUTHORIZED_FIXTURE_ONLY', 'RUNNING'].includes(experiment.status), 'Reality Cell authority missing', 'INVALID_AUTHORITY_LINEAGE');
    await requireRealityCellAuthority({ experiment, evidenceAdapter, authorityBinding: experiment.authorityBinding, now });
    const ledger = await evidenceAdapter.loadExperimentLedger(experiment.experimentId);
    const result = await settleRealityCellLedger({ experiment, ledger, evidenceAdapter, now });
    const payload = {
      experimentId: experiment.experimentId,
      merchantId: experiment.merchantId,
      tenantId: experiment.tenantId,
      preregistrationDigest: experiment.preregistrationDigest,
      classification: result.classification,
      analysisMethod: experiment.analysisMethod,
      primaryMetric: experiment.primaryMetric,
      minimumSample: experiment.minimumSample,
      assignmentMethod: experiment.assignmentMethod,
      claimCeiling: experiment.maximumClaimCeiling,
      evidenceRealm: experiment.evidenceRealm,
      sufficient: result.sufficient,
      effectEstimate: result.stats,
      assignmentSanity: result.assignmentSanity,
      counts: result.counts,
      guardrailResults: result.guardrailResults,
      evidenceDigests: result.evidenceDigests,
      settledAt: iso(now),
      realWorldClaim: experiment.evidenceRealm === 'VERIFIED_REAL',
      limitations: result.limitations,
    };
    const receipt = makeReceipt({
      kind: 'EXPERIMENT_SETTLEMENT',
      subjectDigest: experiment.preregistrationDigest,
      realm: experiment.evidenceRealm,
      issuer: 'canonical-reality-cell-settlement',
      payload,
      parentDigests: [...result.evidenceDigests.assignments, ...result.evidenceDigests.exposures, ...result.evidenceDigests.outcomes],
    });
    return sealPlain({ ...payload, status: 'SETTLED', settlementDigest: receipt.receiptDigest, receipt });
  } catch (error) {
    return invalidRealityCellSettlement(experiment, error, now);
  }
}
