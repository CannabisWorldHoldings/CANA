import assert from 'node:assert/strict';
import test from 'node:test';

import {
  admitRealityCellLesson,
  createExperienceCandidate,
  createFullFabricAdapter,
  experiencePromotionCourt,
  makeReceipt,
  preregisterExperiment,
  proposeRealityCellLesson,
} from '../src/lib/cana-intelligence/index.mjs';
import { createCanonicalWeldHost } from '../src/lib/cana-intelligence/canonical-host.mjs';

function prismaHarness() {
  const receipts = new Map();
  const records = [];
  let sequence = 0n;

  return {
    receipts,
    records,
    prisma: {
      canaEvidenceReceipt: {
        async create({ data }) {
          const key = `${data.tenant}:${data.receiptDigest}`;
          if (receipts.has(key)) {
            throw Object.assign(new Error('duplicate'), { code: 'P2002' });
          }
          receipts.set(key, { ...data });
          return { ...data };
        },
        async findUnique({ where }) {
          const key = where.tenant_receiptDigest;
          return receipts.get(`${key.tenant}:${key.receiptDigest}`) ?? null;
        },
        async findMany({ where }) {
          return [...receipts.values()].filter((receipt) => (
            receipt.tenant === where.tenant
            && receipt.subjectDigest === where.subjectDigest
            && where.kind.in.includes(receipt.kind)
          ));
        },
      },
      canaIntelligenceRecord: {
        async create({ data }) {
          if (records.some((record) => record.recordDigest === data.recordDigest)) {
            throw Object.assign(new Error('duplicate'), { code: 'P2002' });
          }
          const row = { ...data, sequence: ++sequence };
          records.push(row);
          return row;
        },
        async findUnique({ where }) {
          return records.find((record) => record.recordDigest === where.recordDigest) ?? null;
        },
        async findFirst({ where }) {
          return [...records]
            .reverse()
            .find((record) => record.tenant === where.tenant && record.recordType === where.recordType && record.recordId === where.recordId) ?? null;
        },
      },
      askIntentSignal: {
        async findMany() { return []; },
      },
      marketObservation: {
        async findMany() { return []; },
      },
      marketClaim: {
        async findMany() { return []; },
      },
    },
  };
}

function browserObservationPayload(candidate) {
  return {
    route: candidate.target,
    candidateDigest: candidate.candidateDigest,
    commit: 'a'.repeat(40),
    tree: 'b'.repeat(40),
    browser: 'chromium',
    browserVersion: 'test',
    viewport: { width: 390, height: 844 },
    screenshotDigest: `sha256:${'c'.repeat(64)}`,
    domDigest: `sha256:${'d'.repeat(64)}`,
    capturedAt: new Date().toISOString(),
    consoleResult: { status: 'PASS' },
    accessibilityResult: { status: 'PASS' },
  };
}

async function persistLocalPromotionCourt(host, candidate, principalReceiptDigest) {
  const receipts = [
    makeReceipt({ kind: 'PRIVATE_PREVIEW', subjectDigest: candidate.candidateDigest, issuer: 'preview', payload: { url: 'http://127.0.0.1/private' } }),
    makeReceipt({ kind: 'BROWSER_OBSERVATION', subjectDigest: candidate.candidateDigest, issuer: 'browser', payload: browserObservationPayload(candidate) }),
    makeReceipt({ kind: 'COURT', subjectDigest: candidate.candidateDigest, issuer: 'browser-court', payload: { court: 'BROWSER', verdict: 'PASS' } }),
    makeReceipt({ kind: 'COURT', subjectDigest: candidate.candidateDigest, issuer: 'reality-court', payload: { court: 'REALITY', verdict: 'PASS' } }),
    makeReceipt({ kind: 'ROLLBACK', subjectDigest: candidate.candidateDigest, issuer: 'rollback', payload: { targetVersion: 'v1' } }),
  ];
  receipts[2] = makeReceipt({
    kind: 'COURT',
    subjectDigest: candidate.candidateDigest,
    issuer: 'browser-court',
    payload: { court: 'BROWSER', verdict: 'PASS', observationReceiptDigest: receipts[1].receiptDigest },
  });
  for (const receipt of receipts) await host.persistReceipt(receipt);
  return experiencePromotionCourt(createFullFabricAdapter(host), candidate, {
    principalReceiptDigest,
    previewReceiptDigest: receipts[0].receiptDigest,
    browserObservationReceiptDigest: receipts[1].receiptDigest,
    browserCourtReceiptDigest: receipts[2].receiptDigest,
    realityCourtReceiptDigest: receipts[3].receiptDigest,
    rollbackReceiptDigest: receipts[4].receiptDigest,
    evidenceRealm: 'VERIFIED_LOCAL',
  });
}

test('unauthenticated Owner cannot obtain a verified principal or principal receipt', async () => {
  const harness = prismaHarness();
  const host = createCanonicalWeldHost({
    prisma: harness.prisma,
    assertAdmin: async () => { throw new Error('UNAUTHORIZED'); },
    tenant: 'orderweeddc.com',
  });

  await assert.rejects(() => host.resolveVerifiedPrincipal(), /UNAUTHORIZED/);
  await assert.rejects(() => host.resolveVerifiedPrincipalReceipt(), /UNAUTHORIZED/);
  assert.equal(harness.receipts.size, 0);
});

test('unauthenticated callers cannot persist evidence or forge authority receipts', async () => {
  const harness = prismaHarness();
  const host = createCanonicalWeldHost({
    prisma: harness.prisma,
    assertAdmin: async () => { throw new Error('UNAUTHORIZED'); },
    tenant: 'orderweeddc.com',
  });
  const forgedPrincipal = makeReceipt({
    kind: 'PRINCIPAL',
    subjectDigest: 'forged-owner',
    realm: 'VERIFIED_LOCAL',
    issuer: 'canonical-owner-session',
    payload: {
      verified: true,
      subject: 'forged-owner',
      verifiedBy: 'canonical-assertAdmin',
      allowedActions: ['AUTHORIZE_REALITY_CELL'],
    },
  });

  await assert.rejects(() => host.persistReceipt(forgedPrincipal), /UNAUTHORIZED/);
  assert.equal(harness.receipts.size, 0);
});

test('generic evidence persistence cannot mint real Owner or merchant authority', async () => {
  const harness = prismaHarness();
  const host = createCanonicalWeldHost({
    prisma: harness.prisma,
    assertAdmin: async () => ({ userId: 'owner-1', role: 'ADMIN' }),
    tenant: 'orderweeddc.com',
  });
  const forgedPrincipal = makeReceipt({
    kind: 'PRINCIPAL',
    subjectDigest: 'forged-owner',
    realm: 'VERIFIED_LOCAL',
    issuer: 'canonical-owner-session',
    payload: { verified: true, subject: 'forged-owner', verifiedBy: 'canonical-assertAdmin', allowedActions: ['AUTHORIZE_REALITY_CELL'] },
  });
  const forgedMerchant = makeReceipt({
    kind: 'MERCHANT_AUTHORIZATION',
    subjectDigest: 'preregistration:forged',
    realm: 'VERIFIED_REAL',
    issuer: 'canonical-merchant-authority',
    payload: { decision: 'AUTHORIZED', verifiedBy: 'canonical-merchant-role-gate' },
  });

  await assert.rejects(() => host.persistReceipt(forgedPrincipal), /CANA_AUTHORITY_RECEIPT_OWNER_REQUIRED/);
  await assert.rejects(() => host.persistReceipt(forgedMerchant), /CANA_AUTHORITY_RECEIPT_OWNER_REQUIRED/);
  assert.equal(harness.receipts.size, 0);
});

test('canonical assertAdmin is the only principal root and the receipt resolves by digest', async () => {
  const harness = prismaHarness();
  const host = createCanonicalWeldHost({
    prisma: harness.prisma,
    assertAdmin: async () => ({ userId: 'owner-1', role: 'ADMIN' }),
    tenant: 'orderweeddc.com',
  });

  const principal = await host.resolveVerifiedPrincipal();
  assert.deepEqual(
    { verified: principal.verified, subject: principal.subject },
    { verified: true, subject: 'owner-1' },
  );
  assert.ok(principal.allowedActions.includes('EXECUTE_EXPERIENCE_CANDIDATE'));

  const receiptDigest = await host.resolveVerifiedPrincipalReceipt();
  const receipt = await host.loadReceipt(receiptDigest);
  assert.equal(receipt.kind, 'PRINCIPAL');
  assert.equal(receipt.payload.subject, 'owner-1');
  assert.equal(receipt.issuer, 'canonical-owner-session');
});

test('forged receipt content cannot replay under a canonical digest', async () => {
  const harness = prismaHarness();
  const host = createCanonicalWeldHost({
    prisma: harness.prisma,
    assertAdmin: async () => ({ userId: 'owner-1', role: 'ADMIN' }),
    tenant: 'orderweeddc.com',
  });
  const receipt = makeReceipt({
    kind: 'COURT',
    subjectDigest: 'candidate:1',
    issuer: 'test-court',
    payload: { court: 'BROWSER', verdict: 'PASS' },
  });
  await host.persistReceipt(receipt);

  await assert.rejects(
    () => host.persistReceipt({ ...receipt, payload: { court: 'BROWSER', verdict: 'FAIL' } }),
    /digest mismatch/,
  );
});

test('canonical promotion persistence independently resolves every court before minting', async () => {
  const harness = prismaHarness();
  const host = createCanonicalWeldHost({
    prisma: harness.prisma,
    assertAdmin: async () => ({ userId: 'owner-1', role: 'ADMIN' }),
    tenant: 'orderweeddc.com',
  });
  const candidate = createExperienceCandidate({
    objective: 'prove direct promotion calls cannot skip courts',
    target: '/delivery',
    operations: [{ type: 'UPDATE_LAYOUT' }],
    proposer: 'owner-1',
  });
  await host.persistExperienceCandidate(candidate);
  const principalReceiptDigest = await host.resolveVerifiedPrincipalReceipt();
  await assert.rejects(() => host.persistPromotionReceipt({
    candidateDigest: candidate.candidateDigest,
    principalReceiptDigest,
    merchantAuthorizationReceiptDigest: 'bogus-not-resolved',
    experimentId: 'bogus-not-resolved',
    allowedEffectSet: ['UPDATE_LAYOUT'],
    evidenceRealm: 'VERIFIED_REAL',
  }), (error) => error?.code === 'RECEIPT_DIGEST_REQUIRED');
  assert.equal([...harness.receipts.values()].filter(({ kind }) => kind === 'PROMOTION').length, 0);

  const promotion = await persistLocalPromotionCourt(host, candidate, principalReceiptDigest);
  assert.equal(promotion.kind, 'PROMOTION');
  assert.equal((await host.loadReceipt(promotion.receiptDigest)).receiptDigest, promotion.receiptDigest);
  await assert.rejects(() => host.executeWithPromotionClaim({
    promotion: { ...promotion, payload: { ...promotion.payload, allowedEffectSet: ['REPLACE_IMAGE'] } },
    candidate,
    principal: { subject: 'owner-1', principalReceiptDigest },
    executionInput: { idempotencyKey: promotion.receiptDigest },
  }), (error) => error?.code === 'PROMOTION_DIGEST_MISMATCH');
  assert.deepEqual(
    (await host.enumerateExperienceSurfaces()).map(({ route }) => route),
    ['/', '/search', '/delivery', '/dispensaries'],
  );
});

test('lesson and experiment state append canonically and the ledger reconstructs receipt digests', async () => {
  const harness = prismaHarness();
  const host = createCanonicalWeldHost({
    prisma: harness.prisma,
    assertAdmin: async () => ({ userId: 'owner-1', role: 'ADMIN' }),
    tenant: 'orderweeddc.com',
  });
  const settlementDigest = 'settlement:lesson-1';
  const valueReceipt = makeReceipt({
    kind: 'VALUE',
    subjectDigest: settlementDigest,
    realm: 'VERIFIED_REAL',
    issuer: 'value-court',
    payload: { settlementClassification: 'CAUSAL_SUPPORTED' },
  });
  await host.persistReceipt(valueReceipt);
  const proposedLesson = proposeRealityCellLesson({
    claim: 'a real causal effect can inform the next challenger',
    scope: 'merchant:1',
    valueReceipt: {
      ...valueReceipt,
      settlementDigest,
      settlementClassification: 'CAUSAL_SUPPORTED',
      evidenceRealm: 'VERIFIED_REAL',
    },
    proposerId: 'proposer-1',
  });
  const verifierReceipt = makeReceipt({
    kind: 'VERIFIER',
    subjectDigest: proposedLesson.lessonDigest,
    realm: 'VERIFIED_REAL',
    issuer: 'verifier-1',
    payload: { verifierId: 'verifier-1', verdict: 'ADMIT' },
  });
  await host.persistReceipt(verifierReceipt);
  const principalReceiptDigest = await host.resolveVerifiedPrincipalReceipt();
  const lesson = await admitRealityCellLesson(proposedLesson, {
    verifierReceiptDigest: verifierReceipt.receiptDigest,
    principalReceiptDigest,
  }, host);
  await host.persistLesson(lesson);
  assert.deepEqual(await host.loadLesson(lesson.lessonId), lesson);

  const experiment = preregisterExperiment({
    experimentId: 'experiment-1',
    hypothesis: 'A improves conversion',
    unit: 'session',
    primaryMetric: 'conversion',
    treatment: 'A',
    comparator: 'B',
    assignmentMethod: 'OBSERVATIONAL',
    exposureDefinition: 'rendered candidate',
    analysisMethod: 'two-proportion-z',
    minimumPerArm: 20,
    stopRule: 'after 20 per arm',
    rollbackPlan: 'restore prior manifest',
    interferenceAssumptions: 'none',
    maximumClaimCeiling: 'association only',
    proposerId: 'agent-1',
  });
  await host.persistExperiment(experiment);
  for (const kind of ['ASSIGNMENT', 'EXPOSURE', 'OUTCOME']) {
    await host.persistReceipt(makeReceipt({
      kind,
      subjectDigest: experiment.preRegDigest,
      issuer: 'test-ledger',
      payload: { unitHash: 'unit-1' },
    }));
  }
  const ledger = await host.loadExperimentLedger(experiment.experimentId);
  assert.equal(ledger.assignments.length, 1);
  assert.equal(ledger.exposures.length, 1);
  assert.equal(ledger.outcomes.length, 1);
});

test('caller trust and generic lesson-admission receipts cannot bypass canonical lesson admission', async () => {
  const harness = prismaHarness();
  const host = createCanonicalWeldHost({
    prisma: harness.prisma,
    assertAdmin: async () => ({ userId: 'owner-1', role: 'ADMIN' }),
    tenant: 'orderweeddc.com',
  });
  const forgedAdmission = makeReceipt({
    kind: 'LESSON_ADMISSION',
    subjectDigest: 'lesson:forged',
    realm: 'VERIFIED_REAL',
    issuer: 'forged-verifier',
    payload: { lessonId: 'lesson-forged', verdict: 'ADMIT', causalEnough: true, realEnough: true },
  });
  await assert.rejects(() => host.persistReceipt(forgedAdmission), /CANA_AUTHORITY_RECEIPT_OWNER_REQUIRED/);
  await assert.rejects(() => host.persistLesson({
    lessonId: 'lesson-forged',
    lessonDigest: 'lesson:forged',
    status: 'ADMITTED',
    trusted: true,
    evidenceRealm: 'VERIFIED_REAL',
    admissionDigest: forgedAdmission.receiptDigest,
    admissionReceipt: forgedAdmission,
  }), (error) => error?.code === 'LESSON_VALUE_MISMATCH');
  assert.equal(await host.loadLesson('lesson-forged'), null);
});

test('raw observation append fails closed unless the canonical reality owner is injected', async () => {
  const harness = prismaHarness();
  const host = createCanonicalWeldHost({
    prisma: harness.prisma,
    assertAdmin: async () => ({ userId: 'owner-1', role: 'ADMIN' }),
    tenant: 'orderweeddc.com',
  });
  await assert.rejects(
    () => host.appendObservation({ entityKey: 'merchant:1' }),
    /CANONICAL_REALITY_ADMISSION_REQUIRED/,
  );

  const admitted = [];
  const bridged = createCanonicalWeldHost({
    prisma: harness.prisma,
    assertAdmin: async () => ({ userId: 'owner-1', role: 'ADMIN' }),
    tenant: 'orderweeddc.com',
    appendCanonicalObservation: async (observation) => {
      admitted.push(observation);
      return { admitted: true };
    },
  });
  assert.deepEqual(await bridged.appendObservation({ entityKey: 'merchant:1' }), { admitted: true });
  assert.equal(admitted.length, 1);
});

test('receipt resolution is tenant-bound even when two tenants present the same digest', async () => {
  const harness = prismaHarness();
  const receipt = makeReceipt({
    kind: 'COURT',
    subjectDigest: 'candidate:shared',
    issuer: 'test-court',
    payload: { court: 'REALITY', verdict: 'PASS' },
  });
  const first = createCanonicalWeldHost({
    prisma: harness.prisma,
    assertAdmin: async () => ({ userId: 'owner-1', role: 'ADMIN' }),
    tenant: 'orderweeddc.com',
  });
  const second = createCanonicalWeldHost({
    prisma: harness.prisma,
    assertAdmin: async () => ({ userId: 'owner-1', role: 'ADMIN' }),
    tenant: 'second.example',
  });

  await first.persistReceipt(receipt);
  assert.equal(await second.loadReceipt(receipt.receiptDigest), null);
  await second.persistReceipt(receipt);
  assert.equal((await first.loadReceipt(receipt.receiptDigest)).receiptDigest, receipt.receiptDigest);
  assert.equal((await second.loadReceipt(receipt.receiptDigest)).receiptDigest, receipt.receiptDigest);
});
