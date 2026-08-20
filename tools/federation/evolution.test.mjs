// GATE D court — EvolutionCase shape law, the live census holdout, and the
// real EC-0001 case (sentinel duplication) judged end-to-end.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeEvolutionCase, MUTATION_SURFACES } from './evolution.mjs';
import { censusVerdict, loadOwners } from './capability-census.mjs';
import { HOLDOUT, runHoldout, buildEC0001 } from './ec-0001.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------ shape law */
const minimalValid = (over = {}) => ({
  mission: 'm', observedFailure: 'f',
  diagnoses: [{ id: 'a', hypothesis: 'h1', evidence: 'e1' }, { id: 'b', hypothesis: 'h2', evidence: 'e2' }],
  selectedSurface: 'L4_WORKFLOW_POLICY_CODE', surfaceSelectionReason: 'lowest sufficient',
  candidateMutations: [{ id: 'c1', change: 'x', rollback: 'r' }, { id: 'c2', change: 'y', rollback: 'r' }],
  mutationAuthor: 'lane-implementation',
  evaluator: { ref: 'court', owner: 'lane-verification', declared_before_candidates: true },
  holdout: ['h1'], baseline: 'b', rollbackTarget: 'sha',
  ...over,
});

test('a single diagnosis, a missing holdout, or a missing rollback invalidates the case', () => {
  assert.equal(makeEvolutionCase(minimalValid()).valid, true);
  assert.equal(makeEvolutionCase(minimalValid({ diagnoses: [{ id: 'a', hypothesis: 'h', evidence: 'e' }] })).valid, false);
  assert.equal(makeEvolutionCase(minimalValid({ holdout: [] })).valid, false);
  assert.equal(makeEvolutionCase(minimalValid({ rollbackTarget: '' })).valid, false);
});

test('GENERATOR ≠ JUDGE: an evaluator owned by the mutation author is refused', () => {
  const c = makeEvolutionCase(minimalValid({ evaluator: { ref: 'court', owner: 'lane-implementation', declared_before_candidates: true } }));
  assert.equal(c.valid, false);
  assert.ok(c.errors.some((e) => e.includes('GENERATOR ≠ JUDGE')));
  const late = makeEvolutionCase(minimalValid({ evaluator: { ref: 'court', owner: 'lane-verification', declared_before_candidates: false } }));
  assert.equal(late.valid, false, 'a judge minted after the contestants is not independent');
});

test('PROMOTE without full holdout passage or mechanism attribution is impossible', () => {
  const noHoldout = makeEvolutionCase(minimalValid({ verdict: 'PROMOTE', promotedCandidate: 'c1', mechanismAttribution: 'why' }));
  assert.equal(noHoldout.valid, false, 'no holdoutResults');
  const failedHoldout = makeEvolutionCase(minimalValid({
    verdict: 'PROMOTE', promotedCandidate: 'c1', mechanismAttribution: 'why',
    holdoutResults: [{ case: 'h1', pass: true }, { case: 'h2', pass: false }],
  }));
  assert.equal(failedHoldout.valid, false, 'a failed holdout cannot promote');
  const noWhy = makeEvolutionCase(minimalValid({ verdict: 'PROMOTE', promotedCandidate: 'c1', holdoutResults: [{ case: 'h1', pass: true }] }));
  assert.equal(noWhy.valid, false, 'promotion without attribution is a lucky guess');
});

test('the mutation ladder is ordered most-reversible-first (§18)', () => {
  assert.equal(MUTATION_SURFACES[0], 'L0_TASK_STATE');
  assert.equal(MUTATION_SURFACES[6], 'L6_WEIGHTS');
  assert.equal(MUTATION_SURFACES.length, 9);
});

/* --------------------------------------------------- census (the mutation) */
test('census fails closed: missing or empty owners registry refuses to run', () => {
  assert.throws(() => loadOwners('/nonexistent/owners.json'));
});

test('census holdout: all six cases pass, including the historical replay of the real failure', () => {
  const results = runHoldout();
  for (const r of results) assert.equal(r.pass, true, `${r.case}: expected ${r.expected}, observed ${r.observed} (collisions: ${r.collisions})`);
  // the historical replay must cite the true owner
  const h1 = censusVerdict(HOLDOUT[0].proposal, loadOwners());
  assert.ok(h1.collisions.some((c) => c.capability === 'competitor-shadowing'));
  assert.ok(h1.collisions[0].owner_paths.includes('apps/web/scripts/competitor-shadow.mjs'));
});

test('census cites owner paths that actually exist in this tree (registry is not fiction)', () => {
  const owners = loadOwners();
  const repoRoot = path.resolve(HERE, '..', '..');
  for (const o of owners) {
    assert.ok(o.owner_paths.some((p) => fs.existsSync(path.join(repoRoot, p))), `capability ${o.capability}: no owner path exists on disk`);
  }
});

/* --------------------------------------------------------- EC-0001 (real) */
test('EC-0001 builds valid, PROMOTEs C2 on a fully-passing measured holdout, and preserves negative evidence', () => {
  const holdoutResults = runHoldout(); // measured live, not asserted
  const ec = buildEC0001({ holdoutResults });
  assert.equal(ec.valid, true, JSON.stringify(ec.errors));
  assert.equal(ec.verdict, 'PROMOTE');
  assert.equal(ec.promoted_candidate, 'C2-census-court');
  assert.equal(ec.holdout_results.length, 6);
  assert.ok(ec.holdout_results.every((h) => h.pass));
  assert.equal(ec.diagnoses.length, 3, 'competing diagnoses preserved');
  assert.ok(ec.negative_evidence.length > 0, 'the rejected candidate is remembered, not erased');
  assert.equal(ec.selected_surface, 'L4_WORKFLOW_POLICY_CODE');
});

test('EC-0001 committed record matches a fresh rebuild (no drift between record and code)', () => {
  const file = path.join(HERE, '..', '..', '_mission', 'evolution', 'EC-0001-sentinel-duplication.json');
  assert.ok(fs.existsSync(file), 'committed case record exists');
  const committed = JSON.parse(fs.readFileSync(file, 'utf8'));
  const fresh = buildEC0001({ holdoutResults: runHoldout() });
  assert.equal(committed.case_id, fresh.case_id);
  assert.equal(committed.verdict, fresh.verdict);
  assert.equal(committed.promoted_candidate, fresh.promoted_candidate);
  assert.deepEqual(committed.holdout_results, fresh.holdout_results, 'measured holdout is reproducible');
  assert.equal(committed.valid, true);
});
