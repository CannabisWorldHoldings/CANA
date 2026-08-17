import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildEvidenceReceipt,
  CHIP_KINDS,
  chipLabel,
  isAllowedChip,
  PUBLIC_WORLD_STATE_LABELS,
  publicWorldStateLabel,
} from '../src/lib/label-vocabulary.mjs';

test('the chip vocabulary is closed at exactly eight kinds', () => {
  assert.equal(CHIP_KINDS.length, 8);
  assert.equal(isAllowedChip('VERIFIED'), true);
  assert.equal(isAllowedChip('BEST_SELLER'), false);
  assert.equal(isAllowedChip('PREMIUM'), false);
});

test('fixed chips resolve their canonical labels and reject invented kinds', () => {
  assert.equal(chipLabel('VERIFIED'), 'Verified');
  assert.equal(chipLabel('SPONSORED'), 'Sponsored');
  assert.equal(chipLabel('OPEN_NOW'), 'Open now');
  assert.equal(chipLabel('UNKNOWN'), 'Unknown');
  assert.throws(() => chipLabel('HOT_PICK'), /closed vocabulary/);
});

test('dynamic chips require a real value', () => {
  assert.equal(chipLabel('DEAL', '20% off first order'), '20% off first order');
  assert.equal(chipLabel('NEIGHBORHOOD', 'Dupont Circle'), 'Dupont Circle');
  assert.throws(() => chipLabel('DEAL', '   '), /real value/);
  assert.throws(() => chipLabel('NEIGHBORHOOD'), /real value/);
});

test('evidence receipts refuse to exist without claim rows', () => {
  assert.equal(buildEvidenceReceipt(), null);
  assert.equal(buildEvidenceReceipt({ claims: [] }), null);
  assert.equal(buildEvidenceReceipt({ claims: [], unknowns: ['hours'] }), null);
});

test('verified rows with provenance become known facts; everything else demotes to uncertain', () => {
  const receipt = buildEvidenceReceipt({
    claims: [
      { field: 'License', value: 'ABC-123', source: 'ABCA registry', checkedAt: '2026-08-10T12:00:00Z', verification: 'VERIFIED' },
      { field: 'Hours', value: '9-9', source: '', checkedAt: '2026-08-10T12:00:00Z', verification: 'VERIFIED' },
      { field: 'Address', value: '1 Fixture St', source: 'ABCA registry', checkedAt: '2026-08-12T08:00:00Z', verification: 'SUPPORTED' },
      { field: 'Delivery radius', value: '?', source: 'site', checkedAt: '2026-08-01T00:00:00Z', verification: 'UNKNOWN' },
    ],
    unknowns: ['Current inventory'],
  });
  assert.equal(receipt.known.length, 2);
  assert.deepEqual(receipt.known.map((row) => row.field), ['License', 'Address']);
  assert.deepEqual(receipt.sources, ['ABCA registry']);
  assert.equal(receipt.latestCheckedAt, '2026-08-12T08:00:00.000Z');
  const uncertainFields = receipt.uncertain.map((row) => row.field);
  assert.deepEqual(uncertainFields, ['Hours', 'Delivery radius', 'Current inventory']);
  assert.equal(receipt.uncertain[0].reason, 'NO_PROVENANCE');
  assert.equal(receipt.uncertain[1].reason, 'UNKNOWN');
});

test('a receipt of only-uncertain rows is still an honest receipt', () => {
  const receipt = buildEvidenceReceipt({
    claims: [{ field: 'Delivery eligibility', verification: 'UNKNOWN' }],
  });
  assert.equal(receipt.known.length, 0);
  assert.equal(receipt.uncertain.length, 1);
  assert.equal(receipt.latestCheckedAt, null);
});

test('public world-state labels translate every machine state and fail closed', () => {
  assert.equal(publicWorldStateLabel('INPUT_REQUIRED'), 'Add a location');
  assert.equal(publicWorldStateLabel('CAPABILITY_GAP'), 'Partly answerable');
  assert.equal(publicWorldStateLabel('EMPTY'), 'Nothing verified yet');
  assert.equal(publicWorldStateLabel('RESULTS'), 'Verified results');
  assert.equal(publicWorldStateLabel('SOMETHING_INTERNAL'), 'Status unavailable');
  for (const label of Object.values(PUBLIC_WORLD_STATE_LABELS)) {
    assert.doesNotMatch(label, /_|Reality|canonical/);
  }
});
