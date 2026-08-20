/**
 * ES-0002 FROZEN COURT — the successor-lane promotion evaluator, contested.
 * =========================================================================
 *
 * This court runs inside stage 06 (deterministic-courts) for the SUCCESSOR lineage. It is
 * the V2 replacement for the retired, relocated V1 promotion-receipt court. It:
 *
 *   1. FREEZE INTEGRITY — recomputes the freeze manifest from the on-disk judge + fixture +
 *      corpus + contract and asserts it equals the freeze recorded BEFORE the contest
 *      (OWNER LAW #5). Any post-hoc edit to the judge, corpus, or contract breaks this.
 *   2. POSITIVE — the correctly-bound successor candidate is ACCEPTED, with exactly the
 *      certified verdicts the frozen pass condition names, and branch is never authority.
 *   3. NEGATIVE — every one of the >=22 adversarial cases is REJECTED and its declared
 *      failing check actually fired.
 *   4. DISPATCH — V1 and V2 own DISJOINT (schema, event) pairs; dispatch is explicit and
 *      deterministic; a foreign (V1) event is never routed to V2.
 *   5. VERDICT HYGIENE — ES-0002 can never certify MERGED/CANONICAL/DEPLOYED/OWNER_APPROVED,
 *      and a PENDING owner gate is never laundered into APPROVED nor fails the court.
 *
 * Every assertion below is a REAL executed run of the evaluator over real git ancestry
 * (against the CANA source mirror when present, else the local repository's own object DB).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  EVALUATOR_ID,
  PROMOTION_SCHEMA_VERSION,
  V2_CONTRACT,
  CERTIFIABLE_VERDICTS,
  FORBIDDEN_VERDICTS,
  DISPATCH_TABLE,
  dispatchEvaluator,
  evaluatePromotionIdentity,
} from './es-0002.mjs';
import { ADVERSARIAL_CORPUS } from './fixtures/es-0002-adversarial-corpus.mjs';
import { computeFreeze, RECORDED_FREEZE_SHA } from './fixtures/es-0002-freeze.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const POSITIVE = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'es-0002-positive.json'), 'utf8'));

/**
 * Object database for the ancestry proofs. Prefer the CANA mirror; fall back to the local
 * repo when the mirror carries the candidate commit (the successor HEAD lives locally). The
 * court says nothing false: if neither database resolves the candidate it is a real failure.
 */
function objectDatabase() {
  const mirror = process.env.CANA_SOURCE_MIRROR ?? '/agent/workspace/CANA.git';
  const inMirror = fs.existsSync(mirror)
    && spawnSync('git', ['cat-file', '-e', `${POSITIVE.candidate_commit_sha}^{commit}`], { cwd: mirror }).status === 0;
  if (inMirror) return mirror;
  // local repo already contains HEAD and all anchors on the successor lane.
  return null;
}
const MIRROR = objectDatabase();
const evalOpts = { mirror: MIRROR };

test('ES-0002 identity: evaluator id, schema version and disjoint event ownership', () => {
  assert.equal(EVALUATOR_ID, 'CANA_PROMOTION_IDENTITY_V2');
  assert.equal(PROMOTION_SCHEMA_VERSION, 2);
  assert.equal(V2_CONTRACT.promotion_event_type, 'successor-lane-promotion-v2');
  const v1 = DISPATCH_TABLE.find((e) => e.evaluator_id === 'CANA_PROMOTION_IDENTITY_V1');
  const v2 = DISPATCH_TABLE.find((e) => e.evaluator_id === EVALUATOR_ID);
  assert.ok(v1 && v2, 'both evaluators must be in the dispatch table');
  assert.notEqual(v1.promotion_event_type, v2.promotion_event_type, 'V1 and V2 must own DISJOINT event types');
  assert.notEqual(v1.promotion_schema_version, v2.promotion_schema_version, 'V1 and V2 must own DISJOINT schema versions');
});

test('FREEZE BEFORE CONTEST: the on-disk judge+fixture+corpus+contract match the recorded freeze', () => {
  const freeze = computeFreeze();
  assert.equal(
    freeze.freeze_sha256,
    RECORDED_FREEZE_SHA,
    'the frozen artifacts changed after the freeze — no post-hoc edits are allowed (OWNER LAW #5)',
  );
  // the positive fixture pins the frozen judge + corpus by hash, so a swapped judge is caught
  // both by the freeze and by the candidate's own evidence.
  assert.equal(POSITIVE.evidence.judge_source_sha256, freeze.components['judge:es-0002.mjs']);
  assert.equal(POSITIVE.evidence.corpus_sha256, freeze.components['corpus:es-0002-adversarial-corpus.mjs']);
});

test('POSITIVE: the correctly-bound successor candidate is ACCEPTED by proven git identity', () => {
  const r = evaluatePromotionIdentity(POSITIVE, evalOpts);
  assert.equal(r.accepted, true, `positive candidate was refused: ${JSON.stringify(r.failed_checks)}`);
  assert.equal(r.identity_valid, true);
  assert.equal(r.evidence_complete, true);
  assert.equal(r.canonical_pr_eligible, true);
  for (const v of ['PROMOTION_IDENTITY_VALID', 'PROMOTION_EVIDENCE_COMPLETE', 'CANONICAL_PR_ELIGIBLE']) {
    assert.ok(r.certified_verdicts.includes(v), `missing verdict ${v}`);
  }
  assert.equal(r.technical_promotion_evidence, 'VERIFIED');
  assert.equal(r.owner_promotion_gate, 'PENDING');
});

test('BRANCH NAME IS NEVER AUTHORITY: identity holds under any branch label', () => {
  const r = evaluatePromotionIdentity(POSITIVE, evalOpts);
  assert.equal(r.branch_name_used_as_authority, false);
  // Re-run with a spoofed / renamed / moved branch label but the SAME candidate SHA:
  // the verdict must be byte-for-byte identical, because bytes did not change.
  for (const label of ['main', 'totally-different', 'integration/cana-technical-promotion-de4a497b', '']) {
    const spoofed = { ...POSITIVE, branch_evidence: label };
    const rr = evaluatePromotionIdentity(spoofed, evalOpts);
    assert.equal(rr.accepted, true, `a mere branch relabel to "${label}" changed the verdict — branch was used as authority`);
    assert.deepEqual(rr.certified_verdicts, r.certified_verdicts);
  }
});

test('NEGATIVE CORPUS: at least 22 adversarial cases, each REJECTED with its declared check firing', () => {
  assert.ok(ADVERSARIAL_CORPUS.length >= 22, `corpus has only ${ADVERSARIAL_CORPUS.length} cases; owner requires >= 22`);
  const seen = new Set();
  for (const cs of ADVERSARIAL_CORPUS) {
    assert.ok(!seen.has(cs.id), `duplicate corpus id ${cs.id}`);
    seen.add(cs.id);
    const r = evaluatePromotionIdentity(cs.candidate, evalOpts);
    assert.equal(r.accepted, false, `adversarial case ${cs.id} was ACCEPTED — it must be rejected`);
    assert.ok(
      r.failed_checks.includes(cs.expect_reject_check),
      `case ${cs.id}: expected check ${cs.expect_reject_check} to fire; got ${JSON.stringify(r.failed_checks)}`,
    );
  }
});

test('DISPATCH is explicit and deterministic — a foreign V1 event is never routed to V2', () => {
  // the V2 event routes to V2:
  const v2 = dispatchEvaluator({ promotion_schema_version: 2, promotion_event_type: 'successor-lane-promotion-v2' });
  assert.equal(v2.dispatched?.evaluator_id, EVALUATOR_ID);
  // the V1 historical event routes to V1's historical-replay lane, NOT V2:
  const v1 = dispatchEvaluator({ promotion_schema_version: 1, promotion_event_type: 'technical-promotion-v1-historical' });
  assert.equal(v1.dispatched?.evaluator_id, 'CANA_PROMOTION_IDENTITY_V1');
  assert.equal(v1.dispatched?.lane, 'historical-replay');
  // an unknown event routes NOWHERE (fail closed, never to a default judge):
  const none = dispatchEvaluator({ promotion_schema_version: 9, promotion_event_type: 'whatever' });
  assert.equal(none.dispatched, null);
  // ES-0002 refuses to judge an event it does not own, even if all other evidence is perfect:
  const foreign = { ...POSITIVE, promotion_schema_version: 1, promotion_event_type: 'technical-promotion-v1-historical' };
  const r = evaluatePromotionIdentity(foreign, evalOpts);
  assert.equal(r.accepted, false);
  assert.ok(r.failed_checks.includes('dispatch.owned-by-v2'));
});

test('VERDICT HYGIENE: ES-0002 can never certify MERGED/CANONICAL/DEPLOYED/OWNER_APPROVED', () => {
  for (const forbidden of FORBIDDEN_VERDICTS) {
    assert.ok(!CERTIFIABLE_VERDICTS.includes(forbidden), `${forbidden} must not be certifiable`);
  }
  // even the accepted positive candidate certifies ONLY the three lawful verdicts:
  const r = evaluatePromotionIdentity(POSITIVE, evalOpts);
  for (const v of r.certified_verdicts) {
    assert.ok(CERTIFIABLE_VERDICTS.includes(v), `certified an out-of-vocabulary verdict: ${v}`);
    assert.ok(!FORBIDDEN_VERDICTS.includes(v));
  }
});

test('OWNER GATE PENDING is not laundered and does not fail the mechanism court', () => {
  // PENDING (the positive): accepted, technical VERIFIED, gate PENDING.
  const pending = evaluatePromotionIdentity(POSITIVE, evalOpts);
  assert.equal(pending.accepted, true);
  assert.equal(pending.technical_promotion_evidence, 'VERIFIED');
  assert.equal(pending.owner_promotion_gate, 'PENDING');
  // APPROVED laundering (adversarial case 22): rejected, never accepted.
  const laundered = { ...POSITIVE, owner_gate: { state: 'APPROVED', claimed_owner_approved: true } };
  const r = evaluatePromotionIdentity(laundered, evalOpts);
  assert.equal(r.accepted, false);
  assert.ok(r.failed_checks.includes('owner-gate.pending-not-laundered'));
});
