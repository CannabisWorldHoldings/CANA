// GATE E court — evaluator succession shape law, the measured ES-0001 case,
// and the census-gate enforcement wiring.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeEvaluatorSuccessionCase } from './evaluators.mjs';
import { censusVerdict, loadOwners, foldV2, currentEvaluatorVersion } from './capability-census.mjs';
import { buildES0001, runBridge, runHidden } from './es-0001.mjs';
import { censusGateForVerify } from './census-gate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------- shape law */
const okCase = (over = {}) => ({
  scope: 's',
  incumbent: { evaluator_id: 'v1' }, candidate: { evaluator_id: 'v2' },
  candidateAuthor: 'lane-implementation', adjudicator: 'lane-verification',
  reason: 'r',
  demonstratedDefects: [{ probe: 'p', incumbentVerdict: 'CLEAR_TO_BUILD', correctVerdict: 'REFUSED_DUPLICATE' }],
  promotionCriteria: ['P1'], criteriaFixedBeforeCandidate: true,
  bridgeCorpus: ['b1'], bridgeResults: [{ case: 'b1', agree: true }],
  hiddenHoldout: ['h1'], holdoutResults: [{ case: 'h1', incumbentCorrect: false, candidateCorrect: true }],
  mutationTest: { description: 'd', pass: true },
  reversibility: 'registry flip', verdict: 'SUCCEED',
  ...over,
});

test('self-certification is structurally refused', () => {
  assert.equal(makeEvaluatorSuccessionCase(okCase()).valid, true);
  const selfJudge = makeEvaluatorSuccessionCase(okCase({ adjudicator: 'v2' }));
  assert.equal(selfJudge.valid, false);
  assert.ok(selfJudge.errors.some((e) => e.includes('SELF-CERTIFICATION')));
  const authorJudge = makeEvaluatorSuccessionCase(okCase({ adjudicator: 'lane-implementation' }));
  assert.equal(authorJudge.valid, false);
});

test('criteria minted after the candidate, missing bridge, or missing holdout invalidate the case', () => {
  assert.equal(makeEvaluatorSuccessionCase(okCase({ criteriaFixedBeforeCandidate: false })).valid, false);
  assert.equal(makeEvaluatorSuccessionCase(okCase({ bridgeCorpus: [] })).valid, false);
  assert.equal(makeEvaluatorSuccessionCase(okCase({ hiddenHoldout: [] })).valid, false);
  assert.equal(makeEvaluatorSuccessionCase(okCase({ mutationTest: { description: 'd', pass: false } })).valid, false);
});

test('SUCCEED with a bridge regression or without correcting the incumbent is impossible', () => {
  const regressed = makeEvaluatorSuccessionCase(okCase({ bridgeResults: [{ case: 'b1', agree: false }] }));
  assert.equal(regressed.valid, false);
  const pointless = makeEvaluatorSuccessionCase(okCase({ holdoutResults: [{ case: 'h1', incumbentCorrect: true, candidateCorrect: true }] }));
  assert.equal(pointless.valid, false, 'no reason to succeed when the incumbent was never wrong');
  // RETAIN_INCUMBENT with those same results is perfectly valid — both verdicts are acceptable outcomes
  const retained = makeEvaluatorSuccessionCase(okCase({ verdict: 'RETAIN_INCUMBENT', holdoutResults: [{ case: 'h1', incumbentCorrect: true, candidateCorrect: true }] }));
  assert.equal(retained.valid, true);
});

/* ------------------------------------------------- ES-0001 (real, measured) */
test('the incumbent defect is real: v1 clears all three morphological evasions; v2 refuses them', () => {
  const owners = loadOwners();
  const hidden = runHidden(owners);
  const evasions = hidden.filter((h) => h.case.startsWith('S1') || h.case.startsWith('S2') || h.case.startsWith('S3'));
  for (const e of evasions) {
    assert.equal(e.v1, 'CLEAR_TO_BUILD', `${e.case}: v1 must exhibit the defect`);
    assert.equal(e.v2, 'REFUSED_DUPLICATE', `${e.case}: v2 must correct it`);
  }
});

test('v2 introduces zero false refusals on genuinely-new capabilities', () => {
  const clears = runHidden().filter((h) => h.correct === 'CLEAR_TO_BUILD');
  assert.ok(clears.length >= 3);
  for (const c of clears) assert.equal(c.v2, 'CLEAR_TO_BUILD', `${c.case}: v2 over-triggers`);
});

test('bridge corpus: v2 reproduces every EC-0001 verdict (no historical regression)', () => {
  for (const b of runBridge()) assert.equal(b.agree, true, `${b.case}: v1=${b.v1} v2=${b.v2} expected=${b.expected}`);
});

test('ES-0001 builds valid with verdict SUCCEED, and the committed record matches a fresh rebuild', () => {
  const es = buildES0001();
  assert.equal(es.valid, true, JSON.stringify(es.errors));
  assert.equal(es.verdict, 'SUCCEED');
  const file = path.join(HERE, '..', '..', '_mission', 'evolution', 'ES-0001-census-term-matching.json');
  assert.ok(fs.existsSync(file), 'committed succession record exists');
  const committed = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(committed.case_id, es.case_id);
  assert.equal(committed.verdict, es.verdict);
  assert.deepEqual(committed.bridge_results, es.bridge_results);
  assert.deepEqual(committed.holdout_results, es.holdout_results);
});

test('the registry crowns v2 as INCUMBENT with v1 RETIRED but forensically replayable', () => {
  assert.equal(currentEvaluatorVersion(), 'v2');
  const reg = JSON.parse(fs.readFileSync(path.join(HERE, 'evaluator-registry.json'), 'utf8'));
  const v1 = reg.evaluators.find((e) => e.evaluator_id === 'census-term-v1');
  assert.equal(v1.status, 'RETIRED');
  assert.ok(v1.known_blind_spots.length > 0);
  // v1 remains executable for forensic replay
  const owners = loadOwners();
  assert.equal(censusVerdict('shadowing competitors and fingerprinting page snapshots', owners, { version: 'v1' }).verdict, 'CLEAR_TO_BUILD');
});

test('fold law is conservative: short words and -ss words are untouched', () => {
  assert.equal(foldV2('map'), 'map');
  assert.equal(foldV2('mass'), 'mass');
  assert.equal(foldV2('pages'), 'page');
  assert.equal(foldV2('monitoring'), 'monitor');
  assert.equal(foldV2('policies'), 'policy');
});

/* ------------------------------------------------- enforcement wiring court */
test('census gate for verify: registry integrity + holdout replay + declaration court all green here', () => {
  const gate = censusGateForVerify();
  assert.equal(gate.ok, true, JSON.stringify(gate.findings));
  assert.deepEqual(gate.findings.map((f) => f.check), ['registry_integrity', 'holdout_replay', 'declaration_court']);
});
