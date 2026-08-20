/**
 * ES-0002 ADVERSARIAL CORPUS — the 22 owner-listed rejection cases.
 * =================================================================
 *
 * Each case is a deep clone of the positive fixture with exactly one lawful-looking
 * corruption. The frozen court runs ES-0002 over EVERY case and asserts it is REJECTED
 * (accepted === false), and that the specific failing check(s) it names actually fired.
 * Corpus is frozen before the candidate runs (its sha256 is recorded in the freeze).
 *
 * Note the two branch-name cases (ref moved post-receipt / branch renamed-or-spoofed):
 * V2 authorizes by SHA, so a moved/renamed branch changes NO bytes and must NOT flip a
 * valid candidate. Those two cases prove REJECTION by pairing the branch mutation with the
 * only thing that legitimately changes identity — a wrong candidate SHA — because a
 * branch move that leaves the SHA intact is (correctly) a NON-EVENT for authorization.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const POSITIVE = JSON.parse(fs.readFileSync(path.join(HERE, 'es-0002-positive.json'), 'utf8'));

const clone = () => JSON.parse(JSON.stringify(POSITIVE));
const WRONG_SHA = 'de4a497b6c039a5dccc9c3fb9a470dc0bf610318'; // a real commit, wrong candidate
const WRONG_TREE = 'f7c56f6dad3875ccba10dfadbd2d953baf5c1509'; // a real tree, not the candidate's
const BOGUS64 = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef0';

export const ADVERSARIAL_CORPUS = [
  // 1. correct branch name / wrong SHA — identity is by SHA; a spoofed name never rescues it.
  (() => { const c = clone(); c.branch_evidence = 'hyperagent/cana-sovereign-successor'; c.candidate_commit_sha = WRONG_SHA; c.candidate_tree_sha = WRONG_TREE; return { id: '01-correct-branch-wrong-sha', expect_reject_check: 'identity.candidate-tree-matches', candidate: c }; })(),

  // 2. correct label / wrong tree — declared tree does not match the commit's real tree.
  (() => { const c = clone(); c.candidate_tree_sha = WRONG_TREE; return { id: '02-correct-label-wrong-tree', expect_reject_check: 'identity.candidate-tree-matches', candidate: c }; })(),

  // 3. SHA with missing ancestry — a real commit (canonical_base) that does NOT descend from
  //    POST38/Federation. Tree is declared correctly so ANCESTRY is the failing check.
  (() => { const c = clone(); c.candidate_commit_sha = '3a340f3a4c2ab28a5b85bb1a91845932b74c8b05'; c.candidate_tree_sha = '4ddb3ab651f56801172e81b622e9366fb8ee75f3'; return { id: '03-sha-missing-ancestry', expect_reject_check: 'ancestry.POST38_HEAD-is-ancestor', candidate: c }; })(),

  // 4. POST38 omitted — a commit before POST38 landed (canonical_base has no POST38 ancestry).
  (() => { const c = clone(); c.candidate_commit_sha = '3a340f3a4c2ab28a5b85bb1a91845932b74c8b05'; c.candidate_tree_sha = '4ddb3ab651f56801172e81b622e9366fb8ee75f3'; return { id: '04-post38-omitted', expect_reject_check: 'ancestry.POST38_HEAD-is-ancestor', candidate: c }; })(),

  // 5. Federation omitted — a POST38-only commit (190c990) has no Federation ancestry.
  (() => { const c = clone(); c.candidate_commit_sha = '190c99077b81142b7a67e127f39ec8d9c59fc554'; c.candidate_tree_sha = 'c792bd879cb072d6483ec91d253f1fe566b41f05'; return { id: '05-federation-omitted', expect_reject_check: 'ancestry.FEDERATION_HEAD-is-ancestor', candidate: c }; })(),

  // 6. wrong merge parent — the sibling merge is frozen with parents [POST38, Federation]; a
  //    candidate whose history does not contain that exact merge (canonical_base predates it)
  //    fails the sibling-merge ancestry with-correct-parents check.
  (() => { const c = clone(); c.candidate_commit_sha = '3a340f3a4c2ab28a5b85bb1a91845932b74c8b05'; c.candidate_tree_sha = '4ddb3ab651f56801172e81b622e9366fb8ee75f3'; return { id: '06-wrong-merge-parent', expect_reject_check: 'ancestry.sibling-merge-is-ancestor', candidate: c }; })(),

  // 7. ref moved post-receipt — branch evidence points elsewhere AND the SHA no longer matches
  //    (a ref move that changes the underlying commit). SHA governs; rejected on identity.
  (() => { const c = clone(); c.branch_evidence = 'hyperagent/cana-sovereign-successor@moved'; c.candidate_commit_sha = WRONG_SHA; c.candidate_tree_sha = WRONG_TREE; return { id: '07-ref-moved-post-receipt', expect_reject_check: 'identity.candidate-tree-matches', candidate: c }; })(),

  // 8. branch renamed / spoofed — a spoofed branch label with a wrong SHA. The rename is a
  //    non-event; the wrong SHA is the disqualifier.
  (() => { const c = clone(); c.branch_evidence = 'main'; c.candidate_commit_sha = WRONG_SHA; c.candidate_tree_sha = WRONG_TREE; return { id: '08-branch-renamed-spoofed', expect_reject_check: 'identity.candidate-tree-matches', candidate: c }; })(),

  // 9. tampered manifest digest — declare a wrong ownership canonical-json sha via the fixture
  //    would not reach the check (the check reads the file on disk), so tamper the EXPECTED by
  //    corrupting the candidate's claimed evidence path is not enough — instead assert the file
  //    check fails by having the candidate carry a manifest override that does not match. We
  //    simulate a tampered manifest by pointing evaluator at a bad canonical sha through the
  //    contract? The contract is frozen. So this case corrupts the on-disk expectation via a
  //    per-case manifest override consumed by the court (see court harness: manifest_override).
  (() => { const c = clone(); c.manifest_override_canonical_sha256 = BOGUS64; return { id: '09-tampered-manifest-digest', expect_reject_check: 'evidence.ownership-manifest-digest', candidate: c }; })(),

  // 10. missing conservation proof.
  (() => { const c = clone(); delete c.evidence.conservation; return { id: '10-missing-conservation-proof', expect_reject_check: 'evidence.capability-conservation-35-35', candidate: c }; })(),

  // 11. capability loss > 0.
  (() => { const c = clone(); c.evidence.conservation = { required: 35, verified: 34, loss: 1 }; return { id: '11-capability-loss-gt-0', expect_reject_check: 'evidence.capability-conservation-35-35', candidate: c }; })(),

  // 12. authority court not green.
  (() => { const c = clone(); c.evidence.authority_court = { green: false }; return { id: '12-authority-court-not-green', expect_reject_check: 'evidence.authority-court-green', candidate: c }; })(),

  // 13. more than one accepted authorize() producer.
  (() => { const c = clone(); c.evidence.single_authorize_seat = { count: 2 }; return { id: '13-multiple-authorize-seats', expect_reject_check: 'evidence.single-authorize-seat', candidate: c }; })(),

  // 14. Hermes failure.
  (() => { const c = clone(); c.evidence.hermes_boundary = { pass: false }; return { id: '14-hermes-failure', expect_reject_check: 'evidence.hermes-boundary', candidate: c }; })(),

  // 15. stale / tampered CI receipt.
  (() => { const c = clone(); c.evidence.sovereign_ci_run.receipt_sha256 = BOGUS64; return { id: '15-stale-tampered-ci-receipt', expect_reject_check: 'evidence.sovereign-ci-run-receipt-bound', candidate: c }; })(),

  // 16. wrong workflow / check identity.
  (() => { const c = clone(); c.evidence.sovereign_ci_workflow.job_name = 'some other job'; return { id: '16-wrong-workflow-check-identity', expect_reject_check: 'evidence.sovereign-ci-workflow-identity', candidate: c }; })(),

  // 17. missing stage.
  (() => { const c = clone(); delete c.evidence.required_stage_results['reconstruction']; return { id: '17-missing-stage', expect_reject_check: 'evidence.required-stages-verified', candidate: c }; })(),

  // 18. REFUSED stage.
  (() => { const c = clone(); c.evidence.required_stage_results['authority-court'] = 'REFUSED'; return { id: '18-refused-stage', expect_reject_check: 'evidence.required-stages-verified', candidate: c }; })(),

  // 19. evaluator source changed post-freeze — a wrong judge_source_sha256.
  (() => { const c = clone(); c.evidence.judge_source_sha256 = 'not-a-hash'; return { id: '19-evaluator-source-changed-post-freeze', expect_reject_check: 'evidence.judge-corpus-hashes', candidate: c }; })(),

  // 20. corpus changed post-freeze — a wrong corpus_sha256 (non-hex).
  (() => { const c = clone(); c.evidence.corpus_sha256 = 'tampered'; return { id: '20-corpus-changed-post-freeze', expect_reject_check: 'evidence.judge-corpus-hashes', candidate: c }; })(),

  // 21. replayed foreign promotion receipt — the historical V1 event replayed against V2.
  //     Wrong schema/event: dispatch does not route it to V2, and its historical candidate SHA
  //     lacks the successor anchors. Rejected at dispatch AND ancestry.
  (() => { const c = clone(); c.promotion_schema_version = 1; c.promotion_event_type = 'technical-promotion-v1-historical'; c.candidate_commit_sha = 'de4a497b6c039a5dccc9c3fb9a470dc0bf610318'; c.candidate_tree_sha = '432cf8117f24a7401b29df4c403181dae8e7ec32'; return { id: '21-replayed-foreign-promotion-receipt', expect_reject_check: 'dispatch.owned-by-v2', candidate: c }; })(),

  // 22. owner-gate artifact wrong action / scope / nonce — owner gate laundered to APPROVED.
  (() => { const c = clone(); c.owner_gate = { state: 'APPROVED', claimed_owner_approved: true }; return { id: '22-owner-gate-wrong-action-scope-nonce', expect_reject_check: 'owner-gate.pending-not-laundered', candidate: c }; })(),
];

export const CORPUS_IDS = ADVERSARIAL_CORPUS.map((c) => c.id);
