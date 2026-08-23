// ALIVE LOOP v1 — the fourteen required executable courts from
// docs/convergence/mission-1/MINIMUM_ALIVE_LOOP_SPEC.md, as falsifiable tests.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CycleStore, Lease, LoopRefusal, idempotencyKey, runCycle,
  validateMissionGrant, verifyChainFile,
} from './adapter.mjs';
import { compile } from '../../skills-src/sitemind-context-compiler.mjs';
import { toWinnerMemory } from '../../skills-src/cana-signal-to-fix.mjs';

const NOW = new Date('2026-08-17T22:00:00Z');
const HEAD = 'a'.repeat(40);
const TREE = 'b'.repeat(40);

function makeMissionGrant(overrides = {}) {
  const base = {
    mission_id: 'mission-alive-court',
    mission_version: 1,
    issued_at: '2026-08-17T21:00:00Z',
    expires_at: '2026-08-18T21:00:00Z',
    cana_commit: HEAD,
    cana_tree: TREE,
    target: 'local-verification',
    allowed_paths: ['tools/visual-court', 'apps/web/src'],
    objective: 'prove the pinned tree satisfies the visual court verdict',
    metric: 'run-static verdict is PASS at the pinned tree',
    max_attempts: 1,
    max_runtime_ms: 60000,
    max_bytes: 1048576,
    max_cost: 0,
    capabilities: ['RUN_TESTS'],
    evidence_requirements: ['execution receipt', 'court verdict'],
    policy_version: 'policy/1',
    schema_version: 'cana-alive-loop/1',
    provider_route: 'none',
    ...overrides,
  };
  base.idempotency_key = overrides.idempotency_key ?? idempotencyKey(base);
  return base;
}

function goodFacts() {
  return [{
    id: 'fact-head',
    claim: `candidate tree pinned at ${HEAD.slice(0, 12)} for local verification of the visual court verdict`,
    authority: 'INDEPENDENTLY_VERIFIED_RECEIPT',
    truth_status: 'VERIFIED',
    source: 'git rev-parse HEAD',
    observed_at: '2026-08-17',
    valid_for_days: 2,
    tags: ['local-verification', 'visual', 'court', 'verdict', 'tree'],
  }];
}

function goodFixture({ improved = true, succeeded = true } = {}) {
  return async () => ({
    succeeded,
    failureReason: succeeded ? undefined : 'fixture reports the metric false',
    evidence: succeeded ? [{ observation: 'run-static verdict PASS (9 laws)', ref: 'receipts/run-static.json' }] : [],
    observed_side_effects: 0,
    touched_paths: ['tools/visual-court/run-static.mjs'],
    output: { verdict: succeeded ? 'PASS' : 'FAIL' },
    measurement: { source: 'run-static', window: 'single-run', improved, value: succeeded ? 'PASS' : 'FAIL' },
  });
}

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'alive-loop-'));
}

const run = (overrides = {}) => runCycle({
  grant: makeMissionGrant(overrides.grant ?? {}),
  facts: overrides.facts ?? goodFacts(),
  fixture: overrides.fixture ?? goodFixture(),
  storeDir: overrides.storeDir ?? tmp(),
  now: NOW,
  repoHead: overrides.repoHead ?? HEAD,
  repoTree: overrides.repoTree ?? TREE,
  intentSubjects: overrides.intentSubjects,
});

test('court 1: exact-source and exact-tree refusal happens before any execution', async () => {
  await assert.rejects(run({ repoHead: 'f'.repeat(40) }), /TREE_MISMATCH/);
  await assert.rejects(run({ repoTree: 'e'.repeat(40) }), /TREE_MISMATCH/);
});

test('court 2: identical input compiles to identical bytes and digest', () => {
  const one = compile({ objective: 'prove the visual court verdict', facts: goodFacts(), now: NOW });
  const two = compile({ objective: 'prove the visual court verdict', facts: goodFacts(), now: NOW });
  assert.equal(one.valid, true);
  assert.equal(one.packet.packet_digest, two.packet.packet_digest);
});

test('court 3: grant tampering and capability escalation are denied', async () => {
  const grant = makeMissionGrant();
  const tampered = { ...grant, objective: 'a different objective after signing' };
  await assert.rejects(run({ grant: tampered }), /IDEMPOTENCY_MISMATCH/);
  assert.throws(
    () => validateMissionGrant(makeMissionGrant({ capabilities: ['CONTACT_MERCHANT'] }), { now: NOW }),
    /OWNER_ONLY_CAPABILITY/,
  );
  assert.throws(
    () => validateMissionGrant(makeMissionGrant({ capabilities: ['SUMMON_DEMONS'] }), { now: NOW }),
    /UNKNOWN_CAPABILITY/,
  );
});

test('court 4: a fixture escaping the path allowlist is denied with a refusal', async () => {
  const escaping = async () => ({
    succeeded: true,
    evidence: [{ observation: 'x', ref: 'y' }],
    observed_side_effects: 0,
    touched_paths: ['../outside/secrets.txt'],
    output: {},
  });
  await assert.rejects(run({ fixture: escaping }), /PATH_ESCAPE/);
  const absolute = async () => ({
    succeeded: true,
    evidence: [{ observation: 'x', ref: 'y' }],
    observed_side_effects: 0,
    touched_paths: ['/etc/passwd'],
    output: {},
  });
  await assert.rejects(run({ fixture: absolute }), /PATH_ESCAPE/);
});

test('court 5: provider route none|mock only; nonzero cost refused; external effects refused', async () => {
  assert.throws(() => validateMissionGrant(makeMissionGrant({ provider_route: 'openai' }), { now: NOW }), /PROVIDER_ROUTE/);
  assert.throws(() => validateMissionGrant(makeMissionGrant({ max_cost: 5 }), { now: NOW }), /COST_NONZERO/);
  const effectful = async () => ({
    succeeded: true,
    evidence: [{ observation: 'x', ref: 'y' }],
    observed_side_effects: 1,
    touched_paths: [],
    output: {},
  });
  await assert.rejects(run({ fixture: effectful }), /EXTERNAL_EFFECT/);
});

test('court 6: duplicate claims and lease contention produce ONE logical execution', async () => {
  const storeDir = tmp();
  const first = await run({ storeDir });
  assert.equal(first.final_state, 'CLOSED');
  assert.equal(first.resumed, false);
  const second = await run({ storeDir });
  assert.equal(second.resumed, true, 'second identical claim resumes the closed cycle instead of re-executing');
  // Contention: a held lease refuses a competing worker on an OPEN cycle.
  const key = idempotencyKey(makeMissionGrant());
  const contended = tmp();
  const lease = new Lease(contended, key);
  assert.equal(lease.acquire(), true);
  await assert.rejects(run({ storeDir: contended }), /LEASE_HELD/);
  lease.release();
});

test('court 7: crash at a state boundary resumes deterministically without duplicate effects', async () => {
  const storeDir = tmp();
  let calls = 0;
  const crashing = async () => { calls += 1; throw new Error('simulated crash during execution'); };
  await assert.rejects(run({ storeDir, fixture: crashing }));
  // The pre-execution states are recorded exactly once; the lease is still held.
  const key = idempotencyKey(makeMissionGrant());
  const store = new CycleStore(path.join(storeDir, `cycle.${key.slice(0, 24)}.jsonl`));
  const statesAfterCrash = store.records().map((r) => r.state);
  assert.deepEqual(statesAfterCrash, ['GRANTED', 'LEASED', 'COMPILED', 'PROPOSED', 'SEALED']);
  // Operator resolves the lease (explicit, not automatic), then resume completes
  // without appending duplicate pre-crash states.
  new Lease(storeDir, key).release();
  const resumed = await run({ storeDir });
  assert.equal(resumed.final_state, 'CLOSED');
  const states = store.records().map((r) => r.state);
  assert.deepEqual(states.slice(0, 5), ['GRANTED', 'LEASED', 'COMPILED', 'PROPOSED', 'SEALED']);
  assert.equal(states.filter((s) => s === 'GRANTED').length, 1, 'no duplicate GRANTED on resume');
  assert.equal(states.filter((s) => s === 'EXECUTED_LOCAL').length, 1, 'exactly one logical execution');
  assert.equal(calls, 1, 'the crashed attempt executed once; resume ran the fresh fixture once more only');
});

test('court 8: receipt mutation, deletion, reordering, and replay are detected', async () => {
  const storeDir = tmp();
  const result = await run({ storeDir });
  const file = result.store_path;
  const original = fs.readFileSync(file, 'utf8');
  const lines = original.trim().split('\n');

  // Mutation (row field)
  fs.writeFileSync(file, original.replace('"state":"COMPILED"', '"state":"COMPILED_X"'));
  assert.equal(verifyChainFile(file).valid, false, 'mutated record breaks the chain');
  // Mutation (payload BODY — row fields untouched; the custody-sweep probe
  // caught the verifier blind to exactly this, so it is pinned here forever)
  fs.writeFileSync(file, original.replace('"final":"ADMITTED"', '"final":"REWRITTEN"'));
  assert.equal(verifyChainFile(file).valid, false, 'payload-body mutation breaks the chain');
  // Deletion
  fs.writeFileSync(file, lines.filter((_, i) => i !== 2).join('\n') + '\n');
  assert.equal(verifyChainFile(file).valid, false, 'deleted record breaks the chain');
  // Reordering
  const reordered = [...lines];
  [reordered[1], reordered[2]] = [reordered[2], reordered[1]];
  fs.writeFileSync(file, reordered.join('\n') + '\n');
  assert.equal(verifyChainFile(file).valid, false, 'reordered records break the chain');
  // Replay (duplicate an earlier record at the tail)
  fs.writeFileSync(file, [...lines, lines[3]].join('\n') + '\n');
  assert.equal(verifyChainFile(file).valid, false, 'replayed record breaks the chain');
  // Restore + prove appending on a broken chain quarantines instead of writing.
  fs.writeFileSync(file, original.replace('"state":"COMPILED"', '"state":"COMPILED_X"'));
  const store = new CycleStore(file);
  assert.throws(() => store.append({ state: 'CLOSED', missionId: 'm', idemKey: 'k', payload: {} }), /CHAIN_BROKEN/);
  assert.ok(fs.readdirSync(path.dirname(file)).some((f) => f.includes('quarantined')), 'broken chain was quarantined');
});

test('court 9: hermes-disabled path works; an approved hermes candidate is refused as inconsistent', async () => {
  const withCandidate = await run({
    grant: { hermes_candidate: { sha: 'd9165d7', tree: 'c'.repeat(40), evaluation_only: true, approved: false } },
  });
  assert.equal(withCandidate.final_state, 'CLOSED', 'evaluation-only candidate rides along without execution');
  assert.throws(
    () => validateMissionGrant(makeMissionGrant({ hermes_candidate: { sha: 'd9165d7', evaluation_only: true, approved: true } }), { now: NOW }),
    /HERMES_UNAPPROVED_ONLY/,
  );
  assert.throws(
    () => validateMissionGrant(makeMissionGrant({ hermes_candidate: { sha: 'd9165d7', evaluation_only: false } }), { now: NOW }),
    /HERMES_NOT_EVALUATION_ONLY/,
  );
});

test('court 10: a worker return cannot mutate policy, route, grant, or evidence meaning', async () => {
  const malicious = async (packet) => {
    // Attempt every mutation an adversarial worker could try.
    try { packet.grant.capability = 'DEPLOY_PRODUCTION'; } catch { /* frozen */ }
    try { packet.intent.success_test = 'always true'; } catch { /* frozen */ }
    return {
      succeeded: true,
      evidence: [{ observation: 'legit-looking output', ref: 'out.json' }],
      observed_side_effects: 0,
      touched_paths: [],
      output: { verdict: 'PASS' },
      measurement: { source: 'run-static', window: 'single-run', improved: true, value: 'PASS' },
      // Foreign keys that must be ignored, not honored:
      provider_route: 'openai',
      grant: { capabilities: ['DEPLOY_PRODUCTION'] },
      policy_version: 'policy/999',
    };
  };
  const result = await run({ fixture: malicious });
  assert.equal(result.final_state, 'CLOSED');
  const records = new CycleStore(result.store_path).records();
  const sealedRecord = records.find((r) => r.state === 'SEALED');
  assert.equal(sealedRecord.payload.route, 'none', 'route stays as granted');
  assert.equal(sealedRecord.payload.capability, 'RUN_TESTS', 'capability stays as granted');
  const grantRecord = records.find((r) => r.state === 'GRANTED');
  assert.deepEqual(grantRecord.payload.grant.capabilities, ['RUN_TESTS'], 'grant record is the issued grant, not the worker fantasy');
});

test('court 11: unknown and simulated outcomes cannot enter Winner Memory', async () => {
  const unknownOutcome = async () => ({
    succeeded: true,
    evidence: [{ observation: 'ran fine', ref: 'out.json' }],
    observed_side_effects: 0,
    touched_paths: [],
    output: { verdict: 'PASS' },
    // no measurement at all → MEASURED records explicit UNKNOWN
  });
  const result = await run({ fixture: unknownOutcome });
  assert.equal(result.admitted, false, 'UNKNOWN measurement is rejected by the winner gate');
  assert.match(String(result.rejection_reason), /improve|PROMOTED|measured/i);
  // A forged "PROMOTED" object cannot enter Winner Memory directly either.
  const forged = toWinnerMemory({ stage: 'PROMOTED', valid: true, decision: 'ALLOWED' }, { improved: true });
  assert.equal(forged.stored, false, 'forged court results are refused by the canonical gate');
});

test('court 12: improving and non-improving fixture outcomes take opposite gate paths, both non-business', async () => {
  const improving = await run({ fixture: goodFixture({ improved: true }) });
  assert.equal(improving.admitted, true);
  assert.equal(improving.lesson.measured.non_business, true, 'admitted lesson is explicitly non-business evidence');
  const nonImproving = await run({
    grant: { mission_id: 'mission-alive-court-negative' },
    fixture: goodFixture({ improved: false }),
  });
  assert.equal(nonImproving.admitted, false);
  const records = new CycleStore(nonImproving.store_path).records();
  const measured = records.find((r) => r.state === 'MEASURED');
  assert.equal(measured.payload.measurement.non_business, true);
});

test('court 13: the loop runtime is absent from the web application import graph', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const webSrc = path.join(root, 'apps', 'web', 'src');
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx|mjs|js)$/.test(entry.name) && fs.readFileSync(full, 'utf8').includes('alive-loop')) {
        offenders.push(full);
      }
    }
  };
  walk(webSrc);
  assert.deepEqual(offenders, [], 'no web source file may import or reference the loop runtime');
});

test('court 14: removing the adapter preserves readable, independently verifiable receipts', async () => {
  const result = await run({});
  // verifyChainFile is intentionally self-contained (only node:crypto/node:fs);
  // this simulates post-rollback verification without the adapter's classes.
  const verdict = verifyChainFile(result.store_path);
  assert.equal(verdict.valid, true);
  assert.ok(verdict.count >= 9, 'all state transitions remain readable after rollback');
  // Receipts are plain JSONL — a reader needs no adapter import to parse them.
  const parsed = fs.readFileSync(result.store_path, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(parsed[parsed.length - 1].state, 'CLOSED');
});

test('acceptance: one isolated cycle completes every state with deterministic bytes and a reproducible receipt', async () => {
  const result = await run({});
  assert.equal(result.final_state, 'CLOSED');
  assert.equal(result.admitted, true);
  assert.equal(result.chain.valid, true);
  const states = new CycleStore(result.store_path).records().map((r) => r.state);
  assert.deepEqual(states, ['GRANTED', 'LEASED', 'COMPILED', 'PROPOSED', 'SEALED', 'EXECUTED_LOCAL', 'RECEIPTED', 'MEASURED', 'ADMITTED', 'CLOSED']);
});
