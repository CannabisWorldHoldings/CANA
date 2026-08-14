import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  checkChipVocabulary,
  checkConsumerShellPurity,
  checkHeaderHeight,
  checkImageRegistry,
  checkNavCensus,
  checkOverflow,
  checkRailContract,
  checkTrioBreakpoints,
  checkTypeTokens,
  courtVerdict,
} from '../../../tools/visual-court/checks.mjs';
import { collectStaticInputs } from '../../../tools/visual-court/static-collector.mjs';
import { CHIP_KINDS } from '../src/lib/label-vocabulary.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('the current repository passes every static visual-court law', () => {
  assert.ok(existsSync(path.join(ROOT, 'apps/web/src/app/[domain]/layout.tsx')));
  const inputs = collectStaticInputs(ROOT);
  const checks = [
    checkHeaderHeight(inputs.headerHeight),
    checkNavCensus(inputs.navCensus),
    checkConsumerShellPurity(inputs.shellPurity),
    checkTypeTokens(inputs.typeTokens),
    checkTrioBreakpoints(inputs.trioBreakpoints),
    checkRailContract(inputs.railContract),
  ];
  const verdict = courtVerdict(checks, 'STATIC');
  assert.equal(verdict.verdict, 'PASS', JSON.stringify(verdict.checks, null, 2));
});

test('the dashboard-regression tampers all fail closed', () => {
  // The 80px header returns → FAIL.
  assert.equal(checkHeaderHeight({ desktopPx: 80 }).status, 'FAIL');
  // Chrome regrows chips/toggles → FAIL.
  assert.equal(checkNavCensus({ navLinkCount: 6, forbiddenPresent: ['DaypartThemeControl'] }).status, 'FAIL');
  assert.equal(checkNavCensus({ navLinkCount: 9, forbiddenPresent: [] }).status, 'FAIL');
  // The operator strip leaks back into the consumer shell → FAIL.
  assert.equal(checkConsumerShellPurity({ operatorArtifacts: ['operator-strip'] }).status, 'FAIL');
  // Body drifts off 17px → FAIL.
  assert.equal(checkTypeTokens({ tokens: { '--owd-type-body': '19px' } }).status, 'FAIL');
  // Trio boundaries removed → FAIL.
  assert.equal(checkTrioBreakpoints({ mediaBlocks: ['@media (max-width: 640px)'] }).status, 'FAIL');
  // Rail loses snap or its minimum refusal → FAIL.
  assert.equal(checkRailContract({ hasSnap: false, hasMinRefusal: true, paddlesPointerOnly: true }).status, 'FAIL');
  assert.equal(checkRailContract({ hasSnap: true, hasMinRefusal: false, paddlesPointerOnly: true }).status, 'FAIL');
});

test('the chip vocabulary law rejects alien badges and holds for the closed set', () => {
  assert.equal(checkChipVocabulary({ chipKindsInUse: [...CHIP_KINDS], allowedKinds: [...CHIP_KINDS] }).status, 'PASS');
  assert.equal(
    checkChipVocabulary({ chipKindsInUse: ['VERIFIED', 'BEST_SELLER'], allowedKinds: [...CHIP_KINDS] }).status,
    'FAIL',
  );
});

test('rendered-mode laws judge overflow and unregistered imagery', () => {
  assert.equal(checkOverflow({ overflowingWidths: [] }).status, 'PASS');
  assert.equal(checkOverflow({ overflowingWidths: ['/ light@393'] }).status, 'FAIL');
  assert.equal(checkImageRegistry({ unregistered: [] }).status, 'PASS');
  assert.equal(checkImageRegistry({ unregistered: ['/random/rogue.png'] }).status, 'FAIL');
});

test('the verdict never claims taste — human gates are explicitly out of scope', () => {
  const verdict = courtVerdict([checkOverflow({ overflowingWidths: [] })], 'STATIC');
  assert.match(verdict.note, /Human gates C1–C5/);
  assert.equal(verdict.verdict, 'PASS');
});
