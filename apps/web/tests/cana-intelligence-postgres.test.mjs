import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';

import { createCanonicalWeldHost } from '../src/lib/cana-intelligence/canonical-host.mjs';
import { makeReceipt } from '../src/lib/cana-intelligence/index.mjs';

const prisma = new PrismaClient();
const tenant = `weld-test-${randomUUID()}`;
const admin = async () => ({ userId: 'weld-test-owner', role: 'ADMIN' });

after(async () => {
  await prisma.$disconnect();
});

test('canonical WELD receipts and records persist transactionally in PostgreSQL', async () => {
  const receipt = makeReceipt({
    kind: 'COURT',
    subjectDigest: 'candidate:postgres',
    issuer: 'postgres-integration-court',
    payload: { court: 'REALITY', verdict: 'PASS' },
  });
  const lesson = {
    lessonId: `lesson-${randomUUID()}`,
    status: 'ADMITTED',
    trusted: true,
    causalStatus: 'CAUSALLY_SUPPORTED',
    admissionDigest: receipt.receiptDigest,
    valueReceiptDigest: 'value:test',
  };

  await prisma.$transaction(async (transaction) => {
    const host = createCanonicalWeldHost({ prisma: transaction, assertAdmin: admin, tenant });
    await host.persistReceipt(receipt);
    await host.persistLesson(lesson);
    assert.equal((await host.loadReceipt(receipt.receiptDigest)).receiptDigest, receipt.receiptDigest);
    assert.deepEqual(await host.loadLesson(lesson.lessonId), lesson);
  });
});

test('database triggers refuse receipt and governed-record rewrites', async () => {
  const receipt = makeReceipt({
    kind: 'COURT',
    subjectDigest: 'candidate:append-only',
    issuer: 'postgres-integration-court',
    payload: { court: 'BROWSER', verdict: 'PASS' },
  });
  const host = createCanonicalWeldHost({ prisma, assertAdmin: admin, tenant });
  await host.persistReceipt(receipt);
  const recordDigest = await host.persistPrediction({
    predictionId: `prediction-${randomUUID()}`,
    status: 'LOCKED',
    lockDigest: 'prediction-lock:test',
  });

  await assert.rejects(() => prisma.canaEvidenceReceipt.update({
    where: { tenant_receiptDigest: { tenant, receiptDigest: receipt.receiptDigest } },
    data: { issuer: 'tampered' },
  }));
  await assert.rejects(() => prisma.canaIntelligenceRecord.update({
    where: { recordDigest },
    data: { status: 'TAMPERED' },
  }));
});

test('PostgreSQL receipt lookup stays tenant-bound', async () => {
  const receipt = makeReceipt({
    kind: 'VERIFIER',
    subjectDigest: 'candidate:tenant-court',
    issuer: 'postgres-integration-court',
    payload: { verdict: 'PASS' },
  });
  const first = createCanonicalWeldHost({ prisma, assertAdmin: admin, tenant });
  const second = createCanonicalWeldHost({ prisma, assertAdmin: admin, tenant: `${tenant}-other` });

  await first.persistReceipt(receipt);
  assert.equal(await second.loadReceipt(receipt.receiptDigest), null);
  await second.persistReceipt(receipt);
  assert.equal((await first.loadReceipt(receipt.receiptDigest)).receiptDigest, receipt.receiptDigest);
  assert.equal((await second.loadReceipt(receipt.receiptDigest)).receiptDigest, receipt.receiptDigest);
});
