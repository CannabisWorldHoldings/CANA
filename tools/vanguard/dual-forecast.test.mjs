// DUAL PREDICTION courts — two distinct predictors, one sealed snapshot,
// reality grades both, the baseline can win, and the chain holds custody.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { DualForecast, DIVERGENCE_THRESHOLD } from './dual-forecast.mjs';
import { verifyFlywheelFile } from '../alive-loop/flywheel.mjs';
import { verifyForecastFile } from '../alive-loop/forecast-ledger.mjs';

const rig = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'duel-'));
  return { d, df: new DualForecast({ forecastsPath: path.join(d, 'ledger.jsonl'), duelsPath: path.join(d, 'duels.jsonl') }) };
};
const base = (over = {}) => ({
  target: 'next pulse closes steady', scope: 'governor', statement: 'the next governor pulse closes STEADY_STATE',
  resolves_by: new Date(Date.now() + 86400000).toISOString(),
  resolution_method: 'governor pulse receipt in the chained ledger',
  input_snapshot: { heartbeats: 9, admitted: 1 },
  champion: { model: 'orchestrator-informed/1', probability: 0.9, basis: 'no live signals expected; sweep strict at registration' },
  baseline: { model: 'naive-base-rate/1', probability: 0.86, basis: 'empirical steady-state rate over recorded cycles' },
  ...over,
});

test('a duel needs two DISTINCT predictors with stated bases; both become real forecasts', () => {
  const { d, df } = rig();
  assert.throws(() => df.register(base({ baseline: { model: 'orchestrator-informed/1', probability: 0.5, basis: 'x' } })), /PREDICTORS_NOT_INDEPENDENT/);
  assert.throws(() => df.register(base({ champion: { model: 'm', probability: 1, basis: 'x' } })), /PREDICTOR_INVALID/);
  assert.throws(() => df.register(base({ champion: { model: 'm', probability: 0.7, basis: '' } })), /PREDICTOR_INVALID/);
  const r = df.register(base());
  assert.ok(r.duel_id.startsWith('duel_'));
  assert.equal(verifyForecastFile(path.join(d, 'ledger.jsonl')).count, 2, 'both predictions live in the ONE forecast ledger');
  assert.equal(r.divergence, 0.04);
  assert.equal(r.divergence_signal, false);
});

test('hard disagreement raises MODEL_FAMILY_QUESTION — divergence is a signal, not noise', () => {
  const { df } = rig();
  const r = df.register(base({ champion: { model: 'confident/1', probability: 0.95, basis: 'model view' }, baseline: { model: 'naive/1', probability: 0.5, basis: 'coin' } }));
  assert.ok(r.divergence >= DIVERGENCE_THRESHOLD);
  assert.equal(r.divergence_signal, true);
  const reg = df.records().find((x) => x.kind === 'DUEL_REGISTERED');
  assert.equal(reg.payload.divergence_signal, 'MODEL_FAMILY_QUESTION');
});

test('reality grades BOTH; the winner is arithmetic; the baseline can beat the champion and the ledger says so plainly', () => {
  const { df } = rig();
  const r = df.register(base({ champion: { model: 'overconfident/1', probability: 0.95, basis: 'hubris' }, baseline: { model: 'naive/1', probability: 0.6, basis: 'base rate' } }));
  const res = df.resolve(r.duel_id, { outcome: false, evidence: [{ observation: 'pulse ran a contest instead', ref: 'governor.jsonl seq N' }] });
  assert.equal(res.baseline_beat_champion, true, 'the naive baseline won');
  assert.equal(res.winner, 'naive/1');
  assert.ok(res.champion_brier > res.baseline_brier);
  const row = df.records().find((x) => x.kind === 'DUEL_RESOLVED');
  assert.match(row.payload.note, /cannot beat triviality/);
  assert.throws(() => df.resolve(r.duel_id, { outcome: true, evidence: [{ observation: 'x', ref: 'y' }] }), /ALREADY_RESOLVED/);
});

test('the scoreboard keeps per-predictor calibration across duels — memory with teeth', () => {
  const { df } = rig();
  const r1 = df.register(base());
  df.resolve(r1.duel_id, { outcome: true, evidence: [{ observation: 'steady receipt', ref: 'chain' }] });
  const r2 = df.register(base({ statement: 'second pulse also steady', champion: { model: 'orchestrator-informed/1', probability: 0.8, basis: 'still quiet' }, baseline: { model: 'naive-base-rate/1', probability: 0.86, basis: 'rate' } }));
  df.resolve(r2.duel_id, { outcome: true, evidence: [{ observation: 'steady receipt', ref: 'chain' }] });
  const s = df.scoreboard();
  assert.equal(s['orchestrator-informed/1'].duels, 2);
  assert.equal(s['naive-base-rate/1'].duels, 2);
  assert.ok(s['orchestrator-informed/1'].wins + s['naive-base-rate/1'].wins <= 2);
  assert.ok(typeof s['naive-base-rate/1'].mean_brier === 'number');
});

test('custody: the duel chain verifies strict and open() reports unresolved duels', () => {
  const { d, df } = rig();
  const r = df.register(base());
  assert.equal(df.open().length, 1);
  assert.equal(verifyFlywheelFile(path.join(d, 'duels.jsonl')).valid, true);
  const raw = fs.readFileSync(path.join(d, 'duels.jsonl'), 'utf8');
  fs.writeFileSync(path.join(d, 'duels.jsonl'), raw.replace('orchestrator-informed', 'rewritten-history'));
  assert.equal(verifyFlywheelFile(path.join(d, 'duels.jsonl')).valid, false, 'body mutation caught');
});
