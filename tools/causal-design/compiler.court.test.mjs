/**
 * CAUSAL DESIGN COMPILER — VERIFICATION COURTS (Slice 3).
 *
 * Six courts, per the reality-closure verification standard:
 *   1 POSITIVE      — correct designs compile to the right ceiling.
 *   2 NEGATIVE      — invalid designs refuse or collapse to the right ceiling.
 *   3 ADVERSARIAL   — the full attack corpus (§8) is refused/downgraded.
 *   4 INTEGRATION   — the capability census + verify gate remain intact;
 *                     the compiler claims no authority (effect-plane separation).
 *   5 HOLDOUT       — unseen cases the corpus does not contain.
 *   6 REALM         — the evidence-realm law: no silent upgrades.
 *
 * Nothing here is weakened to make the compiler pass; the compiler is
 * REFUSAL-HEAVY by design.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CLAIM_CEILING_RANK,
  CONTRACT_SCHEMA,
  IDENTIFICATION_VOID,
  validateExperimentContract,
} from './contract.mjs';
import {
  assertSettlementWithinCeiling,
  compileExperimentDesign,
  NATURAL_CEILING,
} from './compiler.mjs';
import { ADVERSARIAL_CORPUS, deepMerge, runCorpus, VALID_RANDOMIZED_DESIGN } from './adversarial.mjs';
import {
  assertNoSilentUpgrade,
  EVIDENCE_REALMS,
  makeEvidenceReceipt,
  REALM_RANK,
} from './evidence-realm.mjs';
import { censusVerdict, loadOwners } from '../federation/capability-census.mjs';
import { censusGateForVerify } from '../federation/census-gate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

const diDDesign = deepMerge(VALID_RANDOMIZED_DESIGN, {
  assignment: { mechanism: 'DIFFERENCE_IN_DIFFERENCES', justification: 'parallel trends between treated and control merchants' },
});

// ---------------------------------------------------------------- COURT 1 — POSITIVE

test('POSITIVE: a valid session-randomized design compiles to RANDOMIZED_CAUSAL', () => {
  const r = compileExperimentDesign(VALID_RANDOMIZED_DESIGN);
  assert.equal(r.ok, true);
  assert.equal(r.status, 'VALID');
  assert.equal(r.claimCeiling, 'RANDOMIZED_CAUSAL');
  assert.equal(r.canIdentify, true);
  assert.deepEqual(r.refusals, []);
  assert.deepEqual(r.downgrades, []);
  assert.equal(validateExperimentContract(r.contract).ok, true);
  assert.equal(r.contract.schema, CONTRACT_SCHEMA);
});

test('POSITIVE: difference-in-differences compiles to QUASI_CAUSAL (not causal)', () => {
  const r = compileExperimentDesign(diDDesign);
  assert.equal(r.ok, true);
  assert.equal(r.claimCeiling, 'QUASI_CAUSAL');
  assert.equal(r.status, 'VALID');
});

test('POSITIVE: every assignment mechanism maps to the correct natural ceiling', () => {
  const expected = {
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
  };
  for (const [mechanism, ceiling] of Object.entries(expected)) {
    assert.equal(NATURAL_CEILING[mechanism], ceiling, mechanism);
  }
});

test('POSITIVE: a design with no assignment/counterfactual/baseline collapses to DESCRIPTIVE_ONLY and says it cannot identify', () => {
  const r = compileExperimentDesign(deepMerge(VALID_RANDOMIZED_DESIGN, {
    assignment: { mechanism: 'OTHER', justification: 'observational description; no assignment applied' },
    counterfactual: { statement: '', estimabilityEvidence: '' },
    baseline: { present: false },
  }));
  assert.equal(r.ok, true);
  assert.equal(r.claimCeiling, 'DESCRIPTIVE_ONLY');
  assert.equal(r.canIdentify, false);
  assert.equal(r.identificationStatement, IDENTIFICATION_VOID);
});

test('POSITIVE: a conservative declared ceiling below the computed ceiling is respected', () => {
  const r = compileExperimentDesign(deepMerge(VALID_RANDOMIZED_DESIGN, { declaredCeiling: 'ASSOCIATIONAL' }));
  assert.equal(r.claimCeiling, 'ASSOCIATIONAL');
  assert.equal(r.status, 'VALID');
});

// ---------------------------------------------------------------- COURT 2 — NEGATIVE

test('NEGATIVE: a declared ceiling above the computable ceiling is forced down and flagged', () => {
  const r = compileExperimentDesign(deepMerge(diDDesign, { declaredCeiling: 'RANDOMIZED_CAUSAL' }));
  assert.equal(r.ok, true);
  assert.equal(r.claimCeiling, 'QUASI_CAUSAL');
  assert.ok(r.downgrades.some((d) => d.code === 'D_OVERCLAIM'), 'must record the overclaim');
});

test('NEGATIVE: every REFUSE case in the corpus refuses and yields no contract', () => {
  const refusals = ADVERSARIAL_CORPUS.filter((c) => c.expect === 'REFUSE');
  assert.ok(refusals.length >= 5, 'corpus must contain refusals');
  for (const c of refusals) {
    const r = compileExperimentDesign(deepMerge(VALID_RANDOMIZED_DESIGN, c.patch));
    assert.equal(r.status, 'REFUSED', `${c.id} ${c.name}`);
    assert.equal(r.ok, false, `${c.id} ${c.name}`);
    assert.equal(r.contract, null, `${c.id} ${c.name}`);
    assert.equal(r.identificationStatement, IDENTIFICATION_VOID, `${c.id} ${c.name}`);
  }
});

test('NEGATIVE: settlement may not claim above the design ceiling', () => {
  assert.equal(assertSettlementWithinCeiling('QUASI_CAUSAL', 'RANDOMIZED_CAUSAL').ok, false);
  assert.equal(assertSettlementWithinCeiling('QUASI_CAUSAL', 'QUASI_CAUSAL').ok, true);
  assert.equal(assertSettlementWithinCeiling('QUASI_CAUSAL', 'ASSOCIATIONAL').ok, true);
  assert.equal(assertSettlementWithinCeiling('DESCRIPTIVE_ONLY', 'CAUSAL_WITH_ASSUMPTIONS').ok, false);
});

// ---------------------------------------------------------------- COURT 3 — ADVERSARIAL

test('ADVERSARIAL: the full corpus (23 cases) is refused or downgraded with the named code', () => {
  const rows = runCorpus();
  assert.equal(rows.length, ADVERSARIAL_CORPUS.length);
  const failed = rows.filter((r) => !r.pass);
  assert.deepEqual(failed, [], 'corpus regressions:\n' + JSON.stringify(failed, null, 2));
});

test('ADVERSARIAL: downgraded designs never exceed their cap', () => {
  const capByCode = {
    D_NO_BASELINE: 'DESCRIPTIVE_ONLY',
    D_NO_COUNTERFACTUAL: 'DESCRIPTIVE_ONLY',
    D_POST_TREATMENT_METRIC_SELECTION: 'DESCRIPTIVE_ONLY',
    D_UNVERIFIED_EXPOSURE: 'DESCRIPTIVE_ONLY',
    D_SELF_REPORTED_EXPOSURE: 'DESCRIPTIVE_ONLY',
    D_INTERFERENCE_UNHANDLED: 'DESCRIPTIVE_ONLY',
    D_TREATMENT_LEAKAGE: 'ASSOCIATIONAL',
    D_OVERLAPPING_EXPERIMENTS: 'ASSOCIATIONAL',
    D_UNIT_MISMATCH: 'DESCRIPTIVE_ONLY',
    D_SURVIVORSHIP_BIAS: 'DESCRIPTIVE_ONLY',
    D_SELECTION_BIAS: 'DESCRIPTIVE_ONLY',
    D_CONCURRENT_CHANGE: 'QUASI_CAUSAL',
    D_SEASONALITY: 'QUASI_CAUSAL',
    D_REGRESSION_TO_MEAN: 'ASSOCIATIONAL',
    D_TRACKING_OUTAGE: 'DESCRIPTIVE_ONLY',
    D_P_HACKING: 'ASSOCIATIONAL',
    D_UNRECORDED_MUTATION: 'DESCRIPTIVE_ONLY',
    D_UNKNOWN_PROVENANCE: 'DESCRIPTIVE_ONLY',
  };
  for (const c of ADVERSARIAL_CORPUS.filter((x) => x.expect === 'DOWNGRADE')) {
    const r = compileExperimentDesign(deepMerge(VALID_RANDOMIZED_DESIGN, c.patch));
    const cap = capByCode[c.code];
    if (cap && r.claimCeiling) {
      assert.ok(
        CLAIM_CEILING_RANK[r.claimCeiling] <= CLAIM_CEILING_RANK[cap],
        `${c.id} ${c.name}: ceiling ${r.claimCeiling} exceeds cap ${cap}`,
      );
    }
  }
});

// ---------------------------------------------------------------- COURT 4 — INTEGRATION

test('INTEGRATION: the capability census admits causal-experiment-design as ONE canonical owner', () => {
  const owners = loadOwners();
  const owner = owners.find((o) => o.capability === 'causal-experiment-design');
  assert.ok(owner, 'causal-experiment-design must be registered');
  for (const p of owner.owner_paths) {
    assert.ok(fs.existsSync(path.join(ROOT, p)), `owner path must exist: ${p}`);
  }
});

test('INTEGRATION: the census now refuses a duplicate causal-design proposal and cites the owner', () => {
  const verdict = censusVerdict('compile a causal experiment design with identification requirements and a claim ceiling', loadOwners());
  assert.equal(verdict.verdict, 'REFUSED_DUPLICATE');
  assert.ok(verdict.collisions.some((c) => c.capability === 'causal-experiment-design'));
});

test('INTEGRATION: unrelated proposals remain CLEAR_TO_BUILD (no census over-blocking)', () => {
  const verdict = censusVerdict('render a 3d storefront walkthrough', loadOwners());
  assert.equal(verdict.verdict, 'CLEAR_TO_BUILD');
});

test('INTEGRATION: the verify gate still passes with the new registry entry (no regression)', () => {
  const gate = censusGateForVerify();
  assert.equal(gate.ok, true, 'census gate must stay green:\n' + JSON.stringify(gate.findings, null, 2));
});

test('INTEGRATION: effect-plane separation — the compiler imports no authority or donor module', () => {
  const src = fs.readFileSync(path.join(HERE, 'compiler.mjs'), 'utf8');
  const importLines = src.split('\n').filter((l) => /^\s*import\b/.test(l)).join('\n');
  assert.ok(!/tools\/authority/.test(importLines), 'compiler must not import the authority seat');
  assert.ok(!/tools\/mission-2/.test(importLines), 'compiler must not import the donor kernel');
});

// ---------------------------------------------------------------- COURT 5 — HOLDOUT

test('HOLDOUT: unit "OTHER" with an explicit spec compiles (unit is never implicit)', () => {
  const r = compileExperimentDesign(deepMerge(VALID_RANDOMIZED_DESIGN, { unit: { kind: 'OTHER', spec: 'one storefront section per merchant' } }));
  assert.equal(r.ok, true);
  assert.ok(r.claimCeiling);
});

test('HOLDOUT: material unhandled interference collapses to DESCRIPTIVE_ONLY', () => {
  const r = compileExperimentDesign(deepMerge(VALID_RANDOMIZED_DESIGN, { interference: { possible: true, handled: false, note: 'one merchant promo shifts demand from another' } }));
  assert.equal(r.claimCeiling, 'DESCRIPTIVE_ONLY');
  assert.ok(r.downgrades.some((d) => d.code === 'D_INTERFERENCE_UNHANDLED'));
});

test('HOLDOUT: an exploratory design compiles but is marked EXPLORATORY', () => {
  const r = compileExperimentDesign(deepMerge(VALID_RANDOMIZED_DESIGN, { power: { sample: null, required: null, declaredInference: 'EXPLORATORY' } }));
  assert.equal(r.status, 'EXPLORATORY');
});

// ---------------------------------------------------------------- COURT 6 — EVIDENCE REALM

test('REALM: every realm ranks strictly ascending', () => {
  let prev = -1;
  for (const realm of EVIDENCE_REALMS) {
    assert.ok(REALM_RANK[realm] > prev, realm);
    prev = REALM_RANK[realm];
  }
});

test('REALM: downgrades and same-realm restatements are allowed', () => {
  assert.equal(assertNoSilentUpgrade('PRODUCTION', 'SHADOW').ok, true);
  assert.equal(assertNoSilentUpgrade('REAL_OUTCOME', 'LOCAL').ok, true);
  assert.equal(assertNoSilentUpgrade('FIXTURE', 'FIXTURE').ok, true);
});

test('REALM: silent upgrades are refused', () => {
  assert.equal(assertNoSilentUpgrade('FIXTURE', 'INTEGRATION').ok, false);
  assert.equal(assertNoSilentUpgrade('SHADOW', 'PRODUCTION').ok, false);
  assert.equal(assertNoSilentUpgrade('LOCAL', 'REAL_OUTCOME').ok, false);
});

test('REALM: SYNTHETIC -> REAL_OUTCOME is forbidden even with non-real evidence', () => {
  const receipt = makeEvidenceReceipt({ claim: 'x', realm: 'PRODUCTION', source: 's', issuer: 'a', time: 't', digest: 'd' });
  assert.equal(assertNoSilentUpgrade('FIXTURE', 'REAL_OUTCOME', receipt).ok, false);
  assert.equal(assertNoSilentUpgrade('ADVERSARIAL', 'REAL_OUTCOME', receipt).ok, false);
});

test('REALM: an independent REAL_OUTCOME receipt permits a legitimate real-outcome claim', () => {
  const receipt = makeEvidenceReceipt({ claim: 'measured lift', realm: 'REAL_OUTCOME', source: 'production ledger', issuer: 'independent-evaluator', time: '2026-09-30T00:00:00Z', digest: 'abc' });
  assert.equal(assertNoSilentUpgrade('PRODUCTION', 'REAL_OUTCOME', receipt).ok, true);
});

test('REALM: SHADOW -> PRODUCTION requires real production evidence', () => {
  const shadowReceipt = makeEvidenceReceipt({ claim: 'x', realm: 'SHADOW', source: 's', issuer: 'a', time: 't', digest: 'd' });
  assert.equal(assertNoSilentUpgrade('SHADOW', 'PRODUCTION', shadowReceipt).ok, false);
  const prodReceipt = makeEvidenceReceipt({ claim: 'x', realm: 'PRODUCTION', source: 's', issuer: 'a', time: 't', digest: 'd' });
  assert.equal(assertNoSilentUpgrade('SHADOW', 'PRODUCTION', prodReceipt).ok, true);
});
