import assert from 'node:assert/strict';
import { test } from 'node:test';

import { censusVerdict, loadOwners } from './capability-census.mjs';

test('official retailer identity admission resolves to one canonical owner', () => {
  const result = censusVerdict(
    'official-regulator-backed retailer identity admission for existing Reality Compiler source records',
    loadOwners(),
  );

  assert.equal(result.verdict, 'REFUSED_DUPLICATE');
  assert.deepEqual(
    result.collisions.map((entry) => entry.capability),
    ['official-retailer-identity-admission'],
  );
  assert.deepEqual(
    result.collisions[0].owner_paths_present,
    result.collisions[0].owner_paths,
  );
});
