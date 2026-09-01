import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  ACTIONS,
  admitRealityCellLesson,
  assessRealityCellReadiness,
  bindRealityCellAuthority,
  commitmentForSalt,
  createExperienceCandidate,
  createFullFabricAdapter,
  createRealityCellAuthorityBinding,
  digest,
  experiencePromotionCourt,
  issueRealityCellValueReceipt,
  makeAssignmentReceipt,
  makeExposureReceipt,
  makeOutcomeReceipt,
  makeReceipt,
  preregisterRealityCell,
  proposeRealityCellLesson,
  settleRealityCell,
} from '../src/lib/cana-intelligence/index.mjs';
import { buildManifest } from '../src/lib/experience/manifest.mjs';

const FIXTURE_REALM = 'FIXTURE';
export const REALITY_CELL_FIXTURE_SALT = 'reality-cell-0001-fixture-salt';
const START = '2026-08-24T12:00:00.000Z';
const END = '2026-08-25T12:00:00.000Z';
const EXPIRES = '2026-08-25T11:00:00.000Z';

function fixtureStore() {
  const receipts = new Map();
  const lessons = new Map();
  const ledgers = new Map();
  return {
    receipts,
    lessons,
    ledgers,
    put(receipt) {
      receipts.set(receipt.receiptDigest, receipt);
      return receipt;
    },
    adapter: {
      loadReceipt: async (receiptDigest) => receipts.get(receiptDigest) ?? null,
      loadLesson: async (lessonId) => lessons.get(lessonId) ?? null,
      loadExperimentLedger: async (experimentId) => ledgers.get(experimentId) ?? { assignments: [], exposures: [], outcomes: [] },
    },
  };
}

function defaultBrowserEvidence({ commit, tree, candidateDigest }) {
  return {
    route: '/dispensaries',
    candidateDigest,
    commit,
    tree,
    browser: 'chromium',
    browserVersion: 'fixture-browser-version',
    viewport: { width: 1280, height: 900 },
    screenshotDigest: `sha256:${'1'.repeat(64)}`,
    domDigest: `sha256:${'2'.repeat(64)}`,
    capturedAt: '2026-08-24T12:05:00.000Z',
    consoleResult: { status: 'PASS', errors: 0 },
    accessibilityResult: { status: 'PASS', violations: 0 },
    layoutResult: { status: 'PASS', horizontalOverflow: false },
  };
}

export function buildRealityCellFixtureManifest(tenantId) {
  const manifest = buildManifest({ tenant: tenantId, journey: 'DISPENSARIES' });
  manifest.presentation.copy = {
    eyebrow: 'SIMULATED / FIXTURE',
    title: 'Find verified merchant and product information faster.',
    description: 'Fixture-only information hierarchy. No real merchant, inventory, price, availability, customer traffic, or authorization.',
    action: '/dispensaries',
    placeholder: 'Fixture city or neighborhood',
  };
  return manifest;
}

export function createRealityCellFixture({ commit, tree, browserEvidence = null, tenantId = 'fixture_orderweeddc_not_real' } = {}) {
  if (!/^[a-f0-9]{40}$/.test(commit ?? '')) throw new Error('40-hex commit required');
  if (!/^[a-f0-9]{40}$/.test(tree ?? '')) throw new Error('40-hex tree required');
  const store = fixtureStore();
  const experimentId = 'reality_cell_0001_fixture_only';
  const merchantId = 'fixture_licensed_merchant_not_real';
  const route = '/dispensaries';
  const rollbackContract = {
    digest: digest({ route, restore: 'fixture-control-v1' }, 'rollback-contract'),
    restoreExperienceVersion: 'fixture-control-v1',
    maximumRollbackMinutes: 5,
  };
  const candidate = createExperienceCandidate({
    objective: 'Improve accurate merchant and product information discovery in a private fixture preview',
    target: route,
    operations: [{ type: 'UPDATE_LAYOUT', scope: 'FIXTURE_PRIVATE_PREVIEW' }],
    manifestAfter: buildRealityCellFixtureManifest(tenantId),
    proposer: 'fixture-reality-cell-preparer',
    experimentId,
    merchantId,
    tenantId,
  });
  const controlCandidateDigest = digest({ route, version: 'fixture-control-v1' }, 'experience-candidate');
  const experiment = preregisterRealityCell({
    experimentId,
    merchantId,
    tenantId,
    hypothesis: 'A clearer verified-information hierarchy increases successful discovery without increasing misleading-information exposure.',
    experimentalUnit: 'eligible fixture session',
    eligibilityCriteria: { route, fixtureOnly: true, botTrafficExcluded: true },
    assignmentMethod: 'RANDOMIZED',
    allocation: { control: 0.5, treatment: 0.5 },
    assignmentSaltCommitment: commitmentForSalt(REALITY_CELL_FIXTURE_SALT),
    controlDefinition: {
      candidateDigest: controlCandidateDigest,
      experienceVersion: 'fixture-control-v1',
      description: 'Existing private fixture information hierarchy',
    },
    treatmentDefinition: {
      candidateDigest: candidate.candidateDigest,
      experienceVersion: 'fixture-treatment-v1',
      description: 'Private fixture hierarchy emphasizing verified merchant and product facts',
    },
    baseline: { primaryMetricRate: 0.4, source: 'FIXTURE_ONLY' },
    exposureDefinition: {
      event: 'independent observer confirms rendered assigned experience',
      deploymentAloneCounts: false,
    },
    primaryMetric: { id: 'successful_information_discovery', type: 'BINARY' },
    secondaryMetrics: [{ id: 'product_detail_discovery', type: 'BINARY' }],
    guardrails: [{
      id: 'verified_accuracy_guardrail',
      metric: 'misleading_information_rate',
      harmWhen: 'TREATMENT_MINUS_CONTROL_ABOVE',
      threshold: 0.02,
    }],
    minimumSample: { perArm: 50 },
    analysisMethod: 'TWO_PROPORTION_Z',
    confidencePolicy: { alpha: 0.05, confidence: 0.95, policy: 'FIXED_HORIZON' },
    interferenceAssumptions: { assumption: 'fixture sessions do not share treatment state', severeViolationInvalidates: true },
    stopConditions: [{ condition: 'minimum sample reached and fixed horizon closed' }],
    harmConditions: [{ condition: 'verified_accuracy_guardrail is breached', action: 'STOP_AND_ROLLBACK' }],
    maximumClaimCeiling: 'ECONOMIC_EFFECT',
    rollbackContract,
    ownerAuthorityRequirement: { principal: 'CANONICAL_OWNER', action: ACTIONS.AUTHORIZE_REALITY_CELL },
    merchantAuthorityRequirement: { required: true, allowedEffectSet: ['UPDATE_LAYOUT'] },
    observationWindow: { startsAt: START, endsAt: END },
    goodhartAnalysis: {
      question: 'HOW COULD AN AGENT IMPROVE THE PRIMARY METRIC WHILE MAKING THE REAL CUSTOMER / MERCHANT / SYSTEM WORSE?',
      failureModes: [{
        description: 'The agent could raise detail views with misleading titles that reduce customer trust and merchant information accuracy.',
        guardrailIds: ['verified_accuracy_guardrail'],
      }],
    },
    evidenceRealm: FIXTURE_REALM,
    proposerId: 'fixture-reality-cell-preparer',
    preregisteredAt: START,
  });
  const owner = store.put(makeReceipt({
    kind: 'PRINCIPAL',
    subjectDigest: digest({ subject: 'fixture-owner-not-real' }, 'principal-subject'),
    realm: FIXTURE_REALM,
    issuer: 'fixture-canonical-owner-session',
    issuedAt: START,
    expiresAt: EXPIRES,
    payload: {
      verified: true,
      subject: 'fixture-owner-not-real',
      allowedActions: [ACTIONS.AUTHORIZE_REALITY_CELL, ACTIONS.EXECUTE_EXPERIENCE_CANDIDATE, ACTIONS.ADMIT_LESSON],
      fixtureOnly: true,
    },
  }));
  const merchantAuthority = store.put(makeReceipt({
    kind: 'MERCHANT_AUTHORIZATION',
    subjectDigest: experiment.preregistrationDigest,
    realm: FIXTURE_REALM,
    issuer: 'fixture-merchant-authority-not-real',
    issuedAt: START,
    expiresAt: EXPIRES,
    payload: {
      decision: 'AUTHORIZED',
      merchantPrincipalId: 'fixture-merchant-principal-not-real',
      merchantId,
      tenantId,
      experimentId,
      preregistrationDigest: experiment.preregistrationDigest,
      candidateDigest: candidate.candidateDigest,
      allowedEffectSet: ['UPDATE_LAYOUT'],
      expiresAt: EXPIRES,
      rollbackContractDigest: rollbackContract.digest,
      fixtureOnly: true,
    },
  }));
  return {
    store,
    candidate,
    experiment,
    owner,
    merchantAuthority,
    rollbackContract,
    browserEvidence: browserEvidence ?? defaultBrowserEvidence({ commit, tree, candidateDigest: candidate.candidateDigest }),
  };
}

export async function runRealityCellFixtureDryRun({ commit, tree, browserEvidence = null, fixture: suppliedFixture = null } = {}) {
  const fixture = suppliedFixture ?? createRealityCellFixture({ commit, tree, browserEvidence });
  const { store, candidate, experiment, owner, merchantAuthority, rollbackContract } = fixture;
  const authorityBinding = await createRealityCellAuthorityBinding({
    experiment,
    evidenceAdapter: store.adapter,
    ownerPrincipalReceiptDigest: owner.receiptDigest,
    merchantAuthorizationReceiptDigest: merchantAuthority.receiptDigest,
    now: new Date(START),
  });
  const authorizedExperiment = bindRealityCellAuthority(experiment, authorityBinding);
  const readiness = assessRealityCellReadiness({ experiment, candidate });
  const preview = store.put(makeReceipt({
    kind: 'PRIVATE_PREVIEW',
    subjectDigest: candidate.candidateDigest,
    realm: FIXTURE_REALM,
    issuer: 'fixture-private-preview',
    issuedAt: '2026-08-24T12:04:00.000Z',
    payload: { route: candidate.target, private: true, fixtureOnly: true },
  }));
  const browserObservation = store.put(makeReceipt({
    kind: 'BROWSER_OBSERVATION',
    subjectDigest: candidate.candidateDigest,
    realm: FIXTURE_REALM,
    issuer: 'fixture-independent-browser-observer',
    issuedAt: fixture.browserEvidence.capturedAt,
    payload: { ...fixture.browserEvidence, candidateDigest: candidate.candidateDigest, route: candidate.target },
  }));
  const browserCourt = store.put(makeReceipt({
    kind: 'COURT',
    subjectDigest: candidate.candidateDigest,
    realm: FIXTURE_REALM,
    issuer: 'fixture-browser-court',
    issuedAt: '2026-08-24T12:06:00.000Z',
    payload: { court: 'BROWSER', verdict: 'PASS', observationReceiptDigest: browserObservation.receiptDigest },
    parentDigests: [browserObservation.receiptDigest],
  }));
  const realityCourt = store.put(makeReceipt({
    kind: 'COURT',
    subjectDigest: candidate.candidateDigest,
    realm: FIXTURE_REALM,
    issuer: 'fixture-reality-court',
    issuedAt: '2026-08-24T12:07:00.000Z',
    payload: { court: 'REALITY', verdict: 'PASS', fixtureOnly: true },
  }));
  const rollback = store.put(makeReceipt({
    kind: 'ROLLBACK',
    subjectDigest: candidate.candidateDigest,
    realm: FIXTURE_REALM,
    issuer: 'fixture-experience-versioning',
    issuedAt: '2026-08-24T12:08:00.000Z',
    payload: { rollbackContractDigest: rollbackContract.digest, targetVersion: rollbackContract.restoreExperienceVersion },
  }));
  const fabric = createFullFabricAdapter({
    enumerateExperienceSurfaces: async () => [],
    loadExperienceManifest: async () => null,
    persistExperienceCandidate: async () => candidate.candidateDigest,
    renderPrivatePreview: async () => preview.receiptDigest,
    captureRenderedEvidenceReceipt: async () => browserObservation.receiptDigest,
    generateMediaCandidate: async () => null,
    loadReceipt: store.adapter.loadReceipt,
    resolveVerifiedPrincipalReceipt: async () => owner.receiptDigest,
    executeWithPromotionClaim: async () => { throw new Error('fixture dry run must not execute a real treatment'); },
    rollbackExperienceVersion: async () => rollback.receiptDigest,
    persistPromotionReceipt: async (payload) => store.put(makeReceipt({
      kind: 'PROMOTION',
      subjectDigest: candidate.candidateDigest,
      realm: FIXTURE_REALM,
      issuer: 'fixture-promotion-court',
      issuedAt: '2026-08-24T12:09:00.000Z',
      expiresAt: EXPIRES,
      payload,
      parentDigests: [preview.receiptDigest, browserObservation.receiptDigest, browserCourt.receiptDigest, realityCourt.receiptDigest, rollback.receiptDigest],
    })),
  });
  const promotion = await experiencePromotionCourt(fabric, candidate, {
    principalReceiptDigest: owner.receiptDigest,
    previewReceiptDigest: preview.receiptDigest,
    browserObservationReceiptDigest: browserObservation.receiptDigest,
    browserCourtReceiptDigest: browserCourt.receiptDigest,
    realityCourtReceiptDigest: realityCourt.receiptDigest,
    rollbackReceiptDigest: rollback.receiptDigest,
    experiment: authorizedExperiment,
    authorityBinding,
    expiresAt: EXPIRES,
    evidenceRealm: FIXTURE_REALM,
    now: START,
  });

  const assignments = [];
  const exposures = [];
  const outcomes = [];
  const armSequence = { CONTROL: 0, TREATMENT: 0 };
  for (let index = 0; index < 240; index += 1) {
    const assignedAt = new Date(new Date(START).getTime() + index * 1000);
    const assignment = store.put(makeAssignmentReceipt({
      experiment: authorizedExperiment,
      unitId: `fixture-session-${index}`,
      assignmentSalt: REALITY_CELL_FIXTURE_SALT,
      assignedAt,
      realm: FIXTURE_REALM,
    }));
    assignments.push(assignment.receiptDigest);
    const armIndex = armSequence[assignment.payload.arm];
    armSequence[assignment.payload.arm] += 1;
    const expected = assignment.payload.arm === 'TREATMENT'
      ? authorizedExperiment.treatmentDefinition
      : authorizedExperiment.controlDefinition;
    const exposure = store.put(makeExposureReceipt({
      experiment: authorizedExperiment,
      assignmentReceipt: assignment,
      exposed: true,
      exposureEvidenceDigest: digest({ index, event: 'fixture-render-observed' }, 'fixture-exposure'),
      actualExperienceVersion: expected.experienceVersion,
      candidateDigest: expected.candidateDigest,
      routeSurface: candidate.target,
      observedAt: new Date(assignedAt.getTime() + 60_000),
      independentObserverSource: 'fixture-independent-render-observer',
      treatmentExecutorSource: 'fixture-experience-executor',
      realm: FIXTURE_REALM,
    }));
    exposures.push(exposure.receiptDigest);
    const success = assignment.payload.arm === 'TREATMENT'
      ? armIndex % 5 < 4
      : armIndex % 5 < 2;
    const primaryOutcome = store.put(makeOutcomeReceipt({
      experiment: authorizedExperiment,
      exposureReceipt: exposure,
      metric: authorizedExperiment.primaryMetric.id,
      observedValue: success,
      observedAt: new Date(assignedAt.getTime() + 120_000),
      source: 'fixture-outcome-observer',
      outcomeEvidenceDigest: digest({ index, metric: authorizedExperiment.primaryMetric.id }, 'fixture-outcome'),
      realm: FIXTURE_REALM,
    }));
    const guardrailOutcome = store.put(makeOutcomeReceipt({
      experiment: authorizedExperiment,
      exposureReceipt: exposure,
      metric: 'misleading_information_rate',
      observedValue: assignment.payload.arm === 'TREATMENT' ? 0.01 : 0.015,
      observedAt: new Date(assignedAt.getTime() + 121_000),
      source: 'fixture-accuracy-observer',
      outcomeEvidenceDigest: digest({ index, metric: 'misleading_information_rate' }, 'fixture-outcome'),
      realm: FIXTURE_REALM,
    }));
    outcomes.push(primaryOutcome.receiptDigest, guardrailOutcome.receiptDigest);
  }
  store.ledgers.set(authorizedExperiment.experimentId, { assignments, exposures, outcomes });
  const settlement = await settleRealityCell(authorizedExperiment, store.adapter, { now: new Date('2026-08-24T16:00:00.000Z') });
  store.put(settlement.receipt);

  const economicValues = {
    INCREMENTAL_MARGIN_USD: 125,
    DISCOUNT_COST_USD: 10,
    MEDIA_COST_USD: 0,
    FULFILLMENT_COST_USD: 5,
    PLATFORM_COST_USD: 4,
    OTHER_DIRECT_COST_USD: 1,
  };
  const economicReceipts = Object.entries(economicValues).map(([metric, observedValue]) => store.put(makeReceipt({
    kind: 'ECONOMIC_OBSERVATION',
    subjectDigest: settlement.settlementDigest,
    realm: FIXTURE_REALM,
    issuer: 'fixture-merchant-economics-observer',
    issuedAt: '2026-08-24T16:05:00.000Z',
    payload: { metric, value: observedValue, source: 'FIXTURE_ONLY', observedAt: '2026-08-24T16:05:00.000Z' },
  })));
  const valueReceipt = await issueRealityCellValueReceipt({
    settlement,
    intervention: {
      candidateDigest: candidate.candidateDigest,
      description: 'Fixture-only merchant information hierarchy',
      rollbackContract,
    },
    economicObservationReceiptDigests: economicReceipts.map((receipt) => receipt.receiptDigest),
    evidenceAdapter: store.adapter,
  });
  store.put(valueReceipt.receipt);
  const lesson = proposeRealityCellLesson({
    claim: 'The fixture treatment pattern improved successful information discovery without accuracy harm.',
    scope: `${authorizedExperiment.tenantId}:${authorizedExperiment.merchantId}`,
    context: { fixtureOnly: true },
    valueReceipt,
    proposerId: 'fixture-reality-cell-preparer',
  });
  const verifier = store.put(makeReceipt({
    kind: 'VERIFIER',
    subjectDigest: lesson.lessonDigest,
    realm: FIXTURE_REALM,
    issuer: 'fixture-independent-lesson-verifier',
    issuedAt: '2026-08-24T16:10:00.000Z',
    payload: { verifierId: 'fixture-independent-verifier', verdict: 'ADMIT', fixtureOnly: true },
  }));
  const lessonBoundary = await admitRealityCellLesson(lesson, {
    verifierReceiptDigest: verifier.receiptDigest,
    principalReceiptDigest: owner.receiptDigest,
    now: START,
  }, store.adapter);
  store.put(lessonBoundary.admissionReceipt);

  return {
    schemaVersion: 'cana.reality-cell-0001-dry-run/1.0.0',
    result: settlement.classification === 'CAUSAL_SUPPORTED'
      && valueReceipt.economicStatus === 'SIMULATED_FIXTURE_ONLY'
      && lessonBoundary.status === 'REJECTED_FIXTURE_BOUNDARY'
      ? 'VERIFIED'
      : 'FAILED',
    evidenceRealm: FIXTURE_REALM,
    simulationLabel: 'SIMULATED / FIXTURE',
    commit,
    tree,
    experimentId: authorizedExperiment.experimentId,
    preregistrationDigest: authorizedExperiment.preregistrationDigest,
    candidateDigest: candidate.candidateDigest,
    readiness,
    authority: {
      fixtureOnly: true,
      realWorldExecutionAllowed: authorityBinding.realWorldExecutionAllowed,
      ownerPrincipalReceiptDigest: owner.receiptDigest,
      merchantAuthorizationReceiptDigest: merchantAuthority.receiptDigest,
    },
    previewReceiptDigest: preview.receiptDigest,
    browserObservationReceiptDigest: browserObservation.receiptDigest,
    promotionReceiptDigest: promotion.receiptDigest,
    assignment: settlement.assignmentSanity,
    settlement: {
      classification: settlement.classification,
      evidenceRealm: settlement.evidenceRealm,
      counts: settlement.counts,
      guardrailResults: settlement.guardrailResults,
      settlementDigest: settlement.settlementDigest,
      realWorldClaim: settlement.realWorldClaim,
    },
    economics: {
      status: valueReceipt.economicStatus,
      simulatedEconomicEffectUsd: valueReceipt.economicEffectUsd,
      realEconomicValueEstablished: valueReceipt.realEconomicValueEstablished,
      valueReceiptDigest: valueReceipt.receiptDigest,
    },
    lessonAdmissionBoundary: {
      status: lessonBoundary.status,
      trusted: lessonBoundary.trusted,
      realMemoryWrites: 0,
      admissionReceiptDigest: lessonBoundary.admissionDigest,
    },
    realCustomerExposure: 0,
    realMerchantExposure: 0,
    productionEffects: 0,
    spendUsd: 0,
    realOutcome: 'NOT_ESTABLISHED',
    realEconomicValue: 'NOT_ESTABLISHED',
    realRsi: 'NOT_ESTABLISHED',
  };
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

async function main() {
  const commit = argument('--commit');
  const tree = argument('--tree');
  const browserEvidencePath = argument('--browser-evidence');
  const outputPath = argument('--output');
  const browserEvidence = browserEvidencePath
    ? JSON.parse(fs.readFileSync(browserEvidencePath, 'utf8'))
    : null;
  const result = await runRealityCellFixtureDryRun({ commit, tree, browserEvidence });
  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (outputPath) fs.writeFileSync(outputPath, json, { mode: 0o600 });
  process.stdout.write(json);
  if (result.result !== 'VERIFIED') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
