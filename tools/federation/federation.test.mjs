// FEDERATION GATE A + B court — exercised with REAL data from this
// continuation (the governor-kernel donor and the actual extraction task),
// not synthetic toys. Adversarial cases prove the gates fail closed.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  makeCapabilityGene, makeGeneComplex, makeDonorGenome, makeDonorPreservationContract,
  PROOF_STATES,
} from './genome.mjs';
import {
  makeAgentPassport, makeTaskContract, makeResultContract, OWNER_GATED_ACTIONS,
} from './contracts.mjs';

/* ------------------------------------------------ real donor: rsi-sitemind-core */
const governorGene = makeCapabilityGene({
  mechanism: 'pure-function authorization validation over three signed artifacts (ActionContract, AuthorizationGrant, WorkerCapability) with 25+ deny-reason checks and no network access',
  fundamentalJob: 'refuse unauthorized action before execution',
  capabilityContribution: 'pre-execution authority gate reusable by any multi-tenant agentic system',
  dependencies: ['signed dataclasses (models.py)', 'key registry (crypto.py)'],
  failureModes: ['DEV_TAMPER_EVIDENT signing: privileged local process can re-sign a forged chain (KMS interface unwired)'],
  authorityImplications: 'governor is judge only; it must never gain execution capability',
  evidence: [
    { ref: 'packages/governor-kernel/receipts/sitemind-tests.txt', grade: 'DIRECT_OBSERVATION' },
    { ref: 'packages/governor-kernel/receipts/attack-court.txt', grade: 'EXPERIMENTALLY_SUPPORTED' },
  ],
  sourceLineage: 'RSI-main/repos/rsi-sitemind-core @ princeleuel1-ops/RSI a6410cd (archive set 2026-08-18)',
  currentState: 'VERIFIED_IMPLEMENTED',
});

const ledgerGene = makeCapabilityGene({
  mechanism: 'append-only hash-chained receipt ledger where each receipt embeds SHA-256 of its predecessor, with full-chain replay verification',
  fundamentalJob: 'make execution history tamper-evident',
  capabilityContribution: 'audit substrate for promotion and rollback decisions',
  failureModes: ['tamper-evident, not tamper-proof: chain re-signing possible with local key custody'],
  evidence: [{ ref: 'packages/governor-kernel/receipts/sitemind-tests.txt', grade: 'DIRECT_OBSERVATION' }],
  sourceLineage: 'rsi-sitemind-core ledger.py (75 lines)',
  currentState: 'VERIFIED_IMPLEMENTED',
});

const promotionGene = makeCapabilityGene({
  mechanism: 'linear no-skip promotion state machine PROPOSED->VALIDATED->SHADOW->CANARY->PROMOTED with receipt-bound transitions',
  fundamentalJob: 'prevent unvalidated candidates from reaching canonical state',
  capabilityContribution: 'promotion court semantics shared with skills-src/cana-signal-to-fix.mjs PROMOTION_STAGES',
  failureModes: ['stage semantics are only as strong as the evidence bound at each transition'],
  evidence: [{ ref: 'packages/governor-kernel/receipts/sitemind-tests.txt', grade: 'DIRECT_OBSERVATION' }],
  sourceLineage: 'rsi-sitemind-core promotion.py (49 lines)',
  currentState: 'VERIFIED_IMPLEMENTED',
});

test('GATE A: real genes from the governor-kernel donor validate', () => {
  for (const g of [governorGene, ledgerGene, promotionGene]) {
    assert.equal(g.valid, true, JSON.stringify(g.errors));
    assert.match(g.gene_id, /^gene_[0-9a-f]{16}$/);
  }
});

test('GATE A: VERIFIED_IMPLEMENTED without strong evidence is refused', () => {
  const bogus = makeCapabilityGene({
    mechanism: 'm', fundamentalJob: 'j', capabilityContribution: 'c', failureModes: [],
    evidence: [{ ref: 'somewhere.md', grade: 'DONOR_CLAIM' }],
    currentState: 'VERIFIED_IMPLEMENTED',
  });
  assert.equal(bogus.valid, false);
  assert.ok(bogus.errors.some((e) => e.includes('VERIFIED_IMPLEMENTED requires')));
});

test('GATE A: gene complex binds entangled genes and refuses invalid members', () => {
  const cplx = makeGeneComplex({
    genes: [governorGene, ledgerGene],
    entanglement: 'governor decisions are only auditable when every decision lands in the hash-chained ledger; transferring the governor without the ledger loses attributability',
  });
  assert.equal(cplx.valid, true);
  const bad = makeGeneComplex({ genes: [governorGene, makeCapabilityGene({})], entanglement: 'x' });
  assert.equal(bad.valid, false);
});

test('GATE A: donor genome requires declared unknowns and a preservation contract holds checkable properties', () => {
  const dpc = makeDonorPreservationContract({
    donorId: 'rsi-sitemind-core',
    mustPreserve: [
      { property: '17/17 pytest suite passes', checkedBy: 'packages/governor-kernel/sitemind-core: python3 -m pytest tests/ -q' },
      { property: '19/19 adversarial attack court passes', checkedBy: 'packages/governor-kernel/sitemind-core: run_attack_court.py' },
    ],
  });
  assert.equal(dpc.valid, true);
  const genome = makeDonorGenome({
    donorId: 'rsi-sitemind-core',
    donorVersion: 'archive-2026-08-18',
    fundamentalJob: 'evidence-governed authorization control plane',
    genes: [governorGene, ledgerGene, promotionGene],
    unknowns: ['whether the protected RSI SiteMind source matches this baseline (its own SOURCE_IDENTITY.md: NOT ESTABLISHED)'],
    governingBottleneck: 'signing trust: DEV_TAMPER_EVIDENT local HMAC; KMS unwired',
    preservationContract: dpc,
    sourceProvenance: 'ALL_THE_RSI_AND_ORDERWEEDDC_REPOS parts 1-2, sha256 829309e0…/070dc068…',
  });
  assert.equal(genome.valid, true, JSON.stringify(genome.errors));
  const noUnknowns = makeDonorGenome({ donorId: 'x', fundamentalJob: 'j', genes: [governorGene], sourceProvenance: 's' });
  assert.equal(noUnknowns.valid, false, 'a genome with undeclared unknowns must fail');
});

test('GATE A: unverifiable preservation contract fails closed', () => {
  const wish = makeDonorPreservationContract({ donorId: 'd', mustPreserve: [{ property: 'stays good' }] });
  assert.equal(wish.valid, false);
});

/* ------------------------------------------- real passports: the five lanes */
const lane = (agentId, roleFamily, capabilities, level) => makeAgentPassport({
  agentId, roleFamily, capabilities,
  authorityLevel: level,
  forbiddenActions: [...OWNER_GATED_ACTIONS],
  costCeilingUsd: 5,
  memoryReadScope: ['winner-memory', 'slow-memory'],
  memoryWriteScope: roleFamily === 'verification' ? [] : ['cycle-receipts'],
});

const lanes = [
  lane('lane-strategy', 'strategy', ['objective-ranking', 'mission-compilation'], 'PROPOSER'),
  lane('lane-truth', 'truth-research', ['source-recovery', 'evidence-grading'], 'PROPOSER'),
  lane('lane-implementation', 'implementation', ['code-change', 'test-authoring', 'governor-kernel-extraction'], 'LOCAL_EXECUTOR'),
  lane('lane-verification', 'verification', ['adversarial-testing', 'court-running'], 'OBSERVER'),
  lane('lane-release', 'release-judgment', ['promotion-judgment'], 'LANE_SUPERVISOR'),
];

test('GATE B: five-lane passports validate; owner-gated actions are forbidden on every one', () => {
  for (const p of lanes) {
    assert.equal(p.valid, true, JSON.stringify(p.errors));
    for (const a of OWNER_GATED_ACTIONS) assert.ok(p.forbidden_actions.includes(a));
  }
});

test('GATE B: a passport that omits even one owner gate is refused', () => {
  const leaky = makeAgentPassport({
    agentId: 'sneaky', roleFamily: 'implementation', capabilities: ['code-change'],
    authorityLevel: 'LOCAL_EXECUTOR',
    forbiddenActions: OWNER_GATED_ACTIONS.filter((a) => a !== 'deploy_production'),
    costCeilingUsd: 1,
  });
  assert.equal(leaky.valid, false);
  assert.ok(leaky.errors.some((e) => e.includes('deploy_production')));
});

/* --------------------------- real task: the governor-kernel extraction run */
test('GATE B: the real extraction task validates against the implementation lane', () => {
  const task = makeTaskContract({
    missionId: 'federation-continuation-2026-08-18',
    goal: 'extract the RSI governor kernel into packages/governor-kernel with locally reproduced receipts',
    requiredCapability: 'governor-kernel-extraction',
    passport: lanes[2],
    expectedArtifact: 'packages/governor-kernel/** + receipts',
    successPredicate: '17/17 pytest AND 35/35 unittest AND 19/19 attack court, receipts bound to base SHA',
    stopRule: 'stop after receipts captured or any suite fails twice',
    rollbackExpectation: 'git revert of the single additive commit restores the pre-slice tree',
    costBudgetUsd: 2,
  });
  assert.equal(task.valid, true, JSON.stringify(task.errors));
  const result = makeResultContract({
    task,
    artifact: 'commit 5327136 packages/governor-kernel/**',
    evidence: [
      { ref: 'packages/governor-kernel/receipts/sitemind-tests.txt' },
      { ref: 'packages/governor-kernel/receipts/standalone-tests.txt' },
      { ref: 'packages/governor-kernel/receipts/attack-court.txt' },
    ],
    uncertainty: 'suites ran on Python 3.9 despite the donor declaring >=3.11; behavior on 3.11+ is SUPPORTED_INFERENCE only',
    failedChecks: [],
    costUsd: 0,
  });
  assert.equal(result.valid, true, JSON.stringify(result.errors));
});

test('GATE B: capability gate — the truth lane cannot take the extraction task', () => {
  const t = makeTaskContract({
    missionId: 'm', goal: 'g', requiredCapability: 'governor-kernel-extraction',
    passport: lanes[1], expectedArtifact: 'a', successPredicate: 's', stopRule: 'stop',
    rollbackExpectation: 'revert', costBudgetUsd: 1,
  });
  assert.equal(t.valid, false);
  assert.ok(t.errors.some((e) => e.includes('CAPABILITY GATE')));
});

test('GATE B: authority gate — requesting an owner-gated action invalidates the task even for a supervisor', () => {
  const t = makeTaskContract({
    missionId: 'm', goal: 'ship it', requiredCapability: 'promotion-judgment',
    passport: lanes[4], requestedActions: ['merge_pr'],
    expectedArtifact: 'a', successPredicate: 's', stopRule: 'stop',
    rollbackExpectation: 'revert', costBudgetUsd: 1,
  });
  assert.equal(t.valid, false);
  assert.ok(t.errors.some((e) => e.includes('AUTHORITY GATE')));
});

test('GATE B: budget gate — a task cannot exceed its passport ceiling', () => {
  const t = makeTaskContract({
    missionId: 'm', goal: 'g', requiredCapability: 'code-change',
    passport: lanes[2], expectedArtifact: 'a', successPredicate: 's', stopRule: 'stop',
    rollbackExpectation: 'revert', costBudgetUsd: 50,
  });
  assert.equal(t.valid, false);
  assert.ok(t.errors.some((e) => e.includes('BUDGET GATE')));
});

test('GATE B: an evidence-free result is a claim, not a result', () => {
  const task = makeTaskContract({
    missionId: 'm', goal: 'g', requiredCapability: 'code-change',
    passport: lanes[2], expectedArtifact: 'a', successPredicate: 's', stopRule: 'stop',
    rollbackExpectation: 'revert', costBudgetUsd: 1,
  });
  const r = makeResultContract({ task, artifact: 'thing', evidence: [], failedChecks: [], costUsd: 0, uncertainty: 'none' });
  assert.equal(r.valid, false);
});

test('vocabulary: proof states match the canonical repo labels exactly', () => {
  assert.deepEqual(
    PROOF_STATES,
    ['VERIFIED_IMPLEMENTED', 'PARTIALLY_IMPLEMENTED', 'PLANNED', 'RESEARCH_ONLY', 'BLOCKED', 'FALSIFIED', 'UNKNOWN', 'NOT_ESTABLISHED'],
  );
});
