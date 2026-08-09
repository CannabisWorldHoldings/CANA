/**
 * ASK ORDERWEEDDC — Intent IR falsification suite.
 *
 * The law under attack: THE COMPILER NEVER GUESSES. Every dimension is
 * KNOWN-with-evidence or UNKNOWN, and vague language does not become data.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { compileIntent } from '../src/lib/ask/intent-ir.mjs';

const NOW = new Date('2026-08-09T12:00:00Z');

test('unknowns stay unknown: "weed near me" invents NO location, category, or price', () => {
  const ir = compileIntent('weed near me', { now: NOW });
  assert.equal(ir.dimensions.location.status, 'UNKNOWN');
  assert.equal(ir.dimensions.location.value, null);
  assert.equal(ir.dimensions.category.status, 'UNKNOWN');
  assert.equal(ir.dimensions.price_max_usd.status, 'UNKNOWN');
  assert.ok(ir.unknown_dimensions.includes('location'));
});

test('vague price language ("cheap") does NOT become a number', () => {
  const ir = compileIntent('cheap edibles', { now: NOW });
  assert.equal(ir.dimensions.price_max_usd.status, 'UNKNOWN');
  assert.equal(ir.dimensions.category.value, 'edible');
});

test('a stated number becomes a KNOWN price ceiling with its evidence token', () => {
  const ir = compileIntent('gummies under $30 in shaw', { now: NOW });
  assert.equal(ir.dimensions.price_max_usd.status, 'KNOWN');
  assert.equal(ir.dimensions.price_max_usd.value, 30);
  assert.equal(ir.dimensions.category.value, 'edible');
  assert.equal(ir.dimensions.location.value, 'shaw');
});

test('location tokens match on word boundaries: "rickshaw" is NOT shaw', () => {
  const ir = compileIntent('rickshaw delivery', { now: NOW });
  assert.equal(ir.dimensions.location.status, 'UNKNOWN');
  assert.equal(ir.dimensions.fulfillment.value, 'delivery');
});

test('longest location token wins: "dupont circle" and bare "dupont" both compile to dupont circle', () => {
  assert.equal(compileIntent('flower near dupont circle', { now: NOW }).dimensions.location.value, 'dupont circle');
  assert.equal(compileIntent('flower in dupont', { now: NOW }).dimensions.location.value, 'dupont circle');
});

test('fulfillment and open-now compile only from explicit language', () => {
  const ir = compileIntent('delivery open now in navy yard', { now: NOW });
  assert.equal(ir.dimensions.fulfillment.value, 'delivery');
  assert.equal(ir.dimensions.open_now.value, true);
  const quiet = compileIntent('navy yard', { now: NOW });
  assert.equal(quiet.dimensions.fulfillment.status, 'UNKNOWN');
  assert.equal(quiet.dimensions.open_now.status, 'UNKNOWN');
});

test('open-right-now evidence preserves the phrase that actually matched', () => {
  const ir = compileIntent('flower in shaw open right now', { now: NOW });
  assert.equal(ir.dimensions.open_now.value, true);
  assert.equal(ir.dimensions.open_now.matched_token, 'open right now');
});

test('deterministic: identical input compiles to identical IR (same injected clock)', () => {
  const a = compileIntent('prerolls in georgetown under $25', { now: NOW });
  const b = compileIntent('prerolls in georgetown under $25', { now: NOW });
  assert.deepEqual(a, b);
});

test('hostile/degenerate input never throws and never fabricates', () => {
  for (const input of ['', '   ', null, undefined, '<script>alert(1)</script>', '$$$$$', 'a'.repeat(10_000)]) {
    const ir = compileIntent(input, { now: NOW });
    assert.equal(typeof ir.raw_query, 'string');
    assert.ok(ir.raw_query.length <= 500);
    for (const dim of Object.values(ir.dimensions)) {
      assert.ok(dim.status === 'KNOWN' || dim.status === 'UNKNOWN');
      if (dim.status === 'UNKNOWN') assert.equal(dim.value, null);
    }
  }
});

test('every KNOWN dimension carries the evidence token that produced it', () => {
  const ir = compileIntent('vape carts pickup in adams morgan', { now: NOW });
  for (const [name, dim] of Object.entries(ir.dimensions)) {
    if (dim.status === 'KNOWN') {
      assert.ok(dim.matched_token, `${name} KNOWN without evidence token`);
    }
  }
});
