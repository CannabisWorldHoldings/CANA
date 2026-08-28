/**
 * CAUSAL DESIGN COMPILER — ADVERSARIAL CORPUS.
 *
 * The compiler is not trusted until an adversarial corpus attacks it. Each case
 * is a single mutation of a valid randomized design that the compiler MUST
 * refuse or downgrade. These are the failure modes from the reality-closure
 * brief, made executable.
 *
 * A case that the compiler passes when it should refuse is a REAL regression —
 * this corpus is the standing proof the compiler says "I CANNOT IDENTIFY THE
 * EFFECT FROM THIS DESIGN." when the design cannot support identification.
 */

import { compileExperimentDesign } from './compiler.mjs';

/** The canonical VALID design: session-level randomization, preregistered,
 *  independently-verified exposure, baseline + counterfactual present. */
export const VALID_RANDOMIZED_DESIGN = Object.freeze({
  realm: 'LOCAL',
  question: {
    unknown: 'Whether merchant-approved creative increases qualified handoffs relative to control.',
    currentBelief: 'Creative quality drives intent; effect size is unmeasured.',
    competingHypotheses: ['Creative increases handoffs', 'Creative is neutral', 'Creative is harmful'],
    economicRelevance: 'Determines whether merchant-approved creative becomes the default render.',
    decisionAtRisk: 'Shipping creative as the default merchant-page presentation.',
  },
  treatment: {
    intervention: 'Merchant-approved creative card on the retailer page.',
    variants: ['control', 'creative-v1'],
    timing: '2026-09-01T00:00:00Z',
    executionContract: 'bounded render change through the existing page pipeline',
    reversible: true,
  },
  unit: { kind: 'SESSION', spec: 'one page-view session per visitor' },
  population: {
    eligibility: 'DC retail pages',
    exclusions: ['bots'],
    geography: 'DC',
    window: '14 days',
  },
  assignment: {
    mechanism: 'RANDOMIZED',
    justification: 'session-level coin flip decided before render',
    usesFutureData: false,
  },
  counterfactual: {
    statement: 'Control sessions show the handoff rate that would have occurred without creative.',
    estimabilityEvidence: 'Randomization makes control a valid exchangeable proxy.',
  },
  interference: { possible: false, handled: true, note: 'Sessions are independent.' },
  metrics: {
    primary: 'qualified_handoff_rate',
    guardrails: ['bounce_rate'],
    diagnostics: ['render_latency'],
    cost: 'zero-marginal',
    customerUtility: 'task_success_rate',
  },
  baseline: {
    present: true,
    description: '14-day pre-intervention qualified handoff rate',
    capturedBeforeIntervention: true,
  },
  power: { sample: 40000, required: 8000, declaredInference: 'INFERENTIAL' },
  stopConditions: {
    success: 'CI excludes zero and lift > +5%',
    futility: 'lift CI within +/-1% at 50% sample',
    harm: 'bounce_rate lift > +10%',
    operationalFailure: 'render_latency p95 > 2s',
    contamination: 'assignment logs diverge',
    ownerIntervention: 'owner revokes',
  },
  analysisPlan: {
    frozen: true,
    frozenBeforeExposure: true,
    multipleComparisonCorrection: 'PREREGISTERED',
  },
  exposure: {
    verified: true,
    independence: 'INDEPENDENT',
    executor: 'creative-pipeline',
    verifier: 'exposure-observer',
  },
  outcome: {
    timingRelativeToTreatment: 'AFTER',
    realm: 'LOCAL',
    provenance: 'KNOWN',
    source: 'OBSERVED',
  },
  integrity: {
    concurrentChanges: false,
    seasonalityAddressed: true,
    seasonalContext: false,
    regressionToMeanAddressed: true,
    regressionRisk: false,
    trackingOutage: false,
    unrecordedMutation: false,
    controlContamination: false,
    overlappingExperiments: false,
    unitConsistent: true,
    survivorshipBias: false,
    selectionBias: false,
    pHacking: false,
  },
});

/** Deep-merge plain objects (arrays are replaced, not merged). */
export function deepMerge(base, patch) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(patch ?? {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base?.[k] && typeof base[k] === 'object' && !Array.isArray(base[k])
      ? deepMerge(base[k], v)
      : v;
  }
  return out;
}

/**
 * Every case mutates the valid design by ONE failure mode.
 * expect: 'REFUSE'  -> compiler must return status REFUSED
 * expect: 'DOWNGRADE' -> compiler must return DOWNGRADED or EXPLORATORY,
 *                        with the named code present.
 */
export const ADVERSARIAL_CORPUS = Object.freeze([
  { id: 'A01', name: 'no baseline', expect: 'DOWNGRADE', code: 'D_NO_BASELINE', patch: { baseline: { present: false } } },
  { id: 'A02', name: 'no counterfactual', expect: 'DOWNGRADE', code: 'D_NO_COUNTERFACTUAL', patch: { counterfactual: { statement: '', estimabilityEvidence: '' } } },
  { id: 'A03', name: 'post-treatment metric selection', expect: 'DOWNGRADE', code: 'D_POST_TREATMENT_METRIC_SELECTION', patch: { analysisPlan: { frozen: false, frozenBeforeExposure: false } } },
  { id: 'A04', name: 'treatment leakage into control', expect: 'DOWNGRADE', code: 'D_TREATMENT_LEAKAGE', patch: { integrity: { controlContamination: true } } },
  { id: 'A05', name: 'overlapping experiments', expect: 'DOWNGRADE', code: 'D_OVERLAPPING_EXPERIMENTS', patch: { integrity: { overlappingExperiments: true } } },
  { id: 'A06', name: 'unverified exposure', expect: 'DOWNGRADE', code: 'D_UNVERIFIED_EXPOSURE', patch: { exposure: { verified: false, independence: 'UNVERIFIED' } } },
  { id: 'A07', name: 'outcome observed before treatment', expect: 'REFUSE', code: 'R_OUTCOME_BEFORE_TREATMENT', patch: { outcome: { timingRelativeToTreatment: 'BEFORE' } } },
  { id: 'A08', name: 'synthetic outcome claimed as real', expect: 'REFUSE', code: 'R_SYNTHETIC_OUTCOME_AS_REAL', patch: { outcome: { source: 'SYNTHETIC', realm: 'REAL_OUTCOME' } } },
  { id: 'A09', name: 'sample too small for declared inference', expect: 'DOWNGRADE', code: 'D_SAMPLE_TOO_SMALL', patch: { power: { sample: 200, required: 8000, declaredInference: 'INFERENTIAL' } } },
  { id: 'A10', name: 'unit mismatch', expect: 'DOWNGRADE', code: 'D_UNIT_MISMATCH', patch: { integrity: { unitConsistent: false } } },
  { id: 'A11', name: 'survivorship bias', expect: 'DOWNGRADE', code: 'D_SURVIVORSHIP_BIAS', patch: { integrity: { survivorshipBias: true } } },
  { id: 'A12', name: 'selection bias', expect: 'DOWNGRADE', code: 'D_SELECTION_BIAS', patch: { integrity: { selectionBias: true } } },
  { id: 'A13', name: 'assignment uses future knowledge', expect: 'REFUSE', code: 'R_FUTURE_KNOWLEDGE_ASSIGNMENT', patch: { assignment: { usesFutureData: true } } },
  { id: 'A14', name: 'merchant changed another major variable simultaneously', expect: 'DOWNGRADE', code: 'D_CONCURRENT_CHANGE', patch: { integrity: { concurrentChanges: true } } },
  { id: 'A15', name: 'seasonality not accounted for', expect: 'DOWNGRADE', code: 'D_SEASONALITY', patch: { integrity: { seasonalContext: true, seasonalityAddressed: false } } },
  { id: 'A16', name: 'regression to the mean', expect: 'DOWNGRADE', code: 'D_REGRESSION_TO_MEAN', patch: { integrity: { regressionRisk: true, regressionToMeanAddressed: false } } },
  { id: 'A17', name: 'tracking outage', expect: 'DOWNGRADE', code: 'D_TRACKING_OUTAGE', patch: { integrity: { trackingOutage: true } } },
  { id: 'A18', name: 'executor self-reporting exposure', expect: 'DOWNGRADE', code: 'D_SELF_REPORTED_EXPOSURE', patch: { exposure: { independence: 'SELF_REPORTED' } } },
  { id: 'A19', name: 'missing outcome', expect: 'REFUSE', code: 'R_NO_PRIMARY_METRIC', patch: { metrics: { primary: '' } } },
  { id: 'A20', name: 'p-hacking / multiple-comparison abuse', expect: 'DOWNGRADE', code: 'D_P_HACKING', patch: { integrity: { pHacking: true } } },
  { id: 'A21', name: 'unrecorded experiment mutation', expect: 'DOWNGRADE', code: 'D_UNRECORDED_MUTATION', patch: { integrity: { unrecordedMutation: true } } },
  { id: 'A22', name: 'outcome provenance unknown', expect: 'DOWNGRADE', code: 'D_UNKNOWN_PROVENANCE', patch: { outcome: { provenance: 'UNKNOWN' } } },
  { id: 'A23', name: 'experimental unit left implicit', expect: 'REFUSE', code: 'R_UNIT_UNSPECIFIED', patch: { unit: { kind: '', spec: '' } } },
]);

/**
 * Run the corpus. Returns one row per case with the compiler's verdict so a
 * court can assert every case behaves as required.
 */
export function runCorpus(compile = compileExperimentDesign) {
  return ADVERSARIAL_CORPUS.map((c) => {
    const result = compile(deepMerge(VALID_RANDOMIZED_DESIGN, c.patch));
    const triggeredCode = c.expect === 'REFUSE'
      ? result.refusals.some((r) => r.code === c.code)
      : result.downgrades.some((d) => d.code === c.code);
    const pass = c.expect === 'REFUSE'
      ? result.status === 'REFUSED' && triggeredCode
      : (result.status === 'DOWNGRADED' || result.status === 'EXPLORATORY') && triggeredCode;
    return {
      id: c.id,
      name: c.name,
      expect: c.expect,
      code: c.code,
      status: result.status,
      ceiling: result.claimCeiling,
      codeHit: triggeredCode,
      pass,
    };
  });
}
