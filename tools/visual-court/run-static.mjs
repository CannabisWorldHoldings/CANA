#!/usr/bin/env node
// VISUAL COURT v1 — static run: collector → laws → verdict receipt (stdout JSON).
// Usage: node tools/visual-court/run-static.mjs [rootDir]
// Exit 0 = PASS, 1 = FAIL. This is the CI-executable floor of the court;
// the rendered harness (screenshot-harness.mjs) is the full instrument.
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  checkChipVocabulary,
  checkPublicCopyVocabulary,
  checkConsumerShellPurity,
  checkHeaderHeight,
  checkHomeComposition,
  checkNavCensus,
  checkRailContract,
  checkTrioBreakpoints,
  checkTypeTokens,
  courtVerdict,
} from './checks.mjs';
import { collectStaticInputs } from './static-collector.mjs';

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const rootDir = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_ROOT;

const inputs = collectStaticInputs(rootDir);
const { CHIP_KINDS } = await import(
  path.join(rootDir, 'apps', 'web', 'src', 'lib', 'label-vocabulary.mjs')
);

const checks = [
  checkHeaderHeight(inputs.headerHeight),
  checkNavCensus(inputs.navCensus),
  checkConsumerShellPurity(inputs.shellPurity),
  checkTypeTokens(inputs.typeTokens),
  checkTrioBreakpoints(inputs.trioBreakpoints),
  checkRailContract(inputs.railContract),
  checkHomeComposition(inputs.homeComposition),
  checkPublicCopyVocabulary(inputs.publicCopyVocabulary),
  // Static mode proves the vocabulary MODULE is the closed 8-set; rendered
  // mode censuses actual chips on pages.
  checkChipVocabulary({ chipKindsInUse: [...CHIP_KINDS], allowedKinds: [...CHIP_KINDS] }),
];

const verdict = courtVerdict(checks, 'STATIC');
console.log(JSON.stringify(verdict, null, 2));
process.exitCode = verdict.verdict === 'PASS' ? 0 : 1;
