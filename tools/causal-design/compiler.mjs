/**
 * CAUSAL DESIGN COMPILER — QUESTION -> IDENTIFICATION REQUIREMENTS -> CONTRACT.
 *
 * The engine behind Slice 3. It compiles a design intent into an experiment
 * contract and computes the STRONGEST claim that design can possibly support.
 * It is pure and deterministic: same input -> same contract -> same ceiling.
 *
 * The compiler is a REFUSAL + DOWNGRADE machine on purpose. A smart causal
 * system must frequently say "I CANNOT IDENTIFY THE EFFECT FROM THIS DESIGN."
 * Intelligence here is refusal, not enthusiasm.
 *
 * Effect-plane law: this module PROPOSES nothing, AUTHORIZES nothing, and
 * EXECUTES nothing. It only judges whether a design could identify an effect.
 * It never mints authority (see tools/authority for the single seat) and never
 * self-certifies (independent evaluators settle outcomes).
 */

import {
  ASSIGNMENT_MECHANISMS,
  CLAIM_CEILINGS,
  claimCeilingRank,
  DESIGN_STATUSES,
  EXPOSURE_INDEPENDENCE,
  IDENTIFICATION_VOID,
  isClaimCeiling,
  makeExperimentContract,
  OUTCOME_PROVENANCE,
  OUTCOME_SOURCE,
  OUTCOME_TIMING,
  UNIT_KINDS,
} from './contract.mjs';
import { isRealm } from './evidence-realm.mjs';

/** Natural ceiling implied by the assignment mechanism alone. */
export const NATURAL_CEILING = Object.freeze({
  RANDOMIZED: 'RANDOMIZED_CAUSAL',
  HOLDOUT: 'CAUSAL_WITH_ASSUMPTIONS',
  CLUSTER_RANDOMIZED: 'CAUSAL_WITH_ASSUMPTIONS',
  STEPPED_WEDGE: 'CAUSAL_WITH_ASSUMPTIONS',
  SWITCHBACK: 'CAUSAL_WITH_ASSUMPTIONS',
  MATCHED_CONTROL: 'QUASI_CAUSAL',
  DIFFERENCE_IN_DIFFERENCES: 'QUASI_CAUSAL',
  INTERRUPTED_TIME_SERIES: 'QUASI_CAUSAL',
  SYNTHETIC_CONTROL: 'QUASI_CAUSAL',
  OTHER: 'ASSOCIATIONAL',
});

const minCeiling = (a, b) => (claimCeilingRank(a) <= claimCeilingRank(b) ? a : b);

/**
 * A rule is { code, kind: 'REFUSE' | 'DOWNGRADE', cap?, evaluate(input) -> boolean | {message} }.
 * REFUSE rules are fatal (the design is logically void). DOWNGRADE rules lower
 * the claim ceiling to `cap` when triggered. `message` is human-readable and is
 * carried into the contract's identification assumptions.
 */
const RULES = [
  // ---- REFUSALS: the design is self-contradictory or epistemically void ----
  {
    code: 'R_NO_QUESTION',
    kind: 'REFUSE',
    evaluate: (i) => !i.question?.unknown?.trim() || !i.question?.currentBelief?.trim(),
    message: 'No unknown or current belief stated: there is no question to resolve.',
  },
  {
    code: 'R_UNIT_UNSPECIFIED',
    kind: 'REFUSE',
    evaluate: (i) => !i.unit?.kind || !UNIT_KINDS.includes(i.unit.kind) || (i.unit.kind === 'OTHER' && !i.unit.spec?.trim()),
    message: 'The experimental unit is implicit. A unit (session, user, query, merchant, ...) must be explicit.',
  },
  {
    code: 'R_NO_PRIMARY_METRIC',
    kind: 'REFUSE',
    evaluate: (i) => !i.metrics?.primary?.trim(),
    message: 'No primary outcome metric: nothing is being measured.',
  },
  {
    code: 'R_OUTCOME_BEFORE_TREATMENT',
    kind: 'REFUSE',
    evaluate: (i) => i.outcome?.timingRelativeToTreatment === 'BEFORE',
    message: 'Outcome is observed before treatment: temporally impossible causal direction.',
  },
  {
    code: 'R_FUTURE_KNOWLEDGE_ASSIGNMENT',
    kind: 'REFUSE',
    evaluate: (i) => i.assignment?.usesFutureData === true,
    message: 'Assignment uses information that did not exist at assignment time.',
  },
  {
    code: 'R_SYNTHETIC_OUTCOME_AS_REAL',
    kind: 'REFUSE',
    evaluate: (i) => i.outcome?.source === 'SYNTHETIC' && i.outcome?.realm === 'REAL_OUTCOME',
    message: 'SYNTHETIC -> REAL_OUTCOME is forbidden: a synthetic outcome cannot be presented as a real outcome.',
  },

  // ---- DOWNGRADES: the design compiles, but its ceiling collapses ----
  {
    code: 'D_NO_BASELINE',
    kind: 'DOWNGRADE',
    cap: 'DESCRIPTIVE_ONLY',
    evaluate: (i) => i.baseline?.present !== true,
    message: 'No baseline captured before intervention: before/after attribution is impossible.',
  },
  {
    code: 'D_NO_COUNTERFACTUAL',
    kind: 'DOWNGRADE',
    cap: 'DESCRIPTIVE_ONLY',
    evaluate: (i) => !i.counterfactual?.statement?.trim(),
    message: 'No counterfactual stated: the untreated outcome is undefined (CAUSAL_IDENTIFICATION_INSUFFICIENT).',
  },
  {
    code: 'D_POST_TREATMENT_METRIC_SELECTION',
    kind: 'DOWNGRADE',
    cap: 'DESCRIPTIVE_ONLY',
    evaluate: (i) => i.analysisPlan?.frozen !== true || i.analysisPlan?.frozenBeforeExposure !== true,
    message: 'Analysis plan not frozen before exposure: metrics may be selected after seeing the data.',
  },
  {
    code: 'D_UNVERIFIED_EXPOSURE',
    kind: 'DOWNGRADE',
    cap: 'DESCRIPTIVE_ONLY',
    evaluate: (i) => i.exposure?.verified !== true,
    message: 'No verified exposure: DEPLOYMENT != EXPOSURE, so outcome attribution is impossible.',
  },
  {
    code: 'D_SELF_REPORTED_EXPOSURE',
    kind: 'DOWNGRADE',
    cap: 'DESCRIPTIVE_ONLY',
    evaluate: (i) => i.exposure?.independence === 'SELF_REPORTED',
    message: 'Exposure is self-reported by the executor; attribution requires an independent observer.',
  },
  {
    code: 'D_INTERFERENCE_UNHANDLED',
    kind: 'DOWNGRADE',
    cap: 'DESCRIPTIVE_ONLY',
    evaluate: (i) => i.interference?.possible === true && i.interference?.handled !== true,
    message: 'Material interference is possible and unhandled (SUTVA violated): causal identification insufficient.',
  },
  {
    code: 'D_TREATMENT_LEAKAGE',
    kind: 'DOWNGRADE',
    cap: 'ASSOCIATIONAL',
    evaluate: (i) => i.integrity?.controlContamination === true,
    message: 'Control group is contaminated by the treatment.',
  },
  {
    code: 'D_OVERLAPPING_EXPERIMENTS',
    kind: 'DOWNGRADE',
    cap: 'ASSOCIATIONAL',
    evaluate: (i) => i.integrity?.overlappingExperiments === true,
    message: 'Concurrent overlapping experiments on the same units confound attribution.',
  },
  {
    code: 'D_SAMPLE_TOO_SMALL',
    kind: 'DOWNGRADE',
    cap: 'ASSOCIATIONAL',
    evaluate: (i) =>
      i.power?.declaredInference === 'INFERENTIAL'
      && Number.isFinite(i.power?.sample)
      && Number.isFinite(i.power?.required)
      && i.power.sample < i.power.required,
    message: 'Sample is smaller than the preregistered minimum for the declared inference.',
  },
  {
    code: 'D_UNIT_MISMATCH',
    kind: 'DOWNGRADE',
    cap: 'DESCRIPTIVE_ONLY',
    evaluate: (i) => i.integrity?.unitConsistent === false,
    message: 'The unit changed between assignment and analysis.',
  },
  {
    code: 'D_SURVIVORSHIP_BIAS',
    kind: 'DOWNGRADE',
    cap: 'DESCRIPTIVE_ONLY',
    evaluate: (i) => i.integrity?.survivorshipBias === true,
    message: 'Population conditioned on surviving/observable cases only (survivorship bias).',
  },
  {
    code: 'D_SELECTION_BIAS',
    kind: 'DOWNGRADE',
    cap: 'DESCRIPTIVE_ONLY',
    evaluate: (i) => i.integrity?.selectionBias === true,
    message: 'Treatment assignment correlates with the outcome via selection.',
  },
  {
    code: 'D_CONCURRENT_CHANGE',
    kind: 'DOWNGRADE',
    cap: 'QUASI_CAUSAL',
    evaluate: (i) => i.integrity?.concurrentChanges === true,
    message: 'Another major variable changed at the same time as treatment.',
  },
  {
    code: 'D_SEASONALITY',
    kind: 'DOWNGRADE',
    cap: 'QUASI_CAUSAL',
    evaluate: (i) => i.integrity?.seasonalContext === true && i.integrity?.seasonalityAddressed !== true,
    message: 'Seasonality is present and unaddressed.',
  },
  {
    code: 'D_REGRESSION_TO_MEAN',
    kind: 'DOWNGRADE',
    cap: 'ASSOCIATIONAL',
    evaluate: (i) => i.integrity?.regressionRisk === true && i.integrity?.regressionToMeanAddressed !== true,
    message: 'Units selected on extreme values without a regression-to-the-mean control.',
  },
  {
    code: 'D_TRACKING_OUTAGE',
    kind: 'DOWNGRADE',
    cap: 'DESCRIPTIVE_ONLY',
    evaluate: (i) => i.integrity?.trackingOutage === true,
    message: 'Outcome tracking was interrupted during exposure.',
  },
  {
    code: 'D_P_HACKING',
    kind: 'DOWNGRADE',
    cap: 'ASSOCIATIONAL',
    evaluate: (i) => i.integrity?.pHacking === true,
    message: 'Multiple comparisons without preregistered correction.',
  },
  {
    code: 'D_UNRECORDED_MUTATION',
    kind: 'DOWNGRADE',
    cap: 'DESCRIPTIVE_ONLY',
    evaluate: (i) => i.integrity?.unrecordedMutation === true,
    message: 'The experiment changed mid-run without a recorded mutation.',
  },
  {
    code: 'D_UNKNOWN_PROVENANCE',
    kind: 'DOWNGRADE',
    cap: 'DESCRIPTIVE_ONLY',
    evaluate: (i) => i.outcome?.provenance === 'UNKNOWN',
    message: 'Outcome data provenance is unknown.',
  },
];

function structuralRefusals(input) {
  const refusals = [];
  if (!input) return [{ code: 'R_NO_INPUT', message: 'No design input provided.' }];
  if (input.realm !== undefined && !isRealm(input.realm)) {
    refusals.push({ code: 'R_BAD_DESIGN_REALM', message: `design realm must be a valid evidence realm (got ${input.realm})` });
  }
  if (input.assignment?.mechanism !== undefined && !ASSIGNMENT_MECHANISMS.includes(input.assignment.mechanism)) {
    refusals.push({ code: 'R_BAD_MECHANISM', message: `assignment.mechanism must be one of ${ASSIGNMENT_MECHANISMS.join(', ')}` });
  }
  if (input.exposure?.independence !== undefined && !EXPOSURE_INDEPENDENCE.includes(input.exposure.independence)) {
    refusals.push({ code: 'R_BAD_EXPOSURE_INDEPENDENCE', message: `exposure.independence must be one of ${EXPOSURE_INDEPENDENCE.join(', ')}` });
  }
  if (input.outcome?.timingRelativeToTreatment !== undefined && !OUTCOME_TIMING.includes(input.outcome.timingRelativeToTreatment)) {
    refusals.push({ code: 'R_BAD_OUTCOME_TIMING', message: `outcome.timingRelativeToTreatment must be one of ${OUTCOME_TIMING.join(', ')}` });
  }
  if (input.outcome?.source !== undefined && !OUTCOME_SOURCE.includes(input.outcome.source)) {
    refusals.push({ code: 'R_BAD_OUTCOME_SOURCE', message: `outcome.source must be one of ${OUTCOME_SOURCE.join(', ')}` });
  }
  if (input.outcome?.provenance !== undefined && !OUTCOME_PROVENANCE.includes(input.outcome.provenance)) {
    refusals.push({ code: 'R_BAD_OUTCOME_PROVENANCE', message: `outcome.provenance must be one of ${OUTCOME_PROVENANCE.join(', ')}` });
  }
  return refusals;
}

/**
 * Compile a design intent into an experiment contract.
 *
 * @param {object} input design intent (see contract.mjs for the typed shape)
 * @returns {{ ok: boolean, status, claimCeiling: string|null, canIdentify: boolean,
 *             identificationStatement: string, identificationAssumptions: string[],
 *             refusals: object[], downgrades: object[], contract: object|null }}
 */
export function compileExperimentDesign(input) {
  const refusals = structuralRefusals(input);
  const downgrades = [];

  for (const rule of RULES) {
    let triggered = false;
    try {
      triggered = rule.evaluate(input) === true;
    } catch {
      triggered = false;
    }
    if (!triggered) continue;
    if (rule.kind === 'REFUSE') refusals.push({ code: rule.code, message: rule.message });
    else downgrades.push({ code: rule.code, cap: rule.cap, message: rule.message });
  }

  if (refusals.length > 0) {
    return {
      ok: false,
      status: 'REFUSED',
      claimCeiling: null,
      canIdentify: false,
      identificationStatement: IDENTIFICATION_VOID,
      identificationAssumptions: [],
      refusals,
      downgrades,
      contract: null,
    };
  }

  // Natural ceiling from the assignment mechanism alone.
  let ceiling = NATURAL_CEILING[input.assignment?.mechanism] ?? 'ASSOCIATIONAL';

  // Apply every downgrade cap.
  for (const d of downgrades) ceiling = minCeiling(ceiling, d.cap);

  // A declared ceiling may only LOWER the computed ceiling, never raise it.
  const declared = input.declaredCeiling;
  if (isClaimCeiling(declared)) {
    if (claimCeilingRank(declared) > claimCeilingRank(ceiling)) {
      downgrades.push({
        code: 'D_OVERCLAIM',
        cap: ceiling,
        message: `Declared ceiling ${declared} exceeds the computable ceiling ${ceiling}; forced down.`,
      });
    } else {
      ceiling = declared;
    }
  }

  const exploratory = input.power?.declaredInference === 'EXPLORATORY'
    || downgrades.some((d) => d.code === 'D_SAMPLE_TOO_SMALL');

  const status = exploratory ? 'EXPLORATORY' : downgrades.length > 0 ? 'DOWNGRADED' : 'VALID';

  const identificationAssumptions = [
    input.assignment?.justification ? `assignment: ${input.assignment.justification}` : null,
    input.interference?.possible && input.interference.handled ? `interference handled: ${input.interference.note ?? ''}` : null,
    input.counterfactual?.estimabilityEvidence ? `counterfactual: ${input.counterfactual.estimabilityEvidence}` : null,
    ...downgrades.map((d) => `[${d.code}] ${d.message}`),
  ].filter(Boolean);

  const canIdentify = claimCeilingRank(ceiling) >= claimCeilingRank('QUASI_CAUSAL');
  const identificationStatement = canIdentify
    ? `The strongest claim this design can support is ${ceiling}.`
    : IDENTIFICATION_VOID;

  const contract = makeExperimentContract(input, {
    status,
    claimCeiling: ceiling,
    canIdentify,
    identificationStatement,
    identificationAssumptions,
  });

  return {
    ok: true,
    status,
    claimCeiling: ceiling,
    canIdentify,
    identificationStatement,
    identificationAssumptions,
    refusals: [],
    downgrades,
    contract,
  };
}

/**
 * The settlement layer may not claim higher than the design ceiling.
 * @returns {{ ok: boolean, reason?: string }}
 */
export function assertSettlementWithinCeiling(designCeiling, settlementClaim) {
  if (!isClaimCeiling(designCeiling) || !isClaimCeiling(settlementClaim)) {
    return { ok: false, reason: `both ceilings must be valid (got ${designCeiling} vs ${settlementClaim})` };
  }
  if (claimCeilingRank(settlementClaim) > claimCeilingRank(designCeiling)) {
    return {
      ok: false,
      reason: `settlement claims ${settlementClaim}, which exceeds the design ceiling ${designCeiling}`,
    };
  }
  return { ok: true };
}

export const SUPPORTED_CEILINGS = CLAIM_CEILINGS;
