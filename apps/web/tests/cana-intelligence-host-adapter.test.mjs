import assert from 'node:assert/strict';
import test from 'node:test';

import {
  makeReceipt,
  preregisterExperiment,
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

test('lesson and experiment state append canonically and the ledger reconstructs receipt digests', async () => {
  const harness = prismaHarness();
  const host = createCanonicalWeldHost({
    prisma: harness.prisma,
    assertAdmin: async () => ({ userId: 'owner-1', role: 'ADMIN' }),
    tenant: 'orderweeddc.com',
  });
  const lesson = {
    lessonId: 'lesson-1',
    status: 'ADMITTED',
    trusted: true,
    causalStatus: 'CAUSALLY_SUPPORTED',
    admissionDigest: 'receipt:admission',
    valueReceiptDigest: 'receipt:value',
  };
  await host.persistLesson(lesson);
  assert.deepEqual(await host.loadLesson('lesson-1'), lesson);

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
