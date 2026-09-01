import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIONS,
  admitRealityCellLesson,
  assessRealityCellReadiness,
  assignExperimentArm,
  bindRealityCellAuthority,
  createExperienceCandidate,
  createFullFabricAdapter,
  createRealityCellAuthorityBinding,
  digest,
  evaluateChallenger,
  executeExperienceThroughCanonicalAuthority,
  issueRealityCellValueReceipt,
  makeAssignmentReceipt,
  makeExposureReceipt,
  makeOutcomeReceipt,
  makeReceipt,
  preregisterRealityCell,
  proposeRealityCellLesson,
  settleRealityCell,
  validateBrowserObservationReceipt,
  verifyRealityCellPreregistration,
} from '../src/lib/cana-intelligence/index.mjs';
import {
  createRealityCellFixture,
  REALITY_CELL_FIXTURE_SALT,
  runRealityCellFixtureDryRun,
} from '../scripts/reality-cell-0001-dry-run.mjs';

const COMMIT = 'e4f0a890e18996a19b8e155a839cdf79eac88696';
const TREE = '1f3dc355ea26e4e7e9a4eaed86433b969643312a';
const START = new Date('2026-08-24T12:00:00.000Z');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function authorizedFixture() {
  const fixture = createRealityCellFixture({ commit: COMMIT, tree: TREE });
  const binding = await createRealityCellAuthorityBinding({
    experiment: fixture.experiment,
    evidenceAdapter: fixture.store.adapter,
    ownerPrincipalReceiptDigest: fixture.owner.receiptDigest,
    merchantAuthorizationReceiptDigest: fixture.merchantAuthority.receiptDigest,
    now: START,
  });
  return {
    ...fixture,
    binding,
    authorized: bindRealityCellAuthority(fixture.experiment, binding),
  };
}

function appendChain({ store, experiment, unitId = 'fixture-unit-1', index = 1 }) {
  const assignedAt = new Date(START.getTime() + index * 1000);
  const assignment = store.put(makeAssignmentReceipt({
    experiment,
    unitId,
    assignmentSalt: REALITY_CELL_FIXTURE_SALT,
    assignedAt,
    realm: experiment.evidenceRealm,
  }));
  const expected = assignment.payload.arm === 'TREATMENT'
    ? experiment.treatmentDefinition
    : experiment.controlDefinition;
  const exposure = store.put(makeExposureReceipt({
    experiment,
    assignmentReceipt: assignment,
    exposed: true,
    exposureEvidenceDigest: digest({ index, event: 'exposure' }, 'test-exposure'),
    actualExperienceVersion: expected.experienceVersion,
    candidateDigest: expected.candidateDigest,
    routeSurface: '/fixture/private/reality-cell-0001',
    observedAt: new Date(assignedAt.getTime() + 60_000),
    independentObserverSource: 'independent-test-observer',
    treatmentExecutorSource: 'test-executor',
    realm: experiment.evidenceRealm,
  }));
  const outcome = store.put(makeOutcomeReceipt({
    experiment,
    exposureReceipt: exposure,
    metric: experiment.primaryMetric.id,
    observedValue: assignment.payload.arm === 'TREATMENT',
    observedAt: new Date(assignedAt.getTime() + 120_000),
    source: 'independent-test-outcome',
    outcomeEvidenceDigest: digest({ index, event: 'outcome' }, 'test-outcome'),
    realm: experiment.evidenceRealm,
  }));
  return { assignment, exposure, outcome };
}

async function settleLedger(fixture, ledger) {
  fixture.store.ledgers.set(fixture.authorized.experimentId, ledger);
  return settleRealityCell(fixture.authorized, fixture.store.adapter, { now: new Date('2026-08-24T16:00:00.000Z') });
}

test('Reality Cell fixture dry run traverses the full chain without real effects', async () => {
  const result = await runRealityCellFixtureDryRun({ commit: COMMIT, tree: TREE });
  assert.equal(result.result, 'VERIFIED');
  assert.equal(result.evidenceRealm, 'FIXTURE');
  assert.equal(result.settlement.classification, 'CAUSAL_SUPPORTED');
  assert.equal(result.settlement.realWorldClaim, false);
  assert.equal(result.economics.status, 'SIMULATED_FIXTURE_ONLY');
  assert.equal(result.economics.realEconomicValueEstablished, false);
  assert.equal(result.lessonAdmissionBoundary.status, 'REJECTED_FIXTURE_BOUNDARY');
  assert.equal(result.lessonAdmissionBoundary.trusted, false);
  assert.equal(result.realCustomerExposure, 0);
  assert.equal(result.realMerchantExposure, 0);
  assert.equal(result.productionEffects, 0);
  assert.equal(result.realRsi, 'NOT_ESTABLISHED');
});

test('assignment sanity covers 50/50, unequal allocation, repeatability, salt, unit, and invalid experiment', () => {
  const fixture = createRealityCellFixture({ commit: COMMIT, tree: TREE });
  let treatment = 0;
  const total = 20_000;
  for (let index = 0; index < total; index += 1) {
    if (assignExperimentArm(fixture.experiment, `unit-${index}`, REALITY_CELL_FIXTURE_SALT).arm === 'TREATMENT') treatment += 1;
  }
  assert.ok(Math.abs(treatment / total - 0.5) < 0.02);
  const unequal = preregisterRealityCell({ ...fixture.experiment, allocation: { control: 0.25, treatment: 0.75 } });
  let unequalTreatment = 0;
  for (let index = 0; index < total; index += 1) {
    if (assignExperimentArm(unequal, `unit-${index}`, REALITY_CELL_FIXTURE_SALT).arm === 'TREATMENT') unequalTreatment += 1;
  }
  assert.ok(Math.abs(unequalTreatment / total - 0.75) < 0.02);
  const first = assignExperimentArm(fixture.experiment, 'stable-unit', REALITY_CELL_FIXTURE_SALT);
  const repeat = assignExperimentArm(fixture.experiment, 'stable-unit', REALITY_CELL_FIXTURE_SALT);
  assert.deepEqual(repeat, first);
  assert.notEqual(assignExperimentArm(fixture.experiment, 'different-unit', REALITY_CELL_FIXTURE_SALT).unitHash, first.unitHash);
  assert.throws(() => assignExperimentArm(fixture.experiment, 'stable-unit', 'different-salt-123456789'), /commitment mismatch/);
  assert.throws(() => assignExperimentArm({}, 'stable-unit', REALITY_CELL_FIXTURE_SALT), /preregistered/);
});

test('attack 01 forged Owner principal fails closed', async () => {
  const fixture = createRealityCellFixture({ commit: COMMIT, tree: TREE });
  const forged = fixture.store.put(makeReceipt({
    kind: 'PRINCIPAL', subjectDigest: digest({ subject: 'attacker' }, 'principal-subject'), realm: 'FIXTURE', issuer: 'attacker',
    payload: { verified: true, subject: 'attacker', allowedActions: [ACTIONS.AUTHORIZE_REALITY_CELL], fixtureOnly: true },
  }));
  await assert.rejects(() => createRealityCellAuthorityBinding({
    experiment: fixture.experiment,
    evidenceAdapter: fixture.store.adapter,
    ownerPrincipalReceiptDigest: forged.receiptDigest,
    merchantAuthorizationReceiptDigest: fixture.merchantAuthority.receiptDigest,
    now: START,
  }), /lineage invalid/);
});

test('attack 02 forged merchant authority fails closed', async () => {
  const fixture = createRealityCellFixture({ commit: COMMIT, tree: TREE });
  const forged = fixture.store.put(makeReceipt({
    kind: 'MERCHANT_AUTHORIZATION', subjectDigest: fixture.experiment.preregistrationDigest, realm: 'FIXTURE', issuer: 'attacker',
    payload: { authority: 'OWNER_AUTHORIZED' },
  }));
  await assert.rejects(() => createRealityCellAuthorityBinding({
    experiment: fixture.experiment,
    evidenceAdapter: fixture.store.adapter,
    ownerPrincipalReceiptDigest: fixture.owner.receiptDigest,
    merchantAuthorizationReceiptDigest: forged.receiptDigest,
    now: START,
  }), /merchant authority lineage/);
});

test('attack 03 forged browser receipt fails closed', () => {
  const forged = makeReceipt({
    kind: 'BROWSER_OBSERVATION', subjectDigest: 'candidate:forged', realm: 'FIXTURE', issuer: 'attacker',
    payload: { route: '/', candidateDigest: 'candidate:forged', browserCaptured: true },
  });
  assert.throws(() => validateBrowserObservationReceipt(forged), /commit required/);
});

test('attack 04 replayed promotion receipt fails closed', async () => {
  const receipts = new Map();
  const candidate = createExperienceCandidate({ objective: 'fixture', target: '/', operations: [{ type: 'UPDATE_LAYOUT' }], proposer: 'test' });
  const principal = makeReceipt({
    kind: 'PRINCIPAL', subjectDigest: 'owner', realm: 'VERIFIED_LOCAL', issuer: 'canonical-auth',
    payload: { verified: true, subject: 'owner', allowedActions: [ACTIONS.EXECUTE_EXPERIENCE_CANDIDATE] },
  });
  const promotion = makeReceipt({
    kind: 'PROMOTION', subjectDigest: candidate.candidateDigest, realm: 'VERIFIED_LOCAL', issuer: 'promotion-court',
    payload: { candidateDigest: candidate.candidateDigest, principalReceiptDigest: principal.receiptDigest, allowedEffectSet: ['UPDATE_LAYOUT'] },
  });
  receipts.set(principal.receiptDigest, principal);
  receipts.set(promotion.receiptDigest, promotion);
  let claimed = false;
  const adapter = createFullFabricAdapter({
    enumerateExperienceSurfaces: async () => [], loadExperienceManifest: async () => null,
    persistExperienceCandidate: async () => null, renderPrivatePreview: async () => null,
    captureRenderedEvidenceReceipt: async () => null, generateMediaCandidate: async () => null,
    loadReceipt: async (receiptDigest) => receipts.get(receiptDigest) ?? null,
    resolveVerifiedPrincipalReceipt: async () => principal.receiptDigest,
    executeWithPromotionClaim: async ({ executionInput }) => {
      if (claimed) throw new Error('PROMOTION_REPLAYED');
      claimed = true;
      return executionInput;
    },
    rollbackExperienceVersion: async () => null,
  });
  await executeExperienceThroughCanonicalAuthority(adapter, { candidate, principalReceiptDigest: principal.receiptDigest, promotionReceiptDigest: promotion.receiptDigest });
  await assert.rejects(() => executeExperienceThroughCanonicalAuthority(adapter, { candidate, principalReceiptDigest: principal.receiptDigest, promotionReceiptDigest: promotion.receiptDigest }), /PROMOTION_REPLAYED/);
});

test('attack 05 candidate digest mismatch fails closed', () => {
  const fixture = createRealityCellFixture({ commit: COMMIT, tree: TREE });
  const wrong = { ...fixture.candidate, candidateDigest: `experience_candidate:${'f'.repeat(64)}` };
  assert.equal(assessRealityCellReadiness({ experiment: fixture.experiment, candidate: wrong }).status, 'NOT_READY');
});

test('attack 06 post-hoc preregistration change fails closed', () => {
  const fixture = createRealityCellFixture({ commit: COMMIT, tree: TREE });
  const changed = { ...clone(fixture.experiment), hypothesis: 'post-hoc replacement' };
  assert.throws(() => verifyRealityCellPreregistration(changed), /mutation detected/);
});

test('attack 07 lowered sample threshold fails closed', async () => {
  const fixture = await authorizedFixture();
  const lowered = { ...clone(fixture.authorized), minimumSample: { perArm: 1 }, minimumPerArm: 1 };
  const result = await settleRealityCell(lowered, fixture.store.adapter, { now: START });
  assert.equal(result.classification, 'INVALID_EXPERIMENT');
});

test('attack 08 assignment tampering fails closed', async () => {
  const fixture = await authorizedFixture();
  const chain = appendChain(fixture);
  fixture.store.receipts.set(chain.assignment.receiptDigest, { ...clone(chain.assignment), payload: { ...chain.assignment.payload, arm: chain.assignment.payload.arm === 'CONTROL' ? 'TREATMENT' : 'CONTROL' } });
  const result = await settleLedger(fixture, { assignments: [chain.assignment.receiptDigest], exposures: [chain.exposure.receiptDigest], outcomes: [chain.outcome.receiptDigest] });
  assert.equal(result.classification, 'INVALID_EXPERIMENT');
});

test('attack 09 duplicate assignment fails closed', async () => {
  const fixture = await authorizedFixture();
  const chain = appendChain(fixture);
  const result = await settleLedger(fixture, { assignments: [chain.assignment.receiptDigest, chain.assignment.receiptDigest], exposures: [chain.exposure.receiptDigest], outcomes: [chain.outcome.receiptDigest] });
  assert.equal(result.classification, 'INVALID_EXPERIMENT');
});

test('attack 10 fake exposure fails closed', async () => {
  const fixture = await authorizedFixture();
  const assignment = fixture.store.put(makeAssignmentReceipt({ experiment: fixture.authorized, unitId: 'u', assignmentSalt: REALITY_CELL_FIXTURE_SALT, assignedAt: START, realm: 'FIXTURE' }));
  assert.throws(() => makeExposureReceipt({ experiment: fixture.authorized, assignmentReceipt: assignment, exposed: false, exposureEvidenceDigest: 'fake' }), /only verified exposure/);
});

test('attack 11 deployment mistaken for exposure fails closed', async () => {
  const fixture = await authorizedFixture();
  const chain = appendChain(fixture);
  const deployment = fixture.store.put(makeReceipt({
    kind: 'EXPOSURE', subjectDigest: fixture.authorized.preregistrationDigest, realm: 'FIXTURE', issuer: 'deployer',
    payload: { deploymentDigest: 'deployment-only', exposed: true },
  }));
  const result = await settleLedger(fixture, { assignments: [chain.assignment.receiptDigest], exposures: [deployment.receiptDigest], outcomes: [] });
  assert.equal(result.classification, 'INVALID_EXPERIMENT');
});

test('attack 12 outcome before exposure fails closed', async () => {
  const fixture = await authorizedFixture();
  const chain = appendChain(fixture);
  assert.throws(() => makeOutcomeReceipt({
    experiment: fixture.authorized, exposureReceipt: chain.exposure, metric: fixture.authorized.primaryMetric.id,
    observedValue: true, observedAt: START, source: 'attacker', outcomeEvidenceDigest: 'before-exposure', realm: 'FIXTURE',
  }), /precedes exposure/);
});

test('attack 13 duplicate outcome fails closed', async () => {
  const fixture = await authorizedFixture();
  const chain = appendChain(fixture);
  const result = await settleLedger(fixture, { assignments: [chain.assignment.receiptDigest], exposures: [chain.exposure.receiptDigest], outcomes: [chain.outcome.receiptDigest, chain.outcome.receiptDigest] });
  assert.equal(result.classification, 'INVALID_EXPERIMENT');
});

test('attack 14 synthetic outcome inserted into governed court fails closed', async () => {
  const fixture = await authorizedFixture();
  const chain = appendChain(fixture);
  const synthetic = makeReceipt({
    kind: 'OUTCOME', subjectDigest: fixture.authorized.preregistrationDigest, realm: 'SIMULATED', issuer: 'simulator',
    payload: { ...chain.outcome.payload, evidenceRealm: 'SIMULATED', outcomeEvidenceDigest: 'simulated-replay' },
  });
  fixture.store.put(synthetic);
  const result = await settleLedger(fixture, { assignments: [chain.assignment.receiptDigest], exposures: [chain.exposure.receiptDigest], outcomes: [synthetic.receiptDigest] });
  assert.equal(result.classification, 'INVALID_EXPERIMENT');
});

test('attack 15 treatment/control swap fails closed', async () => {
  const fixture = await authorizedFixture();
  const assignment = fixture.store.put(makeAssignmentReceipt({ experiment: fixture.authorized, unitId: 'swap', assignmentSalt: REALITY_CELL_FIXTURE_SALT, assignedAt: START, realm: 'FIXTURE' }));
  const wrong = assignment.payload.arm === 'TREATMENT' ? fixture.authorized.controlDefinition : fixture.authorized.treatmentDefinition;
  assert.throws(() => makeExposureReceipt({
    experiment: fixture.authorized, assignmentReceipt: assignment, exposed: true, exposureEvidenceDigest: 'swap',
    actualExperienceVersion: wrong.experienceVersion, candidateDigest: wrong.candidateDigest,
    routeSurface: '/fixture/private/reality-cell-0001', observedAt: new Date(START.getTime() + 1),
    independentObserverSource: 'observer', treatmentExecutorSource: 'executor', realm: 'FIXTURE',
  }), /assigned arm/);
});

test('attack 16 cross-tenant receipt fails closed', async () => {
  const fixture = createRealityCellFixture({ commit: COMMIT, tree: TREE });
  const wrongTenant = fixture.store.put(makeReceipt({
    ...fixture.merchantAuthority,
    kind: 'MERCHANT_AUTHORIZATION', subjectDigest: fixture.experiment.preregistrationDigest,
    realm: 'FIXTURE', issuer: 'fixture-merchant-authority-not-real',
    payload: { ...fixture.merchantAuthority.payload, tenantId: 'different-tenant' },
  }));
  await assert.rejects(() => createRealityCellAuthorityBinding({
    experiment: fixture.experiment, evidenceAdapter: fixture.store.adapter,
    ownerPrincipalReceiptDigest: fixture.owner.receiptDigest,
    merchantAuthorizationReceiptDigest: wrongTenant.receiptDigest, now: START,
  }), /tenant authorization mismatch/);
});

test('attack 17 stale receipt fails closed', async () => {
  const fixture = createRealityCellFixture({ commit: COMMIT, tree: TREE });
  const stale = fixture.store.put(makeReceipt({
    kind: 'MERCHANT_AUTHORIZATION', subjectDigest: fixture.experiment.preregistrationDigest,
    realm: 'FIXTURE', issuer: 'fixture-merchant-authority-not-real', issuedAt: '2026-08-23T00:00:00Z', expiresAt: '2026-08-23T01:00:00Z',
    payload: { ...fixture.merchantAuthority.payload, expiresAt: '2026-08-23T01:00:00.000Z' },
  }));
  await assert.rejects(() => createRealityCellAuthorityBinding({
    experiment: fixture.experiment, evidenceAdapter: fixture.store.adapter,
    ownerPrincipalReceiptDigest: fixture.owner.receiptDigest,
    merchantAuthorizationReceiptDigest: stale.receiptDigest, now: START,
  }), /expired/);
});

test('attack 18 receipt from different experiment fails closed', async () => {
  const fixture = await authorizedFixture();
  const chain = appendChain(fixture);
  const foreign = fixture.store.put(makeReceipt({
    kind: 'OUTCOME', subjectDigest: fixture.authorized.preregistrationDigest, realm: 'FIXTURE', issuer: 'observer',
    payload: { ...chain.outcome.payload, experimentId: 'different-experiment', outcomeEvidenceDigest: 'foreign-experiment' },
  }));
  const result = await settleLedger(fixture, { assignments: [chain.assignment.receiptDigest], exposures: [chain.exposure.receiptDigest], outcomes: [foreign.receiptDigest] });
  assert.equal(result.classification, 'INVALID_EXPERIMENT');
});

test('attack 19 Goodhart metric improvement with guardrail harm settles HARM', async () => {
  const fixture = await authorizedFixture();
  const assignments = [];
  const exposures = [];
  const outcomes = [];
  for (let index = 0; index < 240; index += 1) {
    const chain = appendChain({ ...fixture, unitId: `goodhart-${index}`, index });
    assignments.push(chain.assignment.receiptDigest);
    exposures.push(chain.exposure.receiptDigest);
    const harm = fixture.store.put(makeOutcomeReceipt({
      experiment: fixture.authorized, exposureReceipt: chain.exposure, metric: 'misleading_information_rate',
      observedValue: chain.assignment.payload.arm === 'TREATMENT' ? 0.25 : 0.01,
      observedAt: new Date(START.getTime() + index * 1000 + 121_000), source: 'accuracy-observer',
      outcomeEvidenceDigest: digest({ index, metric: 'harm' }, 'test-outcome'), realm: 'FIXTURE',
    }));
    outcomes.push(chain.outcome.receiptDigest, harm.receiptDigest);
  }
  const result = await settleLedger(fixture, { assignments, exposures, outcomes });
  assert.equal(result.classification, 'HARM');
  assert.equal(result.guardrailResults[0].harmDetected, true);
});

test('attack 20 fabricated AOV or revenue cannot become economic value', async () => {
  const fixture = createRealityCellFixture({ commit: COMMIT, tree: TREE });
  const payload = {
    experimentId: fixture.experiment.experimentId, merchantId: fixture.experiment.merchantId,
    tenantId: fixture.experiment.tenantId, preregistrationDigest: fixture.experiment.preregistrationDigest,
    treatmentCandidateDigest: fixture.experiment.treatmentDefinition.candidateDigest,
    rollbackContractDigest: fixture.experiment.rollbackContract.digest,
    classification: 'CAUSAL_SUPPORTED', evidenceRealm: 'FIXTURE', counts: { verifiedExposures: 100 },
    evidenceDigests: { exposures: [] }, guardrailResults: [], claimCeiling: 'CAUSAL_EFFECT', sufficient: true,
  };
  const receipt = fixture.store.put(makeReceipt({
    kind: 'EXPERIMENT_SETTLEMENT', subjectDigest: fixture.experiment.preregistrationDigest,
    realm: 'FIXTURE', issuer: 'settlement', payload,
  }));
  const settlement = { ...payload, status: 'SETTLED', settlementDigest: receipt.receiptDigest, receipt };
  const value = await issueRealityCellValueReceipt({
    settlement,
    intervention: {
      candidateDigest: fixture.experiment.treatmentDefinition.candidateDigest,
      description: 'fixture',
      rollbackContract: fixture.experiment.rollbackContract,
    },
    economicObservationReceiptDigests: [],
    economics: { fabricatedAovUsd: 100, fabricatedRevenueUsd: 1000000 }, evidenceAdapter: fixture.store.adapter,
  });
  assert.equal(value.economicStatus, 'UNMEASURED');
  assert.equal(value.economicEffectUsd, null);
  assert.equal(value.realEconomicValueEstablished, false);
});

test('attack 20b caller settlement projection cannot upgrade canonical NULL into economic value', async () => {
  const fixture = createRealityCellFixture({ commit: COMMIT, tree: TREE });
  const canonicalPayload = {
    experimentId: fixture.experiment.experimentId,
    merchantId: fixture.experiment.merchantId,
    tenantId: fixture.experiment.tenantId,
    preregistrationDigest: fixture.experiment.preregistrationDigest,
    treatmentCandidateDigest: fixture.experiment.treatmentDefinition.candidateDigest,
    rollbackContractDigest: fixture.experiment.rollbackContract.digest,
    classification: 'NULL',
    evidenceRealm: 'VERIFIED_REAL',
    counts: { verifiedExposures: 100 },
    evidenceDigests: { exposures: [] },
    guardrailResults: [],
    claimCeiling: 'ECONOMIC_EFFECT',
    sufficient: true,
    effectEstimate: { lift: 0 },
    limitations: ['Canonical settlement found no causal effect'],
  };
  const canonicalReceipt = fixture.store.put(makeReceipt({
    kind: 'EXPERIMENT_SETTLEMENT',
    subjectDigest: fixture.experiment.preregistrationDigest,
    realm: 'VERIFIED_REAL',
    issuer: 'canonical-reality-cell-settlement',
    payload: canonicalPayload,
  }));
  const metrics = [
    ['INCREMENTAL_MARGIN_USD', 100],
    ['DISCOUNT_COST_USD', 0],
    ['MEDIA_COST_USD', 0],
    ['FULFILLMENT_COST_USD', 0],
    ['PLATFORM_COST_USD', 0],
    ['OTHER_DIRECT_COST_USD', 0],
  ];
  const economicObservationReceiptDigests = metrics.map(([metric, value]) => fixture.store.put(makeReceipt({
    kind: 'ECONOMIC_OBSERVATION',
    subjectDigest: canonicalReceipt.receiptDigest,
    realm: 'VERIFIED_REAL',
    issuer: 'canonical-economic-observer',
    payload: { metric, value, source: 'verified-ledger', observedAt: START.toISOString() },
  })).receiptDigest);
  const forgedProjection = {
    ...canonicalPayload,
    classification: 'CAUSAL_SUPPORTED',
    status: 'SETTLED',
    settlementDigest: canonicalReceipt.receiptDigest,
    receipt: canonicalReceipt,
  };
  await assert.rejects(
    () => issueRealityCellValueReceipt({
      settlement: forgedProjection,
      intervention: {
        candidateDigest: fixture.experiment.treatmentDefinition.candidateDigest,
        description: 'caller-forged causal projection',
        rollbackContract: fixture.experiment.rollbackContract,
      },
      economicObservationReceiptDigests,
      evidenceAdapter: fixture.store.adapter,
    }),
    (error) => error?.code === 'VALUE_SETTLEMENT_PROJECTION_MISMATCH',
  );
});

test('attack 21 lesson admission without causal support fails closed', async () => {
  const fixture = createRealityCellFixture({ commit: COMMIT, tree: TREE });
  const valueReceipt = fixture.store.put(makeReceipt({
    kind: 'VALUE', subjectDigest: 'settlement:null', realm: 'FIXTURE', issuer: 'value-court',
    payload: { settlementClassification: 'NULL', realEconomicValueEstablished: false },
  }));
  const lesson = proposeRealityCellLesson({
    claim: 'unsupported', scope: 'fixture', context: {}, proposerId: 'proposer',
    valueReceipt: { receiptDigest: valueReceipt.receiptDigest, settlementDigest: 'settlement:null', settlementClassification: 'NULL', evidenceRealm: 'FIXTURE' },
  });
  const verifier = fixture.store.put(makeReceipt({
    kind: 'VERIFIER', subjectDigest: lesson.lessonDigest, realm: 'FIXTURE', issuer: 'verifier',
    payload: { verifierId: 'independent-verifier', verdict: 'ADMIT' },
  }));
  const result = await admitRealityCellLesson(lesson, {
    verifierReceiptDigest: verifier.receiptDigest,
    principalReceiptDigest: fixture.owner.receiptDigest,
    now: START,
  }, fixture.store.adapter);
  assert.equal(result.trusted, false);
  assert.match(result.status, /^REJECTED/);
});

test('attack 22 RSI attempt using caller-supplied trusted flag fails closed', async () => {
  const fixture = createRealityCellFixture({ commit: COMMIT, tree: TREE });
  const adapter = {
    ...fixture.store.adapter,
    loadLesson: async () => ({
      lessonId: 'caller-forged', lessonDigest: 'forged', trusted: true, status: 'ADMITTED',
      causalStatus: 'CAUSAL_SUPPORTED', admissionDigest: 'caller-admitted', valueReceiptDigest: 'caller-value', settlementDigest: 'caller-settlement',
    }),
  };
  await assert.rejects(() => evaluateChallenger({
    incumbent: { version: 1 }, challenger: { version: 2 }, lessonId: 'caller-forged', cases: [1],
    evaluator: async () => ({ score: 1, criticalRegressions: 0 }),
    ablator: async () => ({ lessonContributionEstablished: true, lessonId: 'caller-forged' }),
    verifierId: 'verifier', proposerId: 'proposer', evidenceAdapter: adapter,
    principalReceiptDigest: fixture.owner.receiptDigest,
  }), /canonical receipt not found/);
});
