/**
 * ES-0003 fail-closed manifest-lineage succession court.
 *
 * The court and all public criteria in fixtures/es-0003-* were frozen before the V3 candidate
 * existed. The hidden holdout is deliberately separate and is authored only after the candidate
 * source is sealed.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { makeEvaluatorSuccessionCase } from '../federation/evaluators.mjs';
import {
  EVALUATOR_ID,
  PROMOTION_SCHEMA_VERSION,
  V3_CONTRACT,
  CERTIFIABLE_VERDICTS,
  FORBIDDEN_VERDICTS,
  DISPATCH_TABLE,
  dispatchEvaluator,
  assessManifestSuccession,
  collectManifestSuccessionEvidence,
  evaluateManifestSuccession,
} from './es-0003.mjs';
import { replayFrozenEs0002 } from './es-0002-frozen-replay.mjs';
import {
  ADVERSARIAL_CORPUS,
  materializeCase,
} from './fixtures/es-0003-adversarial-corpus.mjs';
import {
  APPROVED_SUCCESSION_PAYLOAD_SHA256,
  EVIDENCE_SCHEMA,
  EVENT_SCHEMA,
  MUTATION_IDS,
  PROMOTION_CRITERIA,
  RECORDED_PRE_CANDIDATE_FREEZE_SHA,
  computePreCandidateFreeze,
} from './fixtures/es-0003-freeze.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const POSITIVE = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'es-0003-positive.json'), 'utf8'));
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

function git(args) {
  const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
  return { ok: !result.error && result.status === 0, stdout: (result.stdout ?? '').trim(), stderr: (result.stderr ?? '').trim() };
}

function summary(output) {
  const value = (name) => Number(new RegExp(`^# ${name} (\\d+)$`, 'm').exec(output)?.[1] ?? -1);
  return { tests: value('tests'), pass: value('pass'), fail: value('fail'), skipped: value('skipped') };
}

function historicalMirror() {
  const configured = process.env.CANA_SOURCE_MIRROR;
  if (configured && fs.existsSync(configured)) return configured;
  return ROOT;
}

test('PRE-CANDIDATE FREEZE: criteria, fixtures, corpus, mutation plan and court are byte-bound', () => {
  const freeze = computePreCandidateFreeze();
  assert.equal(freeze.freeze_sha256, RECORDED_PRE_CANDIDATE_FREEZE_SHA);
  assert.equal(PROMOTION_CRITERIA.length, 20);
  assert.equal(MUTATION_IDS.length, 12);
  assert.equal(ADVERSARIAL_CORPUS.length, 32);
  assert.equal(APPROVED_SUCCESSION_PAYLOAD_SHA256, '9650b9555d573a046540b56d06b6d2f362ec4384692092b474bfc94a489df23e');
});

test('V1/V2/V3 dispatch is explicit, disjoint and branch names are never authority', () => {
  assert.equal(EVALUATOR_ID, EVENT_SCHEMA.evaluator_id);
  assert.equal(PROMOTION_SCHEMA_VERSION, EVENT_SCHEMA.promotion_schema_version);
  assert.equal(V3_CONTRACT.promotion_event_type, EVENT_SCHEMA.promotion_event_type);
  assert.equal(V3_CONTRACT.branch_name_used_as_authority, false);
  assert.equal(DISPATCH_TABLE.length, 3);
  const identities = DISPATCH_TABLE.map((entry) => `${entry.promotion_schema_version}:${entry.promotion_event_type}`);
  assert.equal(new Set(identities).size, 3);
  assert.equal(dispatchEvaluator({ promotion_schema_version: 1, promotion_event_type: 'technical-promotion-v1-historical' }).dispatched?.evaluator_id, 'CANA_PROMOTION_IDENTITY_V1');
  assert.equal(dispatchEvaluator({ promotion_schema_version: 2, promotion_event_type: 'successor-lane-promotion-v2' }).dispatched?.evaluator_id, 'CANA_PROMOTION_IDENTITY_V2');
  assert.equal(dispatchEvaluator(EVENT_SCHEMA).dispatched?.evaluator_id, EVALUATOR_ID);
  assert.equal(dispatchEvaluator({ promotion_schema_version: 99, promotion_event_type: 'future' }).dispatched, null);
});

test('POSITIVE: only the exact approved PR57 manifest lineage is technically eligible', () => {
  const result = evaluateManifestSuccession(POSITIVE);
  assert.equal(result.accepted, true, JSON.stringify(result.failed_checks));
  assert.equal(result.technical_promotion_evidence, 'VERIFIED');
  assert.equal(result.owner_promotion_gate, 'PENDING');
  assert.equal(result.branch_name_used_as_authority, false);
  assert.deepEqual(result.checks.map((check) => check.id), EVIDENCE_SCHEMA);
  assert.deepEqual(result.certified_verdicts, CERTIFIABLE_VERDICTS);
});

test('BRANCH RELABEL INVARIANCE: identical commits and bytes always receive identical verdicts', () => {
  const baseline = evaluateManifestSuccession(POSITIVE);
  for (const branch of ['main', 'trusted-looking/future', 'renamed', '']) {
    const relabeled = structuredClone(POSITIVE);
    relabeled.branch_evidence = branch;
    const result = evaluateManifestSuccession(relabeled);
    assert.equal(result.accepted, baseline.accepted, `branch label ${branch} changed acceptance`);
    assert.deepEqual(result.certified_verdicts, baseline.certified_verdicts);
  }
});

test('FIXED ADVERSARIAL CORPUS: all 32 cases refuse at their declared boundary', () => {
  const observed = collectManifestSuccessionEvidence(POSITIVE);
  for (const testCase of ADVERSARIAL_CORPUS) {
    const materialized = materializeCase(testCase, POSITIVE, observed);
    const result = testCase.surface === 'candidate'
      ? evaluateManifestSuccession(materialized.candidate)
      : assessManifestSuccession(materialized.candidate, materialized.observed);
    assert.equal(result.accepted, false, `${testCase.id} was accepted`);
    assert.ok(result.failed_checks.includes(testCase.expect_reject_check), `${testCase.id}: ${JSON.stringify(result.failed_checks)}`);
  }
});

test('ES-0002 remains byte-identical and replays 8/8 with its 22/22 adversarial bridge', () => {
  const replay = replayFrozenEs0002({ mirror: historicalMirror() });
  assert.equal(replay.classification, 'VERIFIED', JSON.stringify(replay.evidence));
  assert.deepEqual(replay.court, { tests: 8, pass: 8, fail: 0, skipped: 0 });
  assert.deepEqual(replay.adversarial_bridge, { tests: 22, pass: 22, fail: 0 });
  assert.equal(replay.freeze_sha256, '4c6c2a5693d7bc7d99b1fedaa7f51493328f2165edd140428e9def89e74c5894');
});

test('V1 historical replay remains 5/5 with no skips in the exact historical object context', () => {
  const result = spawnSync(process.execPath, ['--test', 'tools/promotion-gate/historical/historical-replay.court.test.mjs'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 600_000,
    maxBuffer: 128 * 1024 * 1024,
    env: { ...process.env, CANA_SOURCE_MIRROR: historicalMirror() },
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  assert.equal(result.status, 0, output.slice(-3000));
  assert.deepEqual(summary(output), { tests: 5, pass: 5, fail: 0, skipped: 0 });
});

const MUTATIONS = Object.freeze([
  {
    id: 'M01_REMOVE_MANIFEST_LINEAGE_VALIDATION',
    replacements: [['const accepted = checks.every((check) => check.ok);', 'const accepted = true;']],
    mutate: (candidate) => { candidate.manifest_succession.prior_owner_approved_reconciliation_sha256 = '0'.repeat(64); },
    expected: false,
    mutantExpected: true,
  },
  {
    id: 'M02_ACCEPT_DIGEST_ONLY_EQUALITY',
    replacements: [['const accepted = checks.every((check) => check.ok);', "const accepted = checks.find((check) => check.id === 'lineage.new-manifest-digest')?.ok === true;"]],
    mutate: (candidate) => { candidate.manifest_succession.prior_owner_approved_reconciliation_sha256 = '0'.repeat(64); },
    expected: false,
    mutantExpected: true,
  },
  {
    id: 'M03_SKIP_CANDIDATE_ANCESTRY',
    replacements: [['/* MUTATION:M03_SKIP_CANDIDATE_ANCESTRY */ observed.reality_candidate_ancestor === true', '/* MUTATION:M03_SKIP_CANDIDATE_ANCESTRY */ true']],
    mutate: (_candidate, observed) => { observed.reality_candidate_ancestor = false; },
    expected: false,
    mutantExpected: true,
  },
  {
    id: 'M04_SKIP_CANONICAL_ANCESTRY',
    replacements: [['/* MUTATION:M04_SKIP_CANONICAL_ANCESTRY */ observed.canonical_main_ancestor === true', '/* MUTATION:M04_SKIP_CANONICAL_ANCESTRY */ true']],
    mutate: (_candidate, observed) => { observed.canonical_main_ancestor = false; },
    expected: false,
    mutantExpected: true,
  },
  {
    id: 'M05_IGNORE_PATH_COUNT',
    replacements: [["/* MUTATION:M05_IGNORE_PATH_COUNT */ claim.entry_count === 24 && entries.length === 24 && expectedEntries.length === 24", '/* MUTATION:M05_IGNORE_PATH_COUNT */ true']],
    mutate: (candidate) => { candidate.manifest_succession.entry_count = 25; },
    expected: false,
    mutantExpected: true,
  },
  {
    id: 'M06_IGNORE_GIT_MODE',
    replacements: [["/* MUTATION:M06_IGNORE_GIT_MODE */ entries.every((entry, index) => entry.git_mode === expectedEntries[index]?.git_mode)", '/* MUTATION:M06_IGNORE_GIT_MODE */ true']],
    mutate: (candidate) => { candidate.manifest_succession.entries[0].git_mode = '100755'; },
    expected: false,
    mutantExpected: true,
  },
  {
    id: 'M07_IGNORE_GIT_BLOB',
    replacements: [["/* MUTATION:M07_IGNORE_GIT_BLOB */ entries.every((entry, index) => entry.git_blob_sha === expectedEntries[index]?.git_blob_sha)", '/* MUTATION:M07_IGNORE_GIT_BLOB */ true']],
    mutate: (candidate) => { candidate.manifest_succession.entries[0].git_blob_sha = '0'.repeat(40); },
    expected: false,
    mutantExpected: true,
  },
  {
    id: 'M08_IGNORE_CONTENT_SHA256',
    replacements: [["/* MUTATION:M08_IGNORE_CONTENT_SHA256 */ entries.every((entry, index) => entry.content_sha256 === expectedEntries[index]?.content_sha256)", '/* MUTATION:M08_IGNORE_CONTENT_SHA256 */ true']],
    mutate: (candidate) => { candidate.manifest_succession.entries[0].content_sha256 = '0'.repeat(64); },
    expected: false,
    mutantExpected: true,
  },
  {
    id: 'M09_ALLOW_WILDCARD',
    replacements: [
      ['/* MUTATION:M09_ALLOW_WILDCARD_PATH_SET */ entries.length === expectedEntries.length && entries.every((entry, index) => entry.path === expectedEntries[index]?.path)', '/* MUTATION:M09_ALLOW_WILDCARD_PATH_SET */ true'],
      ['/* MUTATION:M09_ALLOW_WILDCARD_SYNTAX */ entries.every((entry) => safePath(entry.path))', '/* MUTATION:M09_ALLOW_WILDCARD_SYNTAX */ true'],
    ],
    mutate: (candidate) => { candidate.manifest_succession.entries[0].path = 'tools/authority/**'; },
    expected: false,
    mutantExpected: true,
  },
  {
    id: 'M10_ALLOW_BRANCH_AS_AUTHORITY',
    replacements: [['/* MUTATION:M10_ALLOW_BRANCH_AS_AUTHORITY */ observed.branch_name_used_as_authority === false', "/* MUTATION:M10_ALLOW_BRANCH_AS_AUTHORITY */ candidate.branch_evidence === 'codex/growth-reality-closure'"]],
    mutate: (candidate) => { candidate.branch_evidence = 'renamed'; },
    expected: true,
    mutantExpected: false,
  },
  {
    id: 'M11_ALLOW_OWNER_PENDING_TO_OWNER_APPROVED',
    replacements: [["/* MUTATION:M11_ALLOW_OWNER_PENDING_TO_OWNER_APPROVED */ ownerGate.state === 'PENDING' && ownerGate.claimed_owner_approved !== true", "/* MUTATION:M11_ALLOW_OWNER_PENDING_TO_OWNER_APPROVED */ ['PENDING', 'APPROVED'].includes(ownerGate.state)"]],
    mutate: (candidate) => { candidate.owner_gate = { state: 'APPROVED', claimed_owner_approved: true }; },
    expected: false,
    mutantExpected: true,
  },
  {
    id: 'M12_ALLOW_UNKNOWN_MANIFEST_SUCCESSION',
    replacements: [["/* MUTATION:M12_ALLOW_UNKNOWN_MANIFEST_SUCCESSION */ claim.new_manifest_digest === V3_CONTRACT.new_manifest_digest && observed.new_manifest_digest === V3_CONTRACT.new_manifest_digest", '/* MUTATION:M12_ALLOW_UNKNOWN_MANIFEST_SUCCESSION */ HEX64.test(claim.new_manifest_digest) && observed.new_manifest_digest === claim.new_manifest_digest']],
    mutate: (candidate, observed) => { candidate.manifest_succession.new_manifest_digest = 'f'.repeat(64); observed.new_manifest_digest = 'f'.repeat(64); },
    expected: false,
    mutantExpected: true,
  },
]);

async function importMutant(mutation) {
  let source = fs.readFileSync(path.join(HERE, 'es-0003.mjs'), 'utf8');
  for (const [search, replacement] of mutation.replacements) {
    assert.ok(source.includes(search), `${mutation.id} source marker is absent`);
    source = source.replace(search, replacement);
  }
  source = source
    .replace("from './es-0002.mjs'", `from '${pathToFileURL(path.join(HERE, 'es-0002.mjs')).href}'`)
    .replace("from '../durability/cli.mjs'", `from '${pathToFileURL(path.join(ROOT, 'tools', 'durability', 'cli.mjs')).href}'`);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cana-es0003-mutation-'));
  const file = path.join(directory, `${mutation.id}.mjs`);
  fs.writeFileSync(file, source, { mode: 0o600 });
  try {
    return await import(`${pathToFileURL(file).href}?nonce=${crypto.randomUUID()}`);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('MUTATION COURT: all 12 fixed security mutations make the frozen court red', async () => {
  assert.deepEqual(MUTATIONS.map((mutation) => mutation.id), MUTATION_IDS);
  const observed = collectManifestSuccessionEvidence(POSITIVE);
  for (const mutation of MUTATIONS) {
    const candidate = structuredClone(POSITIVE);
    const scenario = structuredClone(observed);
    mutation.mutate(candidate, scenario);
    const baseline = assessManifestSuccession(candidate, scenario);
    assert.equal(baseline.accepted, mutation.expected, `${mutation.id} baseline scenario is not discriminating`);
    const mutant = await importMutant(mutation);
    const mutatedResult = mutant.assessManifestSuccession(candidate, scenario);
    assert.equal(mutatedResult.accepted, mutation.mutantExpected, `${mutation.id} did not change the frozen verdict`);
    assert.notEqual(mutatedResult.accepted, baseline.accepted, `${mutation.id} left the court green`);
  }
});

test('POST-MEASUREMENT SUCCESSION CASE follows federation law and keeps owner promotion pending', () => {
  const file = path.join(HERE, 'fixtures', 'es-0003-succession-case.json');
  assert.ok(fs.existsSync(file), 'post-measurement succession case is absent');
  const succession = JSON.parse(fs.readFileSync(file, 'utf8'));
  const result = makeEvaluatorSuccessionCase(succession);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.equal(result.verdict, 'SUCCEED');
  assert.equal(succession.ownerPromotionGate, 'PENDING');
  assert.equal(succession.candidateAuthor, 'lane-implementation');
  assert.equal(succession.adjudicator, 'lane-verification-independent-node-test-harness');
  assert.notEqual(succession.candidateAuthor, succession.adjudicator);
  assert.equal(succession.criteriaFixedBeforeCandidate, true);
  assert.deepEqual(succession.promotionCriteria, PROMOTION_CRITERIA);
  assert.equal(succession.bridgeResults.every((entry) => entry.agree === true), true);
  assert.equal(succession.holdoutResults.length, 18);
  assert.equal(succession.holdoutResults.every((entry) => entry.candidateCorrect === true), true);
  assert.equal(succession.mutationTest.pass, true);
  assert.match(succession.candidate.sealed_commit_sha, /^[0-9a-f]{40}$/);
  assert.match(succession.candidate.source_sha256, /^[0-9a-f]{64}$/);
  const sealedSource = spawnSync(
    'git',
    ['show', `${succession.candidate.sealed_commit_sha}:tools/promotion-gate/es-0003.mjs`],
    { cwd: ROOT, encoding: 'buffer', maxBuffer: 128 * 1024 * 1024 },
  );
  assert.equal(sealedSource.status, 0, sealedSource.stderr?.toString('utf8'));
  assert.equal(sha256(sealedSource.stdout), succession.candidate.source_sha256);
  assert.equal(sha256(fs.readFileSync(path.join(HERE, 'es-0003.mjs'))), succession.candidate.source_sha256);
  for (const forbidden of FORBIDDEN_VERDICTS) assert.ok(!CERTIFIABLE_VERDICTS.includes(forbidden));
});
