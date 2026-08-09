/**
 * ASK ORDERWEEDDC — candidate `where` falsification (pure).
 *
 * The query gate is the truth boundary: these tests prove the ask surface
 * cannot drift from the UI's publication gate, and that location matching is
 * explicitly case-insensitive (the documented SQLite->PostgreSQL silent-
 * failure class: "dupont" must match "Dupont Circle").
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { answerIntent, buildCandidateWhere } from '../src/lib/ask/ask-service.mjs';
import { askPersistenceScope } from '../src/lib/ask/ask-work.mjs';
import { compileIntent } from '../src/lib/ask/intent-ir.mjs';
import {
  checkPublicSubmissionThrottle,
  PUBLIC_SUBMISSION_POLICY,
  PUBLIC_SUBMISSION_SURFACES,
} from '../src/lib/public-submission.mjs';

const NOW = new Date('2026-08-09T12:00:00Z');
const BRAND = 'brand-1';

test('ASK persistence scope is tenant-controlled, never a caller-supplied proxy identity', () => {
  assert.equal(askPersistenceScope('orderweeddc.com'), 'tenant:orderweeddc.com');
  for (const untrusted of [
    '',
    'ORDERWEEDDC.COM',
    'orderweeddc.com, 203.0.113.4',
    '../tenant',
    '.orderweeddc.com',
    'orderweeddc.com.',
    'orderweeddc..com',
    '-orderweeddc.com',
    'orderweeddc-.com',
  ]) {
    assert.throws(() => askPersistenceScope(untrusted), /canonical tenant domain/);
  }
});

test('ASK tenant budgets cannot exhaust one another through the shared public surface quota', async () => {
  const db = {
    publicSubmissionEvent: {
      async count({ where }) {
        return where.clientDigest
          ? PUBLIC_SUBMISSION_POLICY.clientLimit - 1
          : PUBLIC_SUBMISSION_POLICY.surfaceLimit + 1;
      },
    },
  };
  const decision = await checkPublicSubmissionThrottle(db, {
    clientIdentity: askPersistenceScope('orderweeddc.com'),
    surface: PUBLIC_SUBMISSION_SURFACES.ASK,
    now: NOW,
  });
  assert.equal(decision.clientCount, PUBLIC_SUBMISSION_POLICY.clientLimit - 1);
  assert.equal(decision.surfaceCount, PUBLIC_SUBMISSION_POLICY.surfaceLimit + 1);
  assert.equal(decision.allowed, true);
});

test('the evidence gate travels with every ask query, verbatim', () => {
  const where = buildCandidateWhere(compileIntent('anything', { now: NOW }), { brandId: BRAND, now: NOW });
  assert.equal(where.isDemonstration, false);
  assert.equal(where.dataStatus, 'VERIFIED_CURRENT');
  assert.deepEqual(where.verifiedAt, { not: null });
  assert.ok(where.freshnessExpiresAt.gt instanceof Date);
  assert.deepEqual(where.menus, { some: { brandMenus: { some: { brandId: BRAND } } } });
});

test('a KNOWN location becomes an EXPLICITLY case-insensitive contains match', () => {
  const where = buildCandidateWhere(compileIntent('flower in dupont', { now: NOW }), { brandId: BRAND, now: NOW });
  assert.ok(Array.isArray(where.OR));
  for (const clause of where.OR) {
    const field = Object.values(clause)[0];
    assert.equal(field.mode, 'insensitive', 'never rely on collation defaults');
    assert.equal(field.contains, 'dupont circle');
  }
});

test('an UNKNOWN location adds NO location filter — the compiler never guessed one', () => {
  const where = buildCandidateWhere(compileIntent('weed near me', { now: NOW }), { brandId: BRAND, now: NOW });
  assert.equal(where.OR, undefined);
});

test('known unsupported decision dimensions produce an honest CAPABILITY_GAP, not fabricated matches', async () => {
  let reads = 0;
  const prisma = { retailer: { findMany: async () => { reads += 1; return []; } } };
  const intent = compileIntent('delivery flower under $30 in dupont open now', { now: NOW });
  const answer = await answerIntent(prisma, {
    intent, brandId: BRAND, tenantDomain: 'orderweeddc.com', now: NOW,
  });
  assert.equal(reads, 0, 'an ineligible query must not be disguised as a market-store result');
  assert.deepEqual(answer.candidates, []);
  assert.equal(answer.zero_result_reason, 'UNSUPPORTED_VERIFIED_DIMENSION');
  assert.deepEqual(answer.unsupported_known_dimensions, ['category', 'price_max_usd', 'fulfillment', 'open_now']);
  assert.equal(answer.opportunitySpec.kind, 'CAPABILITY_GAP');
});

test('unknown location yields an honest zero without inventing nearby supply or market work', async () => {
  let reads = 0;
  const prisma = { retailer: { findMany: async () => { reads += 1; return []; } } };
  const intent = compileIntent('weed near me', { now: NOW });
  const answer = await answerIntent(prisma, {
    intent, brandId: BRAND, tenantDomain: 'orderweeddc.com', now: NOW,
  });
  assert.equal(reads, 0);
  assert.deepEqual(answer.candidates, []);
  assert.equal(answer.zero_result_reason, 'REQUIRED_INTENT_DIMENSION_UNKNOWN');
  assert.equal(answer.opportunitySpec, null, 'missing customer context is not fabricated into a market gap');
});
