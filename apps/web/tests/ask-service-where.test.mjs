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
import { buildCandidateWhere } from '../src/lib/ask/ask-service.mjs';
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
