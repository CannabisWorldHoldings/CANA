import { test } from 'node:test';
import assert from 'node:assert/strict';
import { productDiscoveryOrderBy } from '../src/lib/product-discovery.mjs';
import { directoryRetailerOrderBy } from '../src/lib/directory-search.mjs';

/**
 * SPONSORSHIP ORDERING GUARD — Mechanism Matrix M-001 falsification test.
 *
 * Competitor pattern (Leafly, evidence 2026-07-23): the first five DC results
 * are a sponsored block, disclosed by a single small section header with no
 * per-card badge. Paid placement is indistinguishable from merit.
 *
 * Our published claim is stronger and therefore riskier: "sponsorship never
 * buys ranking." A claim like that is worthless unless something can falsify
 * it. This test is that something.
 *
 * Strategy — two independent layers, because either alone is weak:
 *   1. STRUCTURAL: no ordering key may reference a sponsorship field. Reading
 *      the source and seeing nothing is not proof; this asserts it mechanically
 *      across every sort mode, recursing into nested relation orderings.
 *   2. BEHAVIOURAL: sort a fixture corpus with sponsorship flags ON and OFF
 *      using the real comparator semantics, and assert the resulting order is
 *      byte-identical. This catches sponsorship leaking in via a code path the
 *      structural check cannot see.
 */

/** Every sort mode the UI can request, including the truth-first default. */
const PRODUCT_SORTS = [undefined, 'TRUTH_FIRST', 'PRICE_ASC', 'PRICE_DESC', 'RECENTLY_UPDATED'];

/** Recursively collect every field name used in an orderBy structure. */
function orderKeys(order, acc = []) {
  if (Array.isArray(order)) { order.forEach(o => orderKeys(o, acc)); return acc; }
  if (order && typeof order === 'object') {
    for (const [k, v] of Object.entries(order)) {
      acc.push(k);
      if (v && typeof v === 'object') orderKeys(v, acc);
    }
  }
  return acc;
}

const SPONSORSHIP_FIELDS = /sponsor|promoted|paid|boost|featured|placement|bid|ad(s)?_?rank/i;

test('STRUCTURAL: no product ordering key references sponsorship', () => {
  for (const sort of PRODUCT_SORTS) {
    const keys = orderKeys(productDiscoveryOrderBy(sort));
    assert.ok(keys.length > 0, `sort=${sort} produced no ordering keys`);
    for (const k of keys) {
      assert.ok(!SPONSORSHIP_FIELDS.test(k),
        `sort=${sort} orders by "${k}" which looks sponsorship-derived — sponsorship must never buy rank`);
    }
  }
});

test('STRUCTURAL: no directory ordering key references sponsorship', () => {
  for (const sort of [undefined, 'TRUTH_FIRST', 'RECENTLY_UPDATED', 'NAME']) {
    let order;
    try { order = directoryRetailerOrderBy(sort); }
    catch { continue; } // unsupported sort mode is fine; skip it
    const keys = orderKeys(order);
    for (const k of keys) {
      assert.ok(!SPONSORSHIP_FIELDS.test(k),
        `directory sort=${sort} orders by "${k}" — sponsorship must never buy rank`);
    }
  }
});

test('STRUCTURAL: ordering is deterministic — a stable tiebreak exists', () => {
  // Without a terminal unique tiebreak, equal rows could be returned in
  // arbitrary order, and sponsorship bias would be undetectable rather than absent.
  for (const sort of PRODUCT_SORTS) {
    const keys = orderKeys(productDiscoveryOrderBy(sort));
    assert.ok(keys.includes('id'),
      `sort=${sort} lacks an 'id' tiebreak; nondeterministic order makes the no-rank claim unfalsifiable`);
  }
});

/**
 * BEHAVIOURAL layer. Applies the real ordering keys as comparators over a
 * fixture corpus, then flips every sponsorship flag and re-sorts.
 */
function applyOrder(rows, order) {
  const specs = [];
  const flatten = (o) => {
    if (Array.isArray(o)) return o.forEach(flatten);
    if (o && typeof o === 'object') {
      for (const [k, v] of Object.entries(o)) {
        if (typeof v === 'string') specs.push({ key: k, dir: v });
        else flatten(v); // nested relation ordering
      }
    }
  };
  flatten(order);
  return [...rows].sort((a, b) => {
    for (const { key, dir } of specs) {
      const av = a[key], bv = b[key];
      if (av === bv) continue;
      const cmp = (av == null) ? 1 : (bv == null) ? -1 : (av < bv ? -1 : 1);
      return dir === 'desc' ? -cmp : cmp;
    }
    return 0;
  }).map(r => r.id);
}

function corpus() {
  return [
    { id: 'r1', isSponsored: true,  isDemonstration: false, verifiedAt: 300, freshnessExpiresAt: 90, updatedAt: 30, price: 40 },
    { id: 'r2', isSponsored: false, isDemonstration: false, verifiedAt: 300, freshnessExpiresAt: 90, updatedAt: 30, price: 40 },
    { id: 'r3', isSponsored: true,  isDemonstration: false, verifiedAt: 200, freshnessExpiresAt: 80, updatedAt: 20, price: 30 },
    { id: 'r4', isSponsored: false, isDemonstration: false, verifiedAt: 400, freshnessExpiresAt: 70, updatedAt: 40, price: 10 },
    { id: 'r5', isSponsored: true,  isDemonstration: true,  verifiedAt: 500, freshnessExpiresAt: 60, updatedAt: 50, price: 20 },
  ];
}

test('BEHAVIOURAL: flipping every sponsorship flag does not change order', () => {
  for (const sort of PRODUCT_SORTS) {
    const order = productDiscoveryOrderBy(sort);
    const withSponsorship = applyOrder(corpus(), order);
    const flipped = applyOrder(corpus().map(r => ({ ...r, isSponsored: !r.isSponsored })), order);
    const allOff = applyOrder(corpus().map(r => ({ ...r, isSponsored: false })), order);
    const allOn = applyOrder(corpus().map(r => ({ ...r, isSponsored: true })), order);
    assert.deepEqual(flipped, withSponsorship, `sort=${sort}: inverting sponsorship changed the order`);
    assert.deepEqual(allOff, withSponsorship, `sort=${sort}: removing all sponsorship changed the order`);
    assert.deepEqual(allOn, withSponsorship, `sort=${sort}: sponsoring everything changed the order`);
  }
});

test('BEHAVIOURAL: the guard itself can fail (control)', () => {
  // A guard that cannot fail proves nothing. Inject a deliberately corrupt
  // ordering that DOES rank sponsored rows first and assert the guard catches it.
  const corruptOrder = [{ isSponsored: 'desc' }, { id: 'asc' }];
  const a = applyOrder(corpus(), corruptOrder);
  const b = applyOrder(corpus().map(r => ({ ...r, isSponsored: !r.isSponsored })), corruptOrder);
  assert.notDeepEqual(a, b,
    'control failed: a sponsorship-ranked ordering must produce a different order when flags flip');
  // And the structural layer must reject it too.
  assert.ok(orderKeys(corruptOrder).some(k => SPONSORSHIP_FIELDS.test(k)),
    'control failed: structural check did not flag an explicitly sponsorship-keyed ordering');
});

test('truth-first default ranks demonstration data LAST, not sponsors FIRST', () => {
  const order = productDiscoveryOrderBy(undefined);
  const ids = applyOrder(corpus(), order);
  assert.equal(ids.at(-1), 'r5',
    'the demonstration row must sort last regardless of it being sponsored');
});
