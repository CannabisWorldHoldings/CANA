import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import {
  PUBLIC_SUBMISSION_POLICY,
  PUBLIC_SUBMISSION_SURFACES,
  PublicSubmissionDuplicateError,
  PublicSubmissionThrottleError,
  reservePublicSubmission,
} from '../src/lib/public-submission.mjs';

const prisma = new PrismaClient();
const runId = randomUUID();
const clientIdentity = `integration-${runId}`;
const eventIds = [];
let baseline;
let baselineCorrection;

async function reserve(subject, offsetMs = 0) {
  const result = await prisma.$transaction((transaction) =>
    reservePublicSubmission(transaction, {
      clientIdentity,
      subject: `${runId}:${subject}`,
      surface: PUBLIC_SUBMISSION_SURFACES.CLAIM,
      now: new Date(Date.now() + offsetMs),
    }),
  );
  eventIds.push(result.eventId);
  return result;
}

try {
  baseline = await prisma.publicSubmissionEvent.count();
  baselineCorrection = await prisma.publicSubmissionEvent.count({
    where: { surface: PUBLIC_SUBMISSION_SURFACES.CORRECTION },
  });
  const first = await reserve('first');
  assert.equal(first.clientCount, 1);
  assert.equal(first.surfaceCount >= 1, true);

  const persisted = await prisma.publicSubmissionEvent.findUnique({
    where: {
      id: first.eventId,
    },
  });
  assert.ok(persisted);
  assert.match(persisted.clientDigest, /^[a-f0-9]{64}$/);
  assert.match(persisted.subjectDigest, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(persisted), new RegExp(runId, 'i'));

  await assert.rejects(
    prisma.$transaction((transaction) =>
      reservePublicSubmission(transaction, {
        clientIdentity: `${clientIdentity}-other`,
        subject: `${runId}:first`,
        surface: PUBLIC_SUBMISSION_SURFACES.CLAIM,
      }),
    ),
    PublicSubmissionDuplicateError,
  );
  assert.equal(await prisma.publicSubmissionEvent.count(), baseline + 1);

  for (
    let attempt = 2;
    attempt <= PUBLIC_SUBMISSION_POLICY.clientLimit;
    attempt += 1
  ) {
    await reserve(`client-limit-${attempt}`, attempt);
  }
  await assert.rejects(
    prisma.$transaction((transaction) =>
      reservePublicSubmission(transaction, {
        clientIdentity,
        subject: `${runId}:client-over-limit`,
        surface: PUBLIC_SUBMISSION_SURFACES.CLAIM,
      }),
    ),
    PublicSubmissionThrottleError,
  );
  assert.equal(
    await prisma.publicSubmissionEvent.count(),
    baseline + PUBLIC_SUBMISSION_POLICY.clientLimit,
  );

  await assert.rejects(
    prisma.$transaction(async (transaction) => {
      await reservePublicSubmission(transaction, {
        clientIdentity: `${clientIdentity}-rollback`,
        subject: `${runId}:forced-rollback`,
        surface: PUBLIC_SUBMISSION_SURFACES.CORRECTION,
      });
      throw new Error('Injected caller transaction failure.');
    }),
    /Injected caller transaction failure/,
  );
  assert.equal(
    await prisma.publicSubmissionEvent.count({
      where: { surface: PUBLIC_SUBMISSION_SURFACES.CORRECTION },
    }),
    baselineCorrection,
  );

  // Engine-portable index introspection. PostgreSQL is the canonical CANA
  // datastore; the SQLite branch is retained so rollback snapshots stay
  // verifiable with the same gate.
  const databaseUrl = process.env.DATABASE_URL ?? '';
  const sqlite = databaseUrl.startsWith('file:') || databaseUrl.endsWith('.db');
  const indexes = await prisma.$queryRawUnsafe(
    sqlite
      ? "PRAGMA index_list('PublicSubmissionEvent')"
      : "SELECT indexname AS name FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'PublicSubmissionEvent'",
  );
  const indexNames = new Set(indexes.map((index) => index.name));
  for (const expected of [
    'PublicSubmissionEvent_surface_subjectDigest_key',
    'PublicSubmissionEvent_surface_clientDigest_occurredAt_idx',
    'PublicSubmissionEvent_surface_occurredAt_idx',
    'PublicSubmissionEvent_expiresAt_idx',
  ]) {
    assert.equal(indexNames.has(expected), true, `Missing index ${expected}.`);
  }

  console.log('PASS: real database reservations retain only pseudonymous digests.');
  console.log('PASS: duplicate and rate-limit failures roll back atomically.');
  console.log('PASS: caller failure rolls back its reservation.');
  console.log('PASS: all public submission uniqueness and lookup indexes exist.');
} finally {
  if (eventIds.length > 0) {
    await prisma.publicSubmissionEvent.deleteMany({
      where: { id: { in: eventIds } },
    });
  }
  if (baseline !== undefined) {
    assert.equal(
      await prisma.publicSubmissionEvent.count(),
      baseline,
      'Disposable public submission cleanup did not restore the baseline.',
    );
  }
  await prisma.$disconnect();
}
