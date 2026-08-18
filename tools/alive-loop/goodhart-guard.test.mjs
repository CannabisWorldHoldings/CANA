// GOODHART GUARD courts — the judge must be appointed before the contest,
// unbribable afterward, and never the same eyes that picked the contestants.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { GoodhartGuard, verifyGuardFile } from './goodhart-guard.mjs';

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gg-'));
const SALT = 'a-long-salt-string-well-over-16-chars';
const evidence = [{ observation: 'metric verdict from receipts', ref: 'metric stdout' }];

function setup() {
  const d = dir();
  const guard = new GoodhartGuard(path.join(d, 'guard.jsonl'));
  const metric = path.join(d, 'metric.mjs');
  fs.writeFileSync(metric, 'export const judge = (x) => x > 0;\n');
  return { d, guard, metric };
}

test('a judge is appointed once, before the contest, with a real salt', () => {
  const { guard, metric } = setup();
  const c = guard.commitConfirmation({ metricId: 'm1', scriptPath: metric, salt: SALT, purpose: 'confirm improvement' });
  assert.equal(c.committed, true);
  assert.throws(() => guard.commitConfirmation({ metricId: 'm1', scriptPath: metric, salt: SALT, purpose: 'again' }), /ALREADY_COMMITTED/);
  assert.throws(() => guard.commitConfirmation({ metricId: 'm2', scriptPath: metric, salt: 'short', purpose: 'p' }), /SALT_REQUIRED/);
  assert.throws(() => guard.commitConfirmation({ metricId: 'm3', scriptPath: '/nope.mjs', salt: SALT, purpose: 'p' }), /METRIC_SCRIPT_ABSENT/);
});

test('confirmation refuses an uncommitted judge', () => {
  const { guard } = setup();
  assert.throws(() => guard.confirm({ metricId: 'ghost', salt: SALT, runner: () => ({ improved: true, evidence }) }), /METRIC_UNCOMMITTED/);
});

test('the judge cannot be edited after candidates exist — bytes drift refuses', () => {
  const { guard, metric } = setup();
  guard.commitConfirmation({ metricId: 'm1', scriptPath: metric, salt: SALT, purpose: 'confirm' });
  fs.appendFileSync(metric, '// flattering tweak added after seeing candidates\n');
  assert.throws(() => guard.confirm({ metricId: 'm1', salt: SALT, runner: () => ({ improved: true, evidence }) }), /JUDGE_DRIFTED/);
});

test('selection eyes cannot confirm — reuse as selection signal contaminates', () => {
  const { guard, metric } = setup();
  guard.commitConfirmation({ metricId: 'm1', scriptPath: metric, salt: SALT, purpose: 'confirm' });
  guard.recordSelectionUse({ metricId: 'm1', context: 'used to rank candidates in generation phase' });
  assert.throws(() => guard.confirm({ metricId: 'm1', salt: SALT, runner: () => ({ improved: true, evidence }) }), /SELECTION_CONTAMINATED/);
});

test('a clean blind confirmation runs, demands evidence, and receipts the verdict', () => {
  const { guard, metric } = setup();
  guard.commitConfirmation({ metricId: 'm1', scriptPath: metric, salt: SALT, purpose: 'confirm' });
  assert.throws(() => guard.confirm({ metricId: 'm1', salt: SALT, runner: () => ({ improved: 'yes', evidence }) }), /CONFIRMATION_INVALID/);
  assert.throws(() => guard.confirm({ metricId: 'm1', salt: SALT, runner: () => ({ improved: true, evidence: [] }) }), /EVIDENCE_REQUIRED/);
  const r = guard.confirm({ metricId: 'm1', salt: SALT, runner: () => ({ improved: true, evidence }) });
  assert.equal(r.confirmed, true);
  assert.equal(r.improved, true);
  assert.equal(guard.verifyChain().valid, true);
});

test('custody: body mutation, deletion, reorder, replay all break the chain; appends quarantine', () => {
  const { guard, metric, d } = setup();
  guard.commitConfirmation({ metricId: 'm1', scriptPath: metric, salt: SALT, purpose: 'confirm improvement honestly' });
  guard.recordSelectionUse({ metricId: 'other', context: 'ranking' });
  const file = path.join(d, 'guard.jsonl');
  const original = fs.readFileSync(file, 'utf8');
  const lines = original.trim().split('\n');

  fs.writeFileSync(file, original.replace('confirm improvement honestly', 'a flattering rewritten purpose'));
  assert.equal(verifyGuardFile(file).valid, false, 'payload body mutation breaks the chain');
  fs.writeFileSync(file, lines.slice(1).join('\n') + '\n');
  assert.equal(verifyGuardFile(file).valid, false);
  fs.writeFileSync(file, [lines[1], lines[0]].join('\n') + '\n');
  assert.equal(verifyGuardFile(file).valid, false);
  fs.writeFileSync(file, [...lines, lines[0]].join('\n') + '\n');
  assert.equal(verifyGuardFile(file).valid, false);

  fs.writeFileSync(file, original.replace('confirm improvement honestly', 'x'));
  assert.throws(() => new GoodhartGuard(file).recordSelectionUse({ metricId: 'z' }), /CHAIN_BROKEN/);
  assert.ok(fs.readdirSync(d).some((f) => f.includes('quarantined')));
});

test('rollback-safe: the ledger verifies with node builtins alone', () => {
  const { guard, metric, d } = setup();
  guard.commitConfirmation({ metricId: 'm1', scriptPath: metric, salt: SALT, purpose: 'confirm' });
  const verdict = verifyGuardFile(path.join(d, 'guard.jsonl'));
  assert.equal(verdict.valid, true);
  assert.equal(verdict.count, 1);
});
