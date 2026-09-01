import { createHash, createHmac } from 'node:crypto';
import { assert, digest, iso, sealPlain } from './core.mjs';
import {
  makeReceipt,
  requireExactEvidenceRealm,
  resolveCanonicalReceipt,
} from './receipts.mjs';
import { normalCriticalValue, twoProportion } from './stats.mjs';

export function commitmentForSalt(salt) {
  assert(typeof salt === 'string' && salt.length >= 16, 'assignment salt must be at least 16 chars');
  return `sha256:${createHash('sha256').update(salt).digest('hex')}`;
}

export function assignExperimentArm(experiment, unitId, assignmentSalt) {
  assert(experiment?.preRegDigest, 'preregistered experiment required');
  assert(typeof unitId === 'string' && unitId, 'unitId required');
  assert(commitmentForSalt(assignmentSalt) === experiment.assignmentSaltCommitment, 'assignment salt commitment mismatch', 'ASSIGNMENT_SALT_MISMATCH');
  const token = createHmac('sha256', assignmentSalt)
    .update(`${experiment.preRegDigest}:${unitId}`)
    .digest('hex');
  const ratio = Number.parseInt(token.slice(0, 13), 16) / 0xfffffffffffff;
  const treatmentShare = Number(experiment.allocation?.treatment ?? 0.5);
  assert(treatmentShare > 0 && treatmentShare < 1, 'experiment allocation invalid', 'ASSIGNMENT_EXPERIMENT_INVALID');
  const arm = ratio < treatmentShare ? 'TREATMENT' : 'CONTROL';
  const unitHash = digest({ experimentId: experiment.experimentId, unitId }, 'unit');
  const body = {
    arm,
    assignmentToken: token,
    experimentId: experiment.experimentId,
    preregistrationDigest: experiment.preRegDigest,
    preRegDigest: experiment.preRegDigest,
    assignmentMethod: experiment.assignmentMethod,
    unitHash,
  };
  return sealPlain({ ...body, assignmentDigest: digest(body, 'assignment') });
}

export function verifyAssignmentReceipt({ receipt, experiment, unitId, assignmentSalt }) {
  const expected = assignExperimentArm(experiment, unitId, assignmentSalt);
  assert(receipt?.kind === 'ASSIGNMENT', 'assignment receipt required', 'ASSIGNMENT_RECEIPT_REQUIRED');
  for (const field of ['arm', 'assignmentToken', 'assignmentDigest', 'experimentId', 'preregistrationDigest', 'unitHash']) {
    assert(receipt.payload?.[field] === expected[field], `assignment ${field} mismatch`, 'ASSIGNMENT_VERIFICATION_FAILED');
  }
  return true;
}

export function makeAssignmentReceipt({
  experiment,
  unitId,
  assignmentSalt,
  assignedAt = new Date(),
  issuer = 'canonical-assignment-engine',
  realm = 'VERIFIED_LOCAL',
}) {
  const assignment = assignExperimentArm(experiment, unitId, assignmentSalt);
  const payload = experiment?.contractVersion
    ? { ...assignment, assignedAt: iso(assignedAt) }
    : assignment;
  return makeReceipt({
    kind: 'ASSIGNMENT',
    subjectDigest: experiment.preRegDigest,
    realm,
    issuer,
    payload,
    issuedAt: assignedAt,
  });
}

function expectedExperience(experiment, arm) {
  return arm === 'TREATMENT'
    ? experiment.treatmentDefinition
    : experiment.controlDefinition;
}

export function makeExposureReceipt({
  experiment,
  assignmentReceipt,
  exposed,
  exposureEvidenceDigest,
  actualExperienceVersion = null,
  candidateDigest = null,
  routeSurface = null,
  observedAt = new Date(),
  independentObserverSource = null,
  treatmentExecutorSource = null,
  issuer = 'independent-exposure-observer',
  realm = 'VERIFIED_LOCAL',
}) {
  assert(assignmentReceipt?.kind === 'ASSIGNMENT', 'assignment receipt required');
  assert(assignmentReceipt.subjectDigest === experiment?.preRegDigest, 'assignment experiment mismatch', 'EXPOSURE_ASSIGNMENT_MISMATCH');
  assert(exposed === true, 'only verified exposure may be receipted', 'EXPOSURE_NOT_VERIFIED');
  assert(exposureEvidenceDigest, 'exposure evidence digest required');
  if (!experiment?.contractVersion) {
    return makeReceipt({
      kind: 'EXPOSURE',
      subjectDigest: experiment.preRegDigest,
      realm,
      issuer,
      payload: {
        unitHash: assignmentReceipt.payload.unitHash,
        arm: assignmentReceipt.payload.arm,
        assignmentReceiptDigest: assignmentReceipt.receiptDigest,
        exposed: true,
        exposureEvidenceDigest,
      },
      issuedAt: observedAt,
    });
  }
  requireExactEvidenceRealm(assignmentReceipt, realm);
  const expected = expectedExperience(experiment, assignmentReceipt.payload.arm);
  assert(actualExperienceVersion === expected.experienceVersion, 'actual experience version does not match assigned arm', 'TREATMENT_CONTROL_IDENTITY_MISMATCH');
  assert(candidateDigest === expected.candidateDigest, 'candidate digest does not match assigned arm', 'CANDIDATE_DIGEST_MISMATCH');
  assert(typeof routeSurface === 'string' && routeSurface.startsWith('/'), 'exposure route/surface required', 'EXPOSURE_SURFACE_REQUIRED');
  assert(typeof independentObserverSource === 'string' && independentObserverSource, 'independent exposure observer required', 'EXPOSURE_OBSERVER_REQUIRED');
  assert(!treatmentExecutorSource || independentObserverSource !== treatmentExecutorSource, 'treatment executor self-report is insufficient', 'EXPOSURE_OBSERVER_NOT_INDEPENDENT');
  const observed = iso(observedAt);
  assert(new Date(observed).getTime() >= new Date(assignmentReceipt.payload.assignedAt).getTime(), 'exposure precedes assignment', 'EXPOSURE_BEFORE_ASSIGNMENT');
  const payload = {
    assignmentReceiptDigest: assignmentReceipt.receiptDigest,
    experimentId: experiment.experimentId,
    preregistrationDigest: experiment.preregistrationDigest,
    unitHash: assignmentReceipt.payload.unitHash,
    assignedArm: assignmentReceipt.payload.arm,
    arm: assignmentReceipt.payload.arm,
    actualExperienceVersion,
    candidateDigest,
    routeSurface,
    observedAt: observed,
    independentObserverSource,
    treatmentExecutorSource,
    evidenceRealm: realm,
    exposureEvidenceDigest,
    exposed: true,
  };
  return makeReceipt({
    kind: 'EXPOSURE',
    subjectDigest: experiment.preregistrationDigest,
    realm,
    issuer,
    payload,
    issuedAt: observedAt,
    parentDigests: [assignmentReceipt.receiptDigest, candidateDigest, exposureEvidenceDigest],
  });
}

export function makeOutcomeReceipt({
  experiment,
  exposureReceipt,
  success,
  metric = null,
  observedValue = undefined,
  observedAt = new Date(),
  source = null,
  outcomeEvidenceDigest,
  issuer = 'independent-outcome-observer',
  realm = 'VERIFIED_LOCAL',
}) {
  assert(exposureReceipt?.kind === 'EXPOSURE', 'exposure receipt required');
  assert(exposureReceipt.subjectDigest === experiment?.preRegDigest, 'outcome experiment mismatch', 'OUTCOME_EXPERIMENT_MISMATCH');
  assert(outcomeEvidenceDigest, 'outcome evidence digest required');
  if (!experiment?.contractVersion) {
    return makeReceipt({
      kind: 'OUTCOME',
      subjectDigest: experiment.preRegDigest,
      realm,
      issuer,
      payload: {
        unitHash: exposureReceipt.payload.unitHash,
        exposureReceiptDigest: exposureReceipt.receiptDigest,
        success: Boolean(success),
        outcomeEvidenceDigest,
      },
      issuedAt: observedAt,
    });
  }
  requireExactEvidenceRealm(exposureReceipt, realm);
  const metricId = metric ?? experiment.primaryMetric.id;
  const metricIds = new Set([
    experiment.primaryMetric.id,
    ...experiment.secondaryMetrics.map((entry) => entry.id),
    ...experiment.guardrails.map((entry) => entry.metric),
  ]);
  assert(metricIds.has(metricId), 'outcome metric not preregistered', 'OUTCOME_METRIC_NOT_PREREGISTERED');
  const value = observedValue === undefined ? Boolean(success) : observedValue;
  assert(typeof value === 'boolean' || Number.isFinite(Number(value)), 'outcome value invalid', 'OUTCOME_VALUE_INVALID');
  const metricDefinition = [experiment.primaryMetric, ...experiment.secondaryMetrics]
    .find((entry) => entry.id === metricId);
  if (metricDefinition?.type === 'BINARY') {
    assert(typeof value === 'boolean' || Number(value) === 0 || Number(value) === 1, 'binary outcome value must be boolean, zero, or one', 'OUTCOME_VALUE_INVALID');
  }
  assert(typeof source === 'string' && source, 'outcome source required', 'OUTCOME_SOURCE_REQUIRED');
  const observed = iso(observedAt);
  assert(new Date(observed).getTime() >= new Date(exposureReceipt.payload.observedAt).getTime(), 'outcome precedes exposure', 'OUTCOME_BEFORE_EXPOSURE');
  const payload = {
    experimentId: experiment.experimentId,
    preregistrationDigest: experiment.preregistrationDigest,
    assignmentReceiptDigest: exposureReceipt.payload.assignmentReceiptDigest,
    exposureReceiptDigest: exposureReceipt.receiptDigest,
    unitHash: exposureReceipt.payload.unitHash,
    assignedArm: exposureReceipt.payload.assignedArm,
    metric: metricId,
    observedValue: value,
    observedAt: observed,
    source,
    evidenceRealm: realm,
    outcomeEvidenceDigest,
  };
  return makeReceipt({
    kind: 'OUTCOME',
    subjectDigest: experiment.preregistrationDigest,
    realm,
    issuer,
    payload,
    issuedAt: observedAt,
    parentDigests: [exposureReceipt.receiptDigest, outcomeEvidenceDigest],
  });
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + Number(value), 0) / values.length : null;
}

function guardrailHarm(guardrail, controlMean, treatmentMean) {
  if (controlMean === null || treatmentMean === null) return false;
  const threshold = Number(guardrail.threshold);
  if (guardrail.harmWhen === 'TREATMENT_ABOVE') return treatmentMean > threshold;
  if (guardrail.harmWhen === 'TREATMENT_BELOW') return treatmentMean < threshold;
  if (guardrail.harmWhen === 'TREATMENT_MINUS_CONTROL_ABOVE') return treatmentMean - controlMean > threshold;
  if (guardrail.harmWhen === 'TREATMENT_MINUS_CONTROL_BELOW') return treatmentMean - controlMean < threshold;
  assert(false, `unknown guardrail harm rule ${guardrail.harmWhen}`, 'PREREG_GUARDRAIL_INVALID');
}

function claimAllowsCausality(claimCeiling) {
  return ['CAUSAL_EFFECT', 'ECONOMIC_EFFECT'].includes(claimCeiling);
}

export async function settleRealityCellLedger({ experiment, ledger, evidenceAdapter, now = new Date() }) {
  assert(ledger && Array.isArray(ledger.assignments) && Array.isArray(ledger.exposures) && Array.isArray(ledger.outcomes), 'experiment ledger incomplete', 'EXPERIMENT_LEDGER_INCOMPLETE');
  assert(!Array.isArray(ledger.severeInterferenceViolations) || ledger.severeInterferenceViolations.length === 0, 'severe interference violation', 'SEVERE_INTERFERENCE_VIOLATION');
  const realm = experiment.evidenceRealm;
  const assignments = new Map();
  const assignmentReceiptDigests = new Set();
  for (const receiptDigest of ledger.assignments) {
    assert(!assignmentReceiptDigests.has(receiptDigest), 'duplicate assignment receipt', 'DUPLICATE_ASSIGNMENT');
    assignmentReceiptDigests.add(receiptDigest);
    const receipt = await resolveCanonicalReceipt(evidenceAdapter, receiptDigest, { kind: 'ASSIGNMENT', subjectDigest: experiment.preregistrationDigest, now });
    requireExactEvidenceRealm(receipt, realm);
    const payload = receipt.payload ?? {};
    assert(payload.experimentId === experiment.experimentId && payload.preregistrationDigest === experiment.preregistrationDigest, 'assignment experiment mismatch', 'ASSIGNMENT_EXPERIMENT_MISMATCH');
    assert(payload.assignmentMethod === experiment.assignmentMethod, 'assignment method mismatch', 'ASSIGNMENT_METHOD_MISMATCH');
    assert(['CONTROL', 'TREATMENT'].includes(payload.arm), 'assignment arm invalid', 'ASSIGNMENT_ARM_INVALID');
    assert(/^[a-f0-9]{64}$/.test(payload.assignmentToken ?? ''), 'assignment token invalid', 'ASSIGNMENT_TOKEN_INVALID');
    assert(Number.isFinite(new Date(payload.assignedAt).getTime()), 'assignment timestamp invalid', 'ASSIGNMENT_TIMESTAMP_INVALID');
    const assignmentBody = {
      arm: payload.arm,
      assignmentToken: payload.assignmentToken,
      experimentId: payload.experimentId,
      preregistrationDigest: payload.preregistrationDigest,
      preRegDigest: payload.preRegDigest,
      assignmentMethod: payload.assignmentMethod,
      unitHash: payload.unitHash,
    };
    assert(payload.assignmentDigest === digest(assignmentBody, 'assignment'), 'assignment digest mismatch', 'ASSIGNMENT_DIGEST_MISMATCH');
    assert(payload.unitHash && !assignments.has(payload.unitHash), 'duplicate assignment unit', 'DUPLICATE_ASSIGNMENT');
    assignments.set(payload.unitHash, receipt);
  }
  const assignmentCounts = { CONTROL: 0, TREATMENT: 0 };
  for (const receipt of assignments.values()) assignmentCounts[receipt.payload.arm] += 1;
  const assignmentN = assignmentCounts.CONTROL + assignmentCounts.TREATMENT;
  const expectedTreatment = Number(experiment.allocation.treatment);
  const assignmentZ = assignmentN > 0
    ? (assignmentCounts.TREATMENT / assignmentN - expectedTreatment) / Math.sqrt(expectedTreatment * (1 - expectedTreatment) / assignmentN)
    : 0;
  assert(Math.abs(assignmentZ) <= Number(experiment.randomizationSanityPolicy.maximumAbsoluteZ), 'broken randomization sample ratio', 'BROKEN_RANDOMIZATION');

  const exposures = new Map();
  const exposureEvidence = new Set();
  const exposureReceiptDigests = new Set();
  for (const receiptDigest of ledger.exposures) {
    assert(!exposureReceiptDigests.has(receiptDigest), 'duplicate exposure receipt', 'DUPLICATE_EXPOSURE');
    exposureReceiptDigests.add(receiptDigest);
    const receipt = await resolveCanonicalReceipt(evidenceAdapter, receiptDigest, { kind: 'EXPOSURE', subjectDigest: experiment.preregistrationDigest, now });
    requireExactEvidenceRealm(receipt, realm);
    const payload = receipt.payload ?? {};
    const assignment = assignments.get(payload.unitHash);
    assert(assignment, 'exposure without assignment', 'EXPOSURE_WITHOUT_ASSIGNMENT');
    assert(!exposures.has(payload.unitHash), 'duplicate unit exposure', 'DUPLICATE_EXPOSURE');
    assert(payload.experimentId === experiment.experimentId, 'exposure experiment mismatch', 'EXPOSURE_EXPERIMENT_MISMATCH');
    assert(payload.assignmentReceiptDigest === assignment.receiptDigest, 'exposure assignment mismatch', 'EXPOSURE_ASSIGNMENT_MISMATCH');
    assert(payload.assignedArm === assignment.payload.arm, 'treatment/control identity mismatch', 'TREATMENT_CONTROL_IDENTITY_MISMATCH');
    const expected = expectedExperience(experiment, assignment.payload.arm);
    assert(payload.actualExperienceVersion === expected.experienceVersion && payload.candidateDigest === expected.candidateDigest, 'treatment/control experience mismatch', 'TREATMENT_CONTROL_IDENTITY_MISMATCH');
    assert(payload.independentObserverSource, 'independent exposure observer missing', 'EXPOSURE_OBSERVER_REQUIRED');
    assert(!payload.treatmentExecutorSource || payload.independentObserverSource !== payload.treatmentExecutorSource, 'treatment executor self-report is insufficient', 'EXPOSURE_OBSERVER_NOT_INDEPENDENT');
    assert(payload.exposureEvidenceDigest && !exposureEvidence.has(payload.exposureEvidenceDigest), 'exposure evidence replayed', 'EXPOSURE_EVIDENCE_REPLAY');
    exposureEvidence.add(payload.exposureEvidenceDigest);
    assert(new Date(payload.observedAt).getTime() >= new Date(assignment.payload.assignedAt).getTime(), 'exposure precedes assignment', 'EXPOSURE_BEFORE_ASSIGNMENT');
    exposures.set(payload.unitHash, receipt);
  }

  const outcomes = new Map();
  const outcomeEvidence = new Set();
  const outcomeReceiptDigests = new Set();
  const windowStart = new Date(experiment.observationWindow.startsAt).getTime();
  const windowEnd = new Date(experiment.observationWindow.endsAt).getTime();
  for (const receiptDigest of ledger.outcomes) {
    assert(!outcomeReceiptDigests.has(receiptDigest), 'duplicate outcome receipt', 'DUPLICATE_OUTCOME');
    outcomeReceiptDigests.add(receiptDigest);
    const receipt = await resolveCanonicalReceipt(evidenceAdapter, receiptDigest, { kind: 'OUTCOME', subjectDigest: experiment.preregistrationDigest, now });
    requireExactEvidenceRealm(receipt, realm);
    const payload = receipt.payload ?? {};
    const exposure = exposures.get(payload.unitHash);
    assert(exposure, 'outcome without verified exposure', 'OUTCOME_WITHOUT_EXPOSURE');
    assert(payload.experimentId === experiment.experimentId, 'outcome experiment mismatch', 'OUTCOME_EXPERIMENT_MISMATCH');
    assert(payload.assignmentReceiptDigest === exposure.payload.assignmentReceiptDigest, 'outcome assignment mismatch', 'OUTCOME_ASSIGNMENT_MISMATCH');
    assert(payload.exposureReceiptDigest === exposure.receiptDigest, 'outcome exposure mismatch', 'OUTCOME_EXPOSURE_MISMATCH');
    assert(payload.assignedArm === exposure.payload.assignedArm, 'outcome treatment/control mismatch', 'TREATMENT_CONTROL_IDENTITY_MISMATCH');
    const metricDefinition = [experiment.primaryMetric, ...experiment.secondaryMetrics]
      .find((entry) => entry.id === payload.metric);
    if (metricDefinition?.type === 'BINARY') {
      assert(typeof payload.observedValue === 'boolean' || Number(payload.observedValue) === 0 || Number(payload.observedValue) === 1, 'binary outcome value invalid', 'OUTCOME_VALUE_INVALID');
    }
    const timestamp = new Date(payload.observedAt).getTime();
    assert(timestamp >= new Date(exposure.payload.observedAt).getTime(), 'outcome precedes exposure', 'OUTCOME_BEFORE_EXPOSURE');
    assert(timestamp >= windowStart && timestamp <= windowEnd, 'outcome outside preregistered window', 'OUTCOME_OUTSIDE_WINDOW');
    assert(payload.outcomeEvidenceDigest && !outcomeEvidence.has(payload.outcomeEvidenceDigest), 'outcome evidence replayed', 'OUTCOME_EVIDENCE_REPLAY');
    outcomeEvidence.add(payload.outcomeEvidenceDigest);
    const key = `${payload.unitHash}:${payload.metric}`;
    assert(!outcomes.has(key), 'duplicate unit metric outcome', 'DUPLICATE_OUTCOME');
    outcomes.set(key, receipt);
  }

  const primary = { CONTROL: [], TREATMENT: [] };
  const guardrailValues = new Map(experiment.guardrails.map((guardrail) => [guardrail.metric, { CONTROL: [], TREATMENT: [] }]));
  for (const receipt of outcomes.values()) {
    const { assignedArm, metric, observedValue } = receipt.payload;
    if (metric === experiment.primaryMetric.id) primary[assignedArm].push(observedValue);
    if (guardrailValues.has(metric)) guardrailValues.get(metric)[assignedArm].push(observedValue);
  }
  const binary = (value) => value === true || Number(value) === 1;
  const controlSuccesses = primary.CONTROL.filter(binary).length;
  const treatmentSuccesses = primary.TREATMENT.filter(binary).length;
  const controlN = primary.CONTROL.length;
  const treatmentN = primary.TREATMENT.length;
  const criticalValue = normalCriticalValue(experiment.confidencePolicy.alpha);
  const stats = twoProportion(controlSuccesses, controlN, treatmentSuccesses, treatmentN, criticalValue);
  const sufficient = controlN >= experiment.minimumSample.perArm && treatmentN >= experiment.minimumSample.perArm;
  const guardrailResults = experiment.guardrails.map((guardrail) => {
    const values = guardrailValues.get(guardrail.metric);
    const controlMean = mean(values.CONTROL);
    const treatmentMean = mean(values.TREATMENT);
    return {
      guardrailId: guardrail.id,
      metric: guardrail.metric,
      controlMean,
      treatmentMean,
      threshold: Number(guardrail.threshold),
      harmWhen: guardrail.harmWhen,
      harmDetected: guardrailHarm(guardrail, controlMean, treatmentMean),
    };
  });
  const harm = guardrailResults.some((result) => result.harmDetected);
  const separated = Boolean(stats && (stats.ciLo > 0 || stats.ciHi < 0));
  let classification = 'INCONCLUSIVE';
  if (harm || (stats && stats.ciHi < 0)) classification = 'HARM';
  else if (sufficient && separated && stats.lift > 0) {
    classification = experiment.assignmentMethod === 'RANDOMIZED' && claimAllowsCausality(experiment.maximumClaimCeiling)
      ? 'CAUSAL_SUPPORTED'
      : 'ASSOCIATIONAL_ONLY';
  } else if (sufficient) classification = 'NULL';
  return sealPlain({
    classification,
    sufficient,
    stats,
    assignmentSanity: {
      control: assignmentCounts.CONTROL,
      treatment: assignmentCounts.TREATMENT,
      expectedTreatmentShare: expectedTreatment,
      observedTreatmentShare: assignmentN ? assignmentCounts.TREATMENT / assignmentN : null,
      z: assignmentZ,
      maximumAbsoluteZ: Number(experiment.randomizationSanityPolicy.maximumAbsoluteZ),
      passed: true,
    },
    counts: {
      assignments: assignments.size,
      verifiedExposures: exposures.size,
      primaryControl: controlN,
      primaryTreatment: treatmentN,
      outcomes: outcomes.size,
    },
    guardrailResults,
    evidenceDigests: {
      assignments: [...assignmentReceiptDigests],
      exposures: [...exposureReceiptDigests],
      outcomes: [...outcomeReceiptDigests],
    },
    limitations: realm === 'VERIFIED_REAL'
      ? []
      : ['SIMULATED / FIXTURE evidence cannot establish a real outcome, real economic value, or RSI'],
  });
}
