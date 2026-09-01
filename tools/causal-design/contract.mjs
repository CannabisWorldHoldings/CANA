/**
 * CAUSAL DESIGN COMPILER — EXPERIMENT CONTRACT (Slice 3).
 *
 * The typed artifact the compiler emits: QUESTION -> IDENTIFICATION
 * REQUIREMENTS -> EXPERIMENT CONTRACT, with a claim ceiling the settlement
 * layer may not exceed. This module owns the ENUMS, the contract SHAPE, and
 * structural VALIDATION of a compiled contract. It contains no inference: the
 * compiler (compiler.mjs) decides; this file only types and verifies.
 *
 * ONE CAPABILITY, ONE OWNER: no other module may define a rival experiment
 * contract, claim ceiling, or unit vocabulary. This file is the canonical home.
 */

import { createHash } from 'node:crypto';
import { EVIDENCE_REALMS, isRealm } from './evidence-realm.mjs';

export const CONTRACT_SCHEMA = 'cana.causal-design.experiment-contract/1';

/** Strongest claim a design can possibly support, weakest -> strongest. */
export const CLAIM_CEILINGS = Object.freeze([
  'DESCRIPTIVE_ONLY',
  'ASSOCIATIONAL',
  'QUASI_CAUSAL',
  'CAUSAL_WITH_ASSUMPTIONS',
  'RANDOMIZED_CAUSAL',
]);

export const CLAIM_CEILING_RANK = Object.freeze({
  DESCRIPTIVE_ONLY: 0,
  ASSOCIATIONAL: 1,
  QUASI_CAUSAL: 2,
  CAUSAL_WITH_ASSUMPTIONS: 3,
  RANDOMIZED_CAUSAL: 4,
});

export const DESIGN_STATUSES = Object.freeze(['VALID', 'DOWNGRADED', 'EXPLORATORY', 'REFUSED']);

/** The experimental unit must never be implicit. */
export const UNIT_KINDS = Object.freeze([
  'SESSION',
  'USER',
  'QUERY',
  'NEIGHBORHOOD',
  'MERCHANT',
  'PAGE',
  'CAMPAIGN',
  'TIME_BLOCK',
  'MARKET',
  'OTHER',
]);

export const ASSIGNMENT_MECHANISMS = Object.freeze([
  'RANDOMIZED',
  'CLUSTER_RANDOMIZED',
  'STEPPED_WEDGE',
  'SWITCHBACK',
  'HOLDOUT',
  'MATCHED_CONTROL',
  'DIFFERENCE_IN_DIFFERENCES',
  'INTERRUPTED_TIME_SERIES',
  'SYNTHETIC_CONTROL',
  'OTHER',
]);

export const EXPOSURE_INDEPENDENCE = Object.freeze(['INDEPENDENT', 'SELF_REPORTED', 'UNVERIFIED']);
export const OUTCOME_TIMING = Object.freeze(['AFTER', 'BEFORE', 'UNKNOWN']);
export const OUTCOME_PROVENANCE = Object.freeze(['KNOWN', 'UNKNOWN']);
export const OUTCOME_SOURCE = Object.freeze(['OBSERVED', 'SYNTHETIC']);

export const IDENTIFICATION_VOID = 'I CANNOT IDENTIFY THE EFFECT FROM THIS DESIGN.';

export function isClaimCeiling(value) {
  return typeof value === 'string' && value in CLAIM_CEILING_RANK;
}

export function claimCeilingRank(value) {
  if (!isClaimCeiling(value)) throw new Error(`unknown claim ceiling: ${String(value)}`);
  return CLAIM_CEILING_RANK[value];
}

function canonicalValue(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return value;
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((k) => [k, canonicalValue(value[k])]),
    );
  }
  return String(value);
}

export function canonicalize(value) {
  return JSON.stringify(canonicalValue(value));
}

export function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

export function hashCanonical(value) {
  return sha256(canonicalize(value));
}

const REQUIRED_STRINGS = {
  question: ['unknown', 'currentBelief'],
  treatment: ['intervention', 'executionContract'],
  population: ['eligibility'],
  assignment: ['mechanism', 'justification'],
  counterfactual: ['statement'],
  metrics: ['primary'],
  stopConditions: ['success', 'futility', 'harm', 'operationalFailure', 'contamination', 'ownerIntervention'],
};

/**
 * Build the canonical contract object from the compiler's typed input and its
 * computed outputs. The digest covers everything EXCEPT `digest` itself, so a
 * contract can be re-derived deterministically from its inputs + ceiling.
 */
export function makeExperimentContract(input, compiled) {
  const { question, treatment, unit, population, assignment, counterfactual, interference, metrics, baseline, power, stopConditions, analysisPlan, exposure, outcome, integrity, realm } = input;

  const contract = {
    schema: CONTRACT_SCHEMA,
    compiledAt: new Date().toISOString(),
    status: compiled.status,
    claimCeiling: compiled.claimCeiling,
    canIdentify: compiled.canIdentify,
    identificationStatement: compiled.identificationStatement,
    identificationAssumptions: compiled.identificationAssumptions,
    question,
    treatment: { ...treatment, reversible: treatment.reversible === true },
    unit,
    population,
    assignment,
    counterfactual,
    interference: { possible: interference?.possible === true, handled: interference?.handled === true, note: interference?.note ?? null },
    metrics,
    baseline: { present: baseline?.present === true, description: baseline?.description ?? null, capturedBeforeIntervention: baseline?.capturedBeforeIntervention === true },
    power: {
      sample: power?.sample ?? null,
      required: power?.required ?? null,
      declaredInference: power?.declaredInference ?? 'EXPLORATORY',
    },
    stopConditions,
    analysisPlan: {
      frozen: analysisPlan?.frozen === true,
      frozenBeforeExposure: analysisPlan?.frozenBeforeExposure === true,
      multipleComparisonCorrection: analysisPlan?.multipleComparisonCorrection ?? 'NONE',
    },
    exposure: {
      verified: exposure?.verified === true,
      independence: exposure?.independence ?? 'UNVERIFIED',
      executor: exposure?.executor ?? null,
      verifier: exposure?.verifier ?? null,
    },
    outcome: {
      timingRelativeToTreatment: outcome?.timingRelativeToTreatment ?? 'UNKNOWN',
      realm: outcome?.realm ?? 'LOCAL',
      provenance: outcome?.provenance ?? 'UNKNOWN',
      source: outcome?.source ?? 'OBSERVED',
    },
    integrity: integrity ?? {},
    realm: realm ?? 'LOCAL',
  };

  const digest = hashCanonical(contract);
  return { ...contract, digest };
}

/**
 * Structural validation of a compiled contract. Does NOT re-run the compiler;
 * it proves the artifact is well-formed (all enums valid, required fields
 * present, ceiling legitimate).
 */
export function validateExperimentContract(contract) {
  const errors = [];
  const has = (v) => v !== undefined && v !== null;

  if (!contract || contract.schema !== CONTRACT_SCHEMA) errors.push('schema must be ' + CONTRACT_SCHEMA);
  if (!DESIGN_STATUSES.includes(contract?.status)) errors.push(`status must be one of ${DESIGN_STATUSES.join(',')}`);
  if (!isClaimCeiling(contract?.claimCeiling)) errors.push(`claimCeiling must be one of ${CLAIM_CEILINGS.join(',')}`);

  for (const [section, keys] of Object.entries(REQUIRED_STRINGS)) {
    const sec = contract?.[section];
    for (const k of keys) {
      if (!has(sec?.[k]) || typeof sec[k] !== 'string' || sec[k].trim() === '') {
        errors.push(`${section}.${k} is required`);
      }
    }
  }

  if (contract?.unit && !UNIT_KINDS.includes(contract.unit.kind)) {
    errors.push(`unit.kind must be one of ${UNIT_KINDS.join(',')}`);
  }
  if (contract?.unit && contract.unit.kind === 'OTHER' && (!contract.unit.spec || contract.unit.spec.trim() === '')) {
    errors.push('unit.kind "OTHER" requires an explicit unit.spec');
  }
  if (contract?.assignment && !ASSIGNMENT_MECHANISMS.includes(contract.assignment.mechanism)) {
    errors.push(`assignment.mechanism must be one of ${ASSIGNMENT_MECHANISMS.join(',')}`);
  }
  if (contract?.exposure && !EXPOSURE_INDEPENDENCE.includes(contract.exposure.independence)) {
    errors.push(`exposure.independence must be one of ${EXPOSURE_INDEPENDENCE.join(',')}`);
  }
  if (contract?.outcome && !isRealm(contract.outcome.realm)) {
    errors.push(`outcome.realm must be one of ${EVIDENCE_REALMS.join(',')}`);
  }
  if (contract?.outcome && !OUTCOME_TIMING.includes(contract.outcome.timingRelativeToTreatment)) {
    errors.push(`outcome.timingRelativeToTreatment must be one of ${OUTCOME_TIMING.join(',')}`);
  }
  if (contract?.outcome && !OUTCOME_SOURCE.includes(contract.outcome.source)) {
    errors.push(`outcome.source must be one of ${OUTCOME_SOURCE.join(',')}`);
  }
  if (contract?.realm && !isRealm(contract.realm)) {
    errors.push(`realm must be one of ${EVIDENCE_REALMS.join(',')}`);
  }
  if (contract?.metrics && (!Array.isArray(contract.metrics.guardrails) || !Array.isArray(contract.metrics.diagnostics))) {
    errors.push('metrics.guardrails and metrics.diagnostics must be arrays');
  }

  return { ok: errors.length === 0, errors };
}
