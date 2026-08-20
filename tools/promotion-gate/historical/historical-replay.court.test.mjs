/**
 * HISTORICAL REPLAY COURT — the two lanes of OWNER LAW #7.
 * ========================================================
 *
 * Lane A (V1 REPLAY). V1 (CANA_PROMOTION_IDENTITY_V1) must still behave EXACTLY as before in
 * its OWN historical context — a disposable, local-only reconstruction: a worktree on
 * integration/cana-technical-promotion-de4a497b (tip cc24b17) plus a LOCAL-ONLY ref
 * recover/competitive-ui-day-night -> c953ebcd. The recover/* ref is NEVER pushed (OWNER LAW
 * #8); the commit alone is sufficient provenance (out/RECOVER_REF_DISPOSITION.md).
 *
 * Lane B (V2 MUST NOT INHERIT V1's VERDICT). V2 (CANA_PROMOTION_IDENTITY_V2) must NOT accept
 * the historical de4a497b event merely because V1 did. The historical event carries V1's
 * schema/event type, so explicit dispatch never routes it to V2; and even forced through V2
 * the candidate lacks the successor anchors. V1 and V2 cannot both claim the same
 * promotion-event schema — dispatch is explicit and deterministic (tested here and in the V2
 * court).
 *
 * This court runs ONLY in the historical-replay lane (invoked explicitly by stage 06's
 * dispatch, and by `node --test` here). It is NOT a *.test.mjs blind-globbed against the
 * successor lane. When the mirror carrying the historical anchors is absent it reports the
 * fact honestly and does not fabricate a pass.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { replayV1, historicalContextAvailable, HISTORICAL } from './replay-v1.mjs';
import { dispatchEvaluator, evaluatePromotionIdentity, EVALUATOR_ID } from '../es-0002.mjs';

const MIRROR = process.env.CANA_SOURCE_MIRROR ?? '/agent/workspace/CANA.git';
const CONTEXT = historicalContextAvailable(MIRROR);

test('Lane A — V1 replays EXACTLY as before inside its disposable historical context', (t) => {
  if (!CONTEXT.available) {
    t.skip(`historical context not reconstructible here: ${CONTEXT.why} (mirror absent — not a V1 regression)`);
    return;
  }
  const r = replayV1({ mirror: MIRROR });
  assert.equal(r.classification, 'VERIFIED', `V1 did not reproduce its historical verdict: ${JSON.stringify(r.evidence)}`);
  assert.equal(r.ok, true);
  // byte-identity of the V1 evaluator is proven inside the replay (sha256 unchanged).
  assert.equal(r.detail.v1Sha256, HISTORICAL.v1Sha256);
  assert.equal(r.detail.branchName, HISTORICAL.integrationBranch);
});

test('Lane A — the recover/* ref is reconstructed LOCALLY and never pushed', (t) => {
  if (!CONTEXT.available) { t.skip('historical context not reconstructible here'); return; }
  const r = replayV1({ mirror: MIRROR });
  const localOnly = r.evidence.some((e) => /LOCAL-ONLY ref refs\/heads\/recover\/competitive-ui-day-night/.test(e) && /NEVER pushed/.test(e));
  assert.ok(localOnly, 'the recover ref must be reconstructed local-only and never pushed');
});

test('Lane B — dispatch routes the historical event to V1, NEVER to V2', () => {
  const disp = dispatchEvaluator({ promotion_schema_version: 1, promotion_event_type: 'technical-promotion-v1-historical' });
  assert.equal(disp.dispatched?.evaluator_id, 'CANA_PROMOTION_IDENTITY_V1');
  assert.equal(disp.dispatched?.lane, 'historical-replay');
  assert.notEqual(disp.dispatched?.evaluator_id, EVALUATOR_ID);
});

test('Lane B — V2 does NOT accept the historical de4a497b event, even forced through it', () => {
  // The historical candidate, dressed as if presented to V2. Two independent refusals:
  //  (1) dispatch: it is not a V2 event; (2) ancestry: de4a497b lacks the successor anchors.
  const historicalEvent = {
    promotion_schema_version: 1,
    promotion_event_type: 'technical-promotion-v1-historical',
    candidate_commit_sha: HISTORICAL.candidateCommit,
    candidate_tree_sha: '432cf8117f24a7401b29df4c403181dae8e7ec32',
    branch_evidence: HISTORICAL.integrationBranch,
  };
  const r = evaluatePromotionIdentity(historicalEvent, { mirror: MIRROR });
  assert.equal(r.accepted, false, 'V2 must NOT inherit V1s acceptance of the historical event');
  assert.ok(r.failed_checks.includes('dispatch.owned-by-v2'), 'V2 must refuse on dispatch');
  // Force the V2 schema/event onto the historical SHA: ancestry must STILL refuse it.
  const forced = { ...historicalEvent, promotion_schema_version: 2, promotion_event_type: 'successor-lane-promotion-v2' };
  const rf = evaluatePromotionIdentity(forced, { mirror: MIRROR });
  assert.equal(rf.accepted, false, 'even with the V2 event type, the historical SHA lacks the successor anchors');
  assert.ok(rf.failed_checks.some((c) => c.startsWith('ancestry.')), 'ancestry must refuse the historical SHA');
});

test('V1 and V2 cannot both claim the same promotion-event schema', () => {
  const v1 = dispatchEvaluator({ promotion_schema_version: 1, promotion_event_type: 'technical-promotion-v1-historical' });
  const v2 = dispatchEvaluator({ promotion_schema_version: 2, promotion_event_type: 'successor-lane-promotion-v2' });
  assert.equal(v1.dispatched?.evaluator_id, 'CANA_PROMOTION_IDENTITY_V1');
  assert.equal(v2.dispatched?.evaluator_id, EVALUATOR_ID);
  assert.notEqual(v1.dispatched?.promotion_schema_version, v2.dispatched?.promotion_schema_version);
});
