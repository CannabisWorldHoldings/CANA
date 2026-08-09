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
import { compileIntent } from '../src/lib/ask/intent-ir.mjs';

const NOW = new Date('2026-08-09T12:00:00Z');
const BRAND = 'brand-1';

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
