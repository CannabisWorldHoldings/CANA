import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';

import { createCanonicalWeldHost } from '../src/lib/cana-intelligence/canonical-host.mjs';
import {
  admitRealityCellLesson,
  createExperienceCandidate,
  createFullFabricAdapter,
  executeExperienceThroughCanonicalAuthority,
  experiencePromotionCourt,
  makeReceipt,
  proposeRealityCellLesson,
} from '../src/lib/cana-intelligence/index.mjs';
import { buildManifest } from '../src/lib/experience/manifest.mjs';
import { resolveRuntimeExperienceManifest } from '../src/lib/experience/runtime-manifest.mjs';

const prisma = new PrismaClient();
const tenant = `weld-test-${randomUUID()}`;
const admin = async () => ({ userId: 'weld-test-owner', role: 'ADMIN' });

function browserObservationPayload(candidate) {
  return {
    route: candidate.target,
    candidateDigest: candidate.candidateDigest,
    commit: 'a'.repeat(40),
    tree: 'b'.repeat(40),
    browser: 'chromium',
    browserVersion: 'postgres-court',
    viewport: { width: 390, height: 844 },
    screenshotDigest: `sha256:${'c'.repeat(64)}`,
    domDigest: `sha256:${'d'.repeat(64)}`,
    capturedAt: new Date().toISOString(),
    consoleResult: { status: 'PASS', errors: 0 },
    accessibilityResult: { status: 'PASS', violations: 0 },
    layoutResult: { status: 'PASS', horizontalOverflow: false },
  };
}

async function persistLocalPromotionCourt(host, candidate, principalReceiptDigest) {
  const preview = makeReceipt({ kind: 'PRIVATE_PREVIEW', subjectDigest: candidate.candidateDigest, issuer: 'postgres-preview', payload: { url: 'http://127.0.0.1/private' } });
  const observation = makeReceipt({ kind: 'BROWSER_OBSERVATION', subjectDigest: candidate.candidateDigest, issuer: 'postgres-browser', payload: browserObservationPayload(candidate) });
  const browser = makeReceipt({ kind: 'COURT', subjectDigest: candidate.candidateDigest, issuer: 'postgres-browser-court', payload: { court: 'BROWSER', verdict: 'PASS', observationReceiptDigest: observation.receiptDigest } });
  const reality = makeReceipt({ kind: 'COURT', subjectDigest: candidate.candidateDigest, issuer: 'postgres-reality-court', payload: { court: 'REALITY', verdict: 'PASS' } });
  const rollback = makeReceipt({ kind: 'ROLLBACK', subjectDigest: candidate.candidateDigest, issuer: 'postgres-rollback', payload: { targetVersion: 'v1' } });
  for (const receipt of [preview, observation, browser, reality, rollback]) await host.persistReceipt(receipt);
  return experiencePromotionCourt(createFullFabricAdapter(host), candidate, {
    principalReceiptDigest,
    previewReceiptDigest: preview.receiptDigest,
    browserObservationReceiptDigest: observation.receiptDigest,
    browserCourtReceiptDigest: browser.receiptDigest,
    realityCourtReceiptDigest: reality.receiptDigest,
    rollbackReceiptDigest: rollback.receiptDigest,
    evidenceRealm: 'VERIFIED_LOCAL',
  });
}

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
  await prisma.$transaction(async (transaction) => {
    const host = createCanonicalWeldHost({ prisma: transaction, assertAdmin: admin, tenant });
    await host.persistReceipt(receipt);
    const settlementDigest = `settlement-${randomUUID()}`;
    const valueReceipt = makeReceipt({
      kind: 'VALUE',
      subjectDigest: settlementDigest,
      realm: 'VERIFIED_LOCAL',
      issuer: 'postgres-value-court',
      payload: { settlementClassification: 'CAUSAL_SUPPORTED' },
    });
    await host.persistReceipt(valueReceipt);
    const proposedLesson = proposeRealityCellLesson({
      claim: 'transactionally persisted causal lesson',
      scope: 'merchant:postgres',
      valueReceipt: {
        ...valueReceipt,
        settlementDigest,
        settlementClassification: 'CAUSAL_SUPPORTED',
        evidenceRealm: 'VERIFIED_LOCAL',
      },
      proposerId: 'postgres-proposer',
    });
    const verifierReceipt = makeReceipt({
      kind: 'VERIFIER',
      subjectDigest: proposedLesson.lessonDigest,
      realm: 'VERIFIED_LOCAL',
      issuer: 'postgres-verifier',
      payload: { verifierId: 'postgres-verifier', verdict: 'ADMIT' },
    });
    await host.persistReceipt(verifierReceipt);
    const principalReceiptDigest = await host.resolveVerifiedPrincipalReceipt();
    const lesson = await admitRealityCellLesson(proposedLesson, {
      verifierReceiptDigest: verifierReceipt.receiptDigest,
      principalReceiptDigest,
    }, host);
    await host.persistLesson(lesson);
    assert.equal(lesson.status, 'REJECTED_FIXTURE_BOUNDARY');
    assert.equal(lesson.trusted, false);
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

async function executableExperience({ executionTenant, target, execute, manifestAfter = null }) {
  const host = createCanonicalWeldHost({
    prisma,
    assertAdmin: admin,
    tenant: executionTenant,
    experience: {
      executeAuthorizedExperienceCandidate: execute,
      rollbackExperienceVersion: async () => null,
    },
  });
  const candidate = createExperienceCandidate({
    objective: 'verify atomic canonical Experience execution',
    target,
    operations: [{ type: 'UPDATE_LAYOUT' }],
    manifestAfter: manifestAfter ?? buildManifest({
      tenant: executionTenant,
      journey: { '/': 'HOME', '/search': 'SEARCH', '/delivery': 'DELIVERY', '/dispensaries': 'DISPENSARIES' }[target],
    }),
    proposer: 'postgres-integration-court',
  });
  const principalReceiptDigest = await host.resolveVerifiedPrincipalReceipt();
  await host.persistExperienceCandidate(candidate);
  const promotion = await persistLocalPromotionCourt(host, candidate, principalReceiptDigest);
  return {
    adapter: createFullFabricAdapter(host),
    candidate,
    principalReceiptDigest,
    promotion,
  };
}

test('failed Experience execution durably consumes its claim and refuses replay', async () => {
  const executionTenant = `weld-experience-retry-${randomUUID()}`;
  let attempts = 0;
  const context = await executableExperience({
    executionTenant,
    target: '/delivery',
    execute: async () => {
      attempts += 1;
      throw new Error('EXECUTOR_FAILED');
    },
  });
  const execute = () => executeExperienceThroughCanonicalAuthority(context.adapter, {
    candidate: context.candidate,
    principalReceiptDigest: context.principalReceiptDigest,
    promotionReceiptDigest: context.promotion.receiptDigest,
  });

  await assert.rejects(execute, /EXECUTOR_FAILED/);
  assert.equal(attempts, 1);
  assert.equal(await prisma.canaEvidenceReceipt.count({
    where: { tenant: executionTenant, kind: 'EXPERIENCE_EXECUTION' },
  }), 1);
  assert.equal(await prisma.canaIntelligenceRecord.count({
    where: { tenant: executionTenant, recordType: 'EXPERIENCE_MANIFEST' },
  }), 0);
  await assert.rejects(execute, (error) => error?.code === 'PROMOTION_REPLAYED');
  assert.equal(attempts, 1);
});

test('post-effect manifest mismatch consumes the promotion and cannot invoke the effect twice', async () => {
  const executionTenant = `weld-experience-uncertain-${randomUUID()}`;
  let effects = 0;
  const context = await executableExperience({
    executionTenant,
    target: '/delivery',
    execute: async (input) => {
      effects += 1;
      return { ...input, promotedManifest: { malformed: true }, appliedManifestDigest: input.targetManifestDigest };
    },
  });
  const execute = () => executeExperienceThroughCanonicalAuthority(context.adapter, {
    candidate: context.candidate,
    principalReceiptDigest: context.principalReceiptDigest,
    promotionReceiptDigest: context.promotion.receiptDigest,
  });

  await assert.rejects(execute, (error) => error?.code === 'EXPERIENCE_EXECUTION_RESULT_MISMATCH');
  assert.equal(effects, 1);
  assert.equal(await prisma.canaEvidenceReceipt.count({
    where: { tenant: executionTenant, kind: 'EXPERIENCE_EXECUTION' },
  }), 1);
  assert.equal(await prisma.canaIntelligenceRecord.count({
    where: { tenant: executionTenant, recordType: 'EXPERIENCE_MANIFEST' },
  }), 0);
  await assert.rejects(execute, (error) => error?.code === 'PROMOTION_REPLAYED');
  assert.equal(effects, 1);
});

test('concurrent promotion replay executes one effect and persists one runtime manifest', async () => {
  const executionTenant = `weld-experience-race-${randomUUID()}`;
  const manifest = buildManifest({ tenant: executionTenant, journey: 'SEARCH' });
  manifest.presentation.copy.title = 'Atomic concurrency court';
  let effects = 0;
  const context = await executableExperience({
    executionTenant,
    target: '/search',
    manifestAfter: manifest,
    execute: async (input) => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      effects += 1;
      return { ...input, promotedManifest: manifest, appliedManifestDigest: input.targetManifestDigest };
    },
  });
  const execute = () => executeExperienceThroughCanonicalAuthority(context.adapter, {
    candidate: context.candidate,
    principalReceiptDigest: context.principalReceiptDigest,
    promotionReceiptDigest: context.promotion.receiptDigest,
  });
  const results = await Promise.allSettled([execute(), execute()]);
  assert.equal(results.filter(({ status }) => status === 'fulfilled').length, 1);
  assert.equal(results.filter(({ status }) => status === 'rejected').length, 1);
  assert.equal(results.find(({ status }) => status === 'rejected')?.reason?.code, 'PROMOTION_REPLAYED');
  assert.equal(effects, 1);
  assert.equal(await prisma.canaEvidenceReceipt.count({
    where: { tenant: executionTenant, kind: 'EXPERIENCE_EXECUTION' },
  }), 1);
  assert.equal(await prisma.canaIntelligenceRecord.count({
    where: { tenant: executionTenant, recordType: 'EXPERIENCE_MANIFEST', status: 'PROMOTED' },
  }), 1);
});
