// CAPABILITY ADMISSION COURT — AUTHORITY QUESTION B: WHO ADMITS CAPABILITIES?
//
// LAW UNDER TEST:  CAPABILITY != AUTHORITY.
//   Admitting a capability into the census registry (DISCOVER/REGISTER/OWN/
//   PROMOTE/REVOKE) is a pure DATA operation over an inert file. It confers no
//   right to act. The right to act (AUTHORIZE/EXECUTE) lives in a SEPARATE
//   machine — the Hermes governed-packet grant path (skills-src/
//   hermes-governed-packet.mjs) and, in the durable donor, the RSI governor
//   (packages/governor-kernel/**). This court proves, with the REAL code, that
//   the two planes never touch.
//
// This file EXTENDS census-blindspot.test.mjs (which proves the ONE
// CAPABILITY -> ONE CANONICAL OWNER anti-duplication law and stays green). It
// re-verifies the two duplicate-detection courts here so the admission story is
// self-contained, then adds the four authority-separation courts.
//
// Every test runs the REAL modules. Nothing re-implements matching, granting,
// or promotion. Tests that document a real conflation in the code are marked
// `DOCUMENTED VIOLATION` in their name and assert the ACTUAL (wrong-if-any)
// behavior, so the court stays honest instead of asserting a fiction.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { censusVerdict, loadOwners } from './capability-census.mjs';
import { censusGateForVerify } from './census-gate.mjs';
import { buildEC0001, runHoldout, HOLDOUT } from './ec-0001.mjs';
import { buildES0001 } from './es-0001.mjs';
import { makeEvolutionCase } from './evolution.mjs';
import { makeGrant, sealPacket, makeReceipt, CAPABILITIES, OWNER_ONLY } from '../../skills-src/hermes-governed-packet.mjs';
// PHASE D RECONCILIATION (merged tree). In the Federation-only tree this court was ported from,
// `makeGrant` accepted an arbitrary `issuedBy`, so a valid grant could be minted from thin air. In
// the merged tree the Hermes critical path is closed: a grant can ONLY be derived from a CANA
// Authority authorization object minted by the single seat (tools/authority) and verified under the
// owner-root key. The LAW under test is unchanged — CAPABILITY != AUTHORITY, and the authority plane
// never consults the census — but a "valid grant" now requires a REAL authorization. The helper below
// mints one exactly the way the Hermes self-test does (real generator != judge path), so COURT 6 can
// still prove "ownership is not necessary for a grant" and "a governed action seals on grant+context
// alone" against a genuine grant rather than a forgeable one.
import {
  authorize, provisionDevOwnerRoot, devOwnerSigner, ownerRootVerifier, ContainmentStore,
} from '../../tools/authority/authority.mjs';
import { compileMinimalContext } from '../../tools/mission-2/context.mjs';
import { createMissionContract } from '../../tools/mission-2/contracts.mjs';
import { sha256 as m2sha } from '../../tools/mission-2/canonical.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const OWNERS_FILE = path.join(HERE, 'capability-owners.json');

const ownerFor = (owners, capability) => owners.find((o) => o.capability === capability);

/**
 * Mint a REAL CANA Authority authorization for `capability` on `resource`, through the actual
 * authorize() seat, and return everything makeGrant needs to derive a grant from it, plus a cleanup.
 * This is the merged tree's replacement for the old forgeable `{ issuedBy: 'CANA' }` shortcut — the
 * authorization is signed by a DEV owner root and verified against the EXTERNAL owner public key, so
 * nothing here self-authorizes. It is deliberately located in this court (not imported from the
 * authority tests) so the admission story stays self-contained.
 */
function mintRealAuthorization({ capability, resource = 'docs/status.md', now, missionId }) {
  const future = new Date(now.getTime() + 86_400_000);
  const selfRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-admission-auth-'));
  const stateDir = path.join(selfRoot, 'state');
  const ownerRoot = path.join(selfRoot, 'owner');
  provisionDevOwnerRoot(ownerRoot);
  const signer = devOwnerSigner(ownerRoot);
  const verifier = ownerRootVerifier(ownerRoot);
  const cstore = new ContainmentStore(stateDir);
  cstore.setBudget('calls', 1000);
  cstore.issueAuthorization({ id: 'auth_self', actor_id: 'actor_owner', tenant_id: 'tenant_self', site_id: 'site_1',
    allowed_actions: [capability], allowed_resources: ['*'],
    financial_budget: 0, runtime_budget: 1000, call_budget: 1000, delegation_depth: 2,
    issued_at: now.toISOString(), not_before: null, expires_at: future.toISOString() });
  cstore.issueCapability({ id: 'cap_self', worker_id: 'worker_1', authorization_id: 'auth_self',
    allowed_actions: [capability], allowed_resources: ['*'],
    runtime_budget: 500, call_budget: 500, delegation_depth: 0, issued_at: now.toISOString(), expires_at: future.toISOString() });

  const SC = 'a'.repeat(40); const ST = 'b'.repeat(40); const SEV = m2sha('protected-base-receipt');
  const seed = { mission_id: missionId, tenant_id: 'tenant_self', workspace_id: 'workspace_self',
    objective: 'run the browser court on the homepage', source_repository: 'r', source_commit: SC, source_tree: ST, permitted_files: ['docs/status.md'] };
  const fct = { id: 'f1', claim: 'server is running and canonical checks are proven by protected-base receipts',
    authority: 'INDEPENDENTLY_VERIFIED_RECEIPT', truth_status: 'VERIFIED', source: 's', observed_at: '2026-07-26T08:00:00.000Z',
    valid_for_days: 1, tags: ['subject:x'], tenant_id: 'tenant_self', workspace_id: 'workspace_self', source_commit: SC,
    source_tree: ST, evidence_sha256: SEV, target_files: ['docs/status.md'], provenance_status: 'CURRENT_VERIFIED' };
  const packet = compileMinimalContext({ mission: seed, facts: [fct], now });
  const m = createMissionContract({ mission_id: missionId, tenant_id: 'tenant_self', workspace_id: 'workspace_self',
    mission_type: 'STALE_REGISTERED_PROJECT_FACT', objective: seed.objective,
    originating_signal: { signal_id: 's1', evidence_ref: `sha256:${SEV}` }, source_repository: 'r', source_commit: SC, source_tree: ST,
    source_evidence_references: [`sha256:${SEV}`], context_compiler_version: 'sitemind-context-compiler/mission-2-adapter-1',
    context_packet_hash: packet.packet_hash, authority_identity: 'CANA', authorization_identity: 'CANA_V1',
    permitted_files: ['docs/status.md'], permitted_resources: ['ISOLATED_GIT_WORKTREE'],
    permitted_capabilities: ['READ_REPOSITORY', 'RUN_TESTS', 'WRITE_LOCAL_BRANCH'], provider_state: 'NONE',
    hermes_state: 'DISABLED', approved_hermes_pin: 'NONE', budget: { currency: 'USD', maximum: 0, spent: 0 },
    external_effect_policy: 'NONE', production_access: 'NONE', timeout_ms: 60000, expires_at: future.toISOString(),
    success_criteria: ['a', 'b'], verifier_identity: 'VERIFIER_V1',
    verification_contract: { operation: { kind: 'REPLACE_EXACT_TEXT', path: 'docs/status.md', find: 'x', replace: 'y' }, expected_text: 'y' },
    rollback_procedure: { kind: 'EXACT_BYTES', description: 'restore' }, current_lifecycle_state: 'MISSION_SEALED',
    latest_checkpoint: null, execution_attempts: [], evidence_references: [], failure_history: [],
    promotion_status: 'NOT_EVALUATED', next_eligible_action: 'AUTHORIZE' });
  const r = authorize({ now: now.toISOString(), tenant: 'tenant_self', executorIdentity: 'EXEC_V1',
    action: { action_type: capability, resource }, capability, budgetUnits: 10, mission: m, contextPacket: packet,
    containment: { authorization_id: 'auth_self', worker_capability_id: 'cap_self', worker_id: 'worker_1',
      actor_id: 'actor_owner', site_id: 'site_1', mission_id: missionId, budget: { calls: 1 } },
    signer, verifier, ownerRootDir: ownerRoot }, { stateDir });
  const boundAction = { action_type: capability, resource, tenant: 'tenant_self' };
  return { authorization: r.authorization, verifier, boundAction, cleanup: () => { try { fs.rmSync(selfRoot, { recursive: true, force: true }); } catch { /* best effort */ } } };
}

/* ======================================================================== */
/* COURT 1 — DUPLICATE GOVERNOR PROPOSAL IS DETECTED (verify existing green)  */
/* ======================================================================== */

test('COURT 1: a duplicate Governor (metabolism-coordination) proposal is REFUSED_DUPLICATE', () => {
  const owners = loadOwners();
  // Phrasings a future agent would actually write — not restatements of job_terms.
  const proposals = [
    'stand up a resident daemon that runs the governed metabolism on a fixed interval, writing a pulse receipt for every metabolism pulse',
    'a second governor daemon that pulses the metabolism non stop',
    'continuous pulse scheduler for the governed metabolism, resident in the environment',
  ];
  for (const p of proposals) {
    const v = censusVerdict(p, owners); // REAL census, INCUMBENT evaluator
    assert.equal(v.verdict, 'REFUSED_DUPLICATE', `census cleared a rebuild of the governor: "${p}"`);
    const hit = v.collisions.find((c) => c.capability === 'metabolism-coordination');
    assert.ok(hit, `refused "${p}" but cited ${JSON.stringify(v.collisions.map((c) => c.capability))}`);
    assert.ok(hit.matched_terms.length >= 2, 'the gate refuses only at >=2 matched terms');
    assert.ok(hit.owner_paths.includes('tools/vanguard/governor.mjs'), 'must cite the real owner');
    assert.ok(hit.owner_paths_present.includes('tools/vanguard/governor.mjs'), 'cited owner must exist on disk');
  }
});

/* ======================================================================== */
/* COURT 2 — DUPLICATE LAYOUT KERNEL PROPOSAL IS DETECTED (verify existing)   */
/* ======================================================================== */

test('COURT 2: a duplicate Layout Kernel (layout-intelligence) proposal is REFUSED_DUPLICATE', () => {
  const owners = loadOwners();
  const proposals = [
    'an adaptive workspace layout engine with a resizable pane tree, where moving or tabbing a pane preserves its pane state',
    'a bsp layout tree of panes where each semantic pane id keeps its own state',
    'let merchants split pane views and tab panes without losing pane state',
  ];
  for (const p of proposals) {
    const v = censusVerdict(p, owners);
    assert.equal(v.verdict, 'REFUSED_DUPLICATE', `census cleared a rebuild of the layout kernel: "${p}"`);
    const hit = v.collisions.find((c) => c.capability === 'layout-intelligence');
    assert.ok(hit, `refused "${p}" but cited ${JSON.stringify(v.collisions.map((c) => c.capability))}`);
    assert.ok(hit.matched_terms.length >= 2, 'the gate refuses only at >=2 matched terms');
    assert.ok(hit.owner_paths.includes('tools/experience-fabric/layout-kernel.mjs'), 'must cite the real owner');
    assert.ok(hit.owner_paths_present.includes('tools/experience-fabric/layout-kernel.mjs'), 'cited owner must exist on disk');
  }
});

/* ======================================================================== */
/* COURT 3 — A REGISTERED CAPABILITY CANNOT SELF-AUTHORIZE                     */
/*   The registry/census path must return inert DATA — never a grant/authz.   */
/* ======================================================================== */

// The complete surface of the admission path. Every export a caller can reach.
const CENSUS_SHAPE = () => {
  const owners = loadOwners();
  return {
    verdict: censusVerdict('anything at all here', owners),
    ownerRow: ownerFor(owners, 'metabolism-coordination'),
    gate: censusGateForVerify(),
  };
};

// Field names that would signal an authorization/grant leaking into census output.
const AUTHORITY_FIELD = /^(grant|grant_id|granted|authoriz|authority|token|capability_id|worker_capability|signature|signed|budget|allow(ed)?_actions|allowed_resources|expires_at|execute|exec|permit)/i;

const scanForAuthority = (obj, pathStr = '$', hits = []) => {
  if (obj === null || typeof obj !== 'object') return hits;
  for (const [k, val] of Object.entries(obj)) {
    if (AUTHORITY_FIELD.test(k)) hits.push(`${pathStr}.${k}`);
    if (val && typeof val === 'object') scanForAuthority(val, `${pathStr}.${k}`, hits);
  }
  return hits;
};

test('COURT 3: the census verdict is inert data — no grant/authorization/exec object anywhere in it', () => {
  const { verdict } = CENSUS_SHAPE();
  // The verdict object is exactly {proposal, verdict, collisions[]} — a JUDGEMENT, not a permission.
  assert.deepEqual(Object.keys(verdict).sort(), ['collisions', 'proposal', 'verdict']);
  assert.ok(['CLEAR_TO_BUILD', 'REFUSED_DUPLICATE'].includes(verdict.verdict),
    'the verdict is a build-time opinion, not a runtime permission');
  const leaks = scanForAuthority(verdict);
  assert.deepEqual(leaks, [], `census verdict leaked authority-shaped fields: ${JSON.stringify(leaks)}`);
  // Even a CLEAR verdict — the "yes you may build" answer — grants nothing executable.
  const clear = censusVerdict('a brand new customer facing product search interface with natural filters', loadOwners());
  assert.equal(clear.verdict, 'CLEAR_TO_BUILD');
  assert.equal(clear.grant, undefined, 'CLEAR_TO_BUILD is permission to BUILD, never permission to ACT');
  assert.equal(typeof clear.execute, 'undefined', 'the census exposes no execute() — it cannot run anything');
});

test('COURT 3: a registered owner ROW is inert data (job_terms + owner_paths only), carries no authority', () => {
  const { ownerRow } = CENSUS_SHAPE();
  assert.ok(ownerRow, 'metabolism-coordination must be registered');
  // The owner row describes WHO OWNS A JOB. It must not carry any field that
  // could be read as "and therefore may act".
  const leaks = scanForAuthority(ownerRow);
  assert.deepEqual(leaks, [],
    `an owner registry row leaked authority-shaped fields ${JSON.stringify(leaks)} — ownership is not authority`);
  // Positively: it is pure description.
  assert.ok(Array.isArray(ownerRow.job_terms) && Array.isArray(ownerRow.owner_paths));
  // The federation's own architecture note enforces this at the data layer:
  const raw = JSON.parse(fs.readFileSync(OWNERS_FILE, 'utf8'));
  const note = raw.amendments?.[0]?.architecture_note ?? '';
  assert.match(note, /CAPABILITY OWNERSHIP IS NOT ROOT AUTHORITY/,
    'the registry must declare in its own provenance that ownership != authority');
});

test('COURT 3: the census-gate verdict is a pass/fail finding set, exposes no grant and no executor', () => {
  const { gate } = CENSUS_SHAPE();
  assert.equal(typeof gate.ok, 'boolean');
  assert.ok(Array.isArray(gate.findings));
  for (const f of gate.findings) {
    assert.ok(typeof f.check === 'string' && typeof f.ok === 'boolean',
      'a gate finding is {check, ok, ...} — a verification result, not a permission');
  }
  const leaks = scanForAuthority({ findings: gate.findings });
  assert.deepEqual(leaks, [], `the gate leaked authority-shaped fields: ${JSON.stringify(leaks)}`);
});

test('COURT 3: the authorization machine and the census are DISJOINT modules — census imports no grant path', () => {
  // Structural proof: capability-census.mjs and census-gate.mjs must not import
  // the grant/authority machine. If admission ever imported authorization, the
  // two planes would be one edit away from conflation.
  for (const file of ['capability-census.mjs', 'census-gate.mjs']) {
    const src = fs.readFileSync(path.join(HERE, file), 'utf8');
    assert.doesNotMatch(src, /hermes-governed-packet|makeGrant|sealPacket|governor-kernel|rsi\.py/,
      `${file} imports the authorization plane — admission must not be able to mint a grant`);
  }
});

/* ======================================================================== */
/* COURT 4 — A PROMOTED CAPABILITY CANNOT GRANT ITSELF BROADER SCOPE          */
/*   Use the Federation evolution / evaluators promotion path. Prove a        */
/*   PROMOTE verdict is inert and cannot, by itself, widen owner_paths or     */
/*   job_terms — that requires a separate owner-gated registry WRITE.         */
/* ======================================================================== */

test('COURT 4: makeEvolutionCase(PROMOTE) returns inert data — it writes nothing and touches no owner', () => {
  const before = fs.readFileSync(OWNERS_FILE, 'utf8');

  // The real EC-0001 promotion (verdict PROMOTE, holdout measured live).
  const holdoutResults = runHoldout().map((r) => ({ case: r.case, pass: r.pass }));
  const ec = buildEC0001({ holdoutResults });
  assert.equal(ec.verdict, 'PROMOTE');
  assert.equal(ec.valid, true, `EC-0001 must be a valid case: ${JSON.stringify(ec.errors)}`);

  // A PROMOTE verdict is a RECORD, not an effect. It exposes no writer, no grant,
  // no owner mutation — it is a frozen-in-time judgement object.
  assert.equal(typeof ec.apply, 'undefined', 'an evolution case has no .apply() — promotion is not self-executing');
  assert.equal(typeof ec.write, 'undefined', 'an evolution case cannot write itself into effect');
  const leaks = scanForAuthority(ec);
  // Note: EC-0001's prose mentions "authorization-governor" as a capability name
  // inside diagnoses/attribution strings; scanForAuthority only flags KEYS, not
  // values, so a mention in a string is not a leak. Keys must stay clean.
  assert.deepEqual(leaks, [], `evolution case leaked authority-shaped KEYS: ${JSON.stringify(leaks)}`);

  // The registry file is byte-for-byte unchanged: promotion did not widen anything.
  assert.equal(fs.readFileSync(OWNERS_FILE, 'utf8'), before,
    'building a PROMOTE case must not mutate capability-owners.json — scope changes require a separate owner-gated write');
});

test('COURT 4: a case that tries to widen its OWN scope without an independent judge is INVALID (GENERATOR != JUDGE)', () => {
  // Model the attack: a promoted capability authors a mutation that expands its
  // own owner_paths/job_terms, and tries to be its own evaluator. The evolution
  // court must refuse to even call it valid — the promotion path structurally
  // cannot self-widen.
  const selfServing = makeEvolutionCase({
    mission: 'self-expansion-attempt',
    observedFailure: 'metabolism-coordination wants to also own authorization so it can grant itself exec',
    diagnoses: [
      { hypothesis: 'we should own more', evidence: 'convenience' },
      { hypothesis: 'or maybe not', evidence: 'counterpoint' },
    ],
    selectedSurface: 'L4_WORKFLOW_POLICY_CODE',
    surfaceSelectionReason: 'we simply want broader scope',
    candidateMutations: [
      { id: 'X1', change: 'add authorization-governor owner_paths to metabolism-coordination', rollback: 'revert' },
      { id: 'X2', change: 'add exec job_terms to metabolism-coordination', rollback: 'revert' },
    ],
    mutationAuthor: 'metabolism-coordination',
    baseline: 'currently owns only pulse(n)',
    // THE VIOLATION: the mutator nominates ITSELF as the judge.
    evaluator: { ref: 'self', owner: 'metabolism-coordination', declared_before_candidates: true },
    holdout: ['h1'],
    baseline_measured: true,
    rollbackTarget: 'HEAD~1',
    verdict: 'PROMOTE',
    promotedCandidate: 'X1',
  });
  assert.equal(selfServing.valid, false, 'a self-judged scope-expansion must be structurally invalid');
  assert.ok(
    selfServing.errors.some((e) => /GENERATOR ≠ JUDGE|evaluator\.owner must differ/.test(e)),
    `the case must be refused for self-judging, got: ${JSON.stringify(selfServing.errors)}`,
  );
  // And even the invalid case object still writes nothing — it is pure data.
  assert.equal(typeof selfServing.apply, 'undefined');
});

test('COURT 4: widening owner_paths/job_terms requires a REGISTRY FILE WRITE that no promotion code performs', () => {
  // Prove the ONLY way scope changes is a human/owner-gated edit of the JSON
  // file. No module in the federation promotion path writes capability-owners.json.
  const federationDir = HERE;
  const files = fs.readdirSync(federationDir).filter((f) => f.endsWith('.mjs') && !f.endsWith('.test.mjs'));
  const writers = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(federationDir, f), 'utf8');
    // A write to the owners registry would need writeFileSync/appendFileSync targeting capability-owners.
    if (/(writeFileSync|appendFileSync)[^\n]*capability-owners/.test(src)) writers.push(f);
  }
  assert.deepEqual(writers, [],
    `these modules write capability-owners.json programmatically: ${writers.join(', ')} — ` +
    'scope must only change via an owner-gated file edit, never via a promotion side effect');

  // The census READS the registry; it never writes it.
  const censusSrc = fs.readFileSync(path.join(federationDir, 'capability-census.mjs'), 'utf8');
  assert.match(censusSrc, /readFileSync/, 'census reads the registry');
  assert.doesNotMatch(censusSrc, /writeFileSync|appendFileSync/, 'census must never write any file');
});

test('COURT 4: the ES-0001 evaluator succession (v1->v2) also self-certifies NOTHING — inert, refuses self-adjudication', () => {
  const es = buildES0001();
  // A real SUCCEED verdict, measured — but still inert data with an independent adjudicator.
  assert.equal(es.valid, true, `ES-0001 must be valid: ${JSON.stringify(es.errors)}`);
  assert.notEqual(es.adjudicator, es.candidate?.evaluator_id, 'the adjudicator may never be the candidate');
  assert.equal(typeof es.apply, 'undefined', 'an evaluator succession cannot promote itself into effect');
  // The evaluator registry flip is a separate committed file, not a side effect of building the case.
});

/* ======================================================================== */
/* COURT 5 — REMOVAL / REVOCATION SURVIVES RESTART                            */
/*   The registry is a FILE. A removed owner stays removed across a fresh     */
/*   process, and a stale in-memory copy cannot resurrect it via any API.     */
/* ======================================================================== */

test('COURT 5: a removed owner stays removed across a FRESH process (durability of the file registry)', () => {
  // Build an isolated registry, remove an owner, then re-load in a CHILD process
  // (a genuinely fresh Node interpreter) and prove it is gone.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-admission-revoke-'));
  try {
    const full = JSON.parse(fs.readFileSync(OWNERS_FILE, 'utf8'));
    // Remove metabolism-coordination and write the reduced registry to disk.
    const reduced = { ...full, owners: full.owners.filter((o) => o.capability !== 'metabolism-coordination') };
    const reducedFile = path.join(tmp, 'capability-owners.json');
    fs.writeFileSync(reducedFile, JSON.stringify(reduced, null, 2));

    // Child process: loads the reduced registry with the REAL loadOwners, then a
    // duplicate-governor proposal must now be CLEAR (owner is genuinely gone —
    // the removal took effect), proving the file, not memory, is the source of truth.
    const script = `
      import { loadOwners, censusVerdict } from ${JSON.stringify(path.join(HERE, 'capability-census.mjs'))};
      const owners = loadOwners(${JSON.stringify(reducedFile)});
      const present = owners.some((o) => o.capability === 'metabolism-coordination');
      const v = censusVerdict('a second governor daemon that pulses the metabolism non stop and writes a pulse receipt', owners);
      process.stdout.write(JSON.stringify({ present, verdict: v.verdict }));
    `;
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
    assert.equal(r.status, 0, `child failed: ${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.present, false, 'the removed owner must be absent in the fresh process');
    assert.equal(out.verdict, 'CLEAR_TO_BUILD',
      'with the owner removed from the FILE, the fresh process no longer refuses — removal is durable');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('COURT 5: the LIVE registry is unaffected — the removal happened only in the isolated temp file', () => {
  // Guard: the durability test above must never have touched the real registry.
  const owners = loadOwners();
  assert.ok(ownerFor(owners, 'metabolism-coordination'),
    'the real capability-owners.json must still contain metabolism-coordination — the test used an isolated copy');
});

test('COURT 5: a stale in-memory owners copy cannot resurrect a removed owner through the public API', () => {
  // loadOwners returns a fresh parse every call; there is no module-level cache
  // to poison. Prove that even if a caller HOLDS a stale array, the public
  // decision API (censusVerdict) only trusts the array it is HANDED — it never
  // secretly merges a hidden/global owner set. So the authoritative state is
  // whatever the FILE last produced; a stale copy is just a stale value, not a
  // back door that re-injects the owner into a fresh load.
  const staleOwners = loadOwners(); // pretend a long-lived process cached this
  const freshMissing = staleOwners.filter((o) => o.capability !== 'metabolism-coordination');

  // The public API honors exactly the owners it is given — no ambient state.
  const withStale = censusVerdict('a second governor daemon that pulses the metabolism non stop and writes a pulse receipt', staleOwners);
  const withFresh = censusVerdict('a second governor daemon that pulses the metabolism non stop and writes a pulse receipt', freshMissing);
  assert.equal(withStale.verdict, 'REFUSED_DUPLICATE', 'the stale copy still contains the owner, so it refuses — expected');
  assert.equal(withFresh.verdict, 'CLEAR_TO_BUILD',
    'the same API over the post-removal set clears — the API adds no hidden owners, so it cannot resurrect one');

  // And loadOwners itself has no cache: two loads of two different files disagree,
  // proving the function is a pure re-read, not a memoized singleton.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-admission-cache-'));
  try {
    const reduced = { owners: freshMissing };
    const f = path.join(tmp, 'reduced.json');
    fs.writeFileSync(f, JSON.stringify(reduced));
    const a = loadOwners(); // real file: has the owner
    const b = loadOwners(f); // reduced file: does not
    assert.ok(a.some((o) => o.capability === 'metabolism-coordination'));
    assert.ok(!b.some((o) => o.capability === 'metabolism-coordination'),
      'loadOwners is a pure re-read; no cache leaks the owner from a previous load');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

/* ======================================================================== */
/* COURT 6 — CAPABILITY OWNER != EXECUTION AUTHORITY                          */
/*   Owning a capability in the registry conveys no exec grant. A registry    */
/*   entry is NEITHER NECESSARY NOR SUFFICIENT for a Hermes grant.            */
/* ======================================================================== */

const future = new Date(Date.now() + 86_400_000);

test('COURT 6: registry ownership is NOT SUFFICIENT for a grant — an owned capability name is not even a grantable capability', () => {
  const owners = loadOwners();
  const ownedNames = owners.map((o) => o.capability); // e.g. metabolism-coordination, layout-intelligence
  // The Hermes grant vocabulary is a DIFFERENT, disjoint namespace of ACTIONS.
  // No registry capability name is a member of the grantable set — so "I own
  // capability X in the census" cannot possibly hand you an exec grant for X.
  for (const name of ownedNames) {
    assert.ok(!CAPABILITIES.includes(name),
      `census capability "${name}" is also a Hermes grantable capability — the two namespaces must stay disjoint`);
    // Attempting to mint a grant named after a census capability fails: unknown capability.
    const g = makeGrant({ capability: name, budgetUnits: 1, expiresAt: future, issuedBy: 'CANA' });
    assert.equal(g.valid, false,
      `a grant was minted for census-owned name "${name}" — ownership must not be a grant`);
    assert.ok(g.errors.some((e) => /unknown capability|owner-only/.test(e)));
  }
});

test('COURT 6: registry ownership is NOT NECESSARY for a grant — a valid grant needs no registry entry at all', () => {
  // A perfectly valid Hermes grant for RUN_BROWSER_COURT. Nothing in makeGrant
  // consults capability-owners.json — authority is granted from the authority
  // plane alone. In the merged tree the grant is DERIVED FROM a real CANA
  // Authority authorization (Phase D), not an arbitrary issuedBy string, but the
  // point stands: the authorization comes from the authority seat, never the census.
  const nowT = new Date('2026-07-26T12:00:00Z');
  const auth = mintRealAuthorization({ capability: 'RUN_BROWSER_COURT', now: nowT, missionId: 'm_not_necessary' });
  const g = makeGrant({ capability: 'RUN_BROWSER_COURT', budgetUnits: 10,
    authorization: auth.authorization, verifier: auth.verifier, boundAction: auth.boundAction, now: nowT });
  auth.cleanup();
  assert.equal(g.valid, true, `a legitimate grant must issue without any registry entry: ${JSON.stringify(g.errors)}`);
  assert.match(g.grant_id, /^gr_[0-9a-f]{16}$/);

  // Structural: the grant path never imports or reads the census registry.
  const hermesSrc = fs.readFileSync(path.join(ROOT, 'skills-src', 'hermes-governed-packet.mjs'), 'utf8');
  assert.doesNotMatch(hermesSrc, /capability-owners|capability-census|loadOwners|censusVerdict/,
    'the grant machine must not consult the ownership registry — authority does not derive from ownership');

  // RUN_BROWSER_COURT is NOT a registered census capability, yet it grants fine —
  // necessity disproved.
  const owners = loadOwners();
  assert.ok(!owners.some((o) => o.capability === 'RUN_BROWSER_COURT'),
    'RUN_BROWSER_COURT is deliberately not a census owner, yet a grant issues — ownership is not necessary');
});

test('COURT 6: a full governed action seals on GRANT + CONTEXT alone — the registry is never consulted end to end', () => {
  // Build a self-consistent context packet the way the compiler does, then run
  // the full authorize->execute->receipt lifecycle. None of it reads the census.
  return import('node:crypto').then(({ createHash }) => {
    const sha = (s) => createHash('sha256').update(s).digest('hex');
    const body = { objective: 'run the browser court on the homepage',
      actionable_facts: [{ id: 'f1', claim: 'server is running' }], contradictions: [] };
    const ctx = { ...body, packet_digest: sha(JSON.stringify(body)) };
    // Phase D: the grant is derived from a real authorization minted by the authority seat — NOT from
    // any registry state. The whole lifecycle below still references ZERO census state; that is the
    // property under test, and it is unaffected by where the (legitimate) authorization comes from.
    const nowT = new Date('2026-07-26T12:00:00Z');
    const auth = mintRealAuthorization({ capability: 'RUN_BROWSER_COURT', now: nowT, missionId: 'm_end_to_end' });
    const grant = makeGrant({ capability: 'RUN_BROWSER_COURT', budgetUnits: 10,
      authorization: auth.authorization, verifier: auth.verifier, boundAction: auth.boundAction, now: nowT });
    auth.cleanup();
    const intent = { description: 'run the a11y court on /', capability: 'RUN_BROWSER_COURT',
      successTest: 'court exits zero', rollback: 'none required; read-only' };
    const sealed = sealPacket({ contextPacket: ctx, grant, intent, now: nowT });
    assert.equal(sealed.valid, true, `a governed packet must seal from grant+context alone: ${JSON.stringify(sealed.errors)}`);

    const receipt = makeReceipt({ packet: sealed.packet, outcome: { succeeded: true, budgetUsed: 3,
      evidence: [{ observation: 'court exited 0', ref: '/tmp/court.json' }] } });
    assert.equal(receipt.valid, true, `the receipt must close from execution evidence alone: ${JSON.stringify(receipt.errors)}`);
    // The entire authorize->execute->receipt lifecycle referenced ZERO census state.
    assert.equal(receipt.receipt.capability, 'RUN_BROWSER_COURT');
    assert.equal(receipt.receipt.context_digest, ctx.packet_digest);
  });
});

test('COURT 6: OWNER-ONLY effects are refused by the authority plane regardless of any registry ownership', () => {
  // Even if a census capability existed named "deploy production", ownership
  // could never authorize it: OWNER_ONLY effects are refused at the grant layer.
  for (const cap of OWNER_ONLY) {
    const g = makeGrant({ capability: cap, budgetUnits: 1, expiresAt: future, issuedBy: 'CANA' });
    assert.equal(g.valid, false, `${cap} must never be grantable to an agent`);
    assert.ok(g.errors.some((e) => /owner-only/.test(e)));
  }
});

/* ======================================================================== */
/* CROSS-CHECK — the word "capability" means TWO different things, and the    */
/* two meanings must never be silently unified.                               */
/* ======================================================================== */

test('CROSS-CHECK: "capability" in the census (a JOB owner) and "capability" in Hermes (an ACTION grant) are disjoint vocabularies', () => {
  const censusCaps = new Set(loadOwners().map((o) => o.capability));
  const grantCaps = new Set([...CAPABILITIES, ...OWNER_ONLY]);
  const overlap = [...censusCaps].filter((c) => grantCaps.has(c));
  assert.deepEqual(overlap, [],
    `the two "capability" namespaces overlap on ${JSON.stringify(overlap)} — this is the exact conflation the law forbids. ` +
    'A census owner name must never also be a grantable action, or "I own it" would read as "I may do it".');
});
