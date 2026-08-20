// FORECAST LEDGER courts — prediction must be falsifiable, evidence-graded,
// tamper-evident, and incapable of flattering itself.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ForecastLedger, validateForecast, verifyForecastFile } from './forecast-ledger.mjs';

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fc-')), 'forecasts.jsonl');
const NOW = new Date('2026-08-18T16:00:00Z');
const forecast = (over = {}) => ({
  target: 'geo-court-recovery',
  scope: 'db-courts',
  statement: 'the six previously-failing geo DB courts pass after schema completion',
  probability: 0.7,
  horizon: 'nowcast',
  resolves_by: '2026-08-18T18:00:00Z',
  resolution_method: 'run the named suites with the disposable-cluster env and count failures',
  input_snapshot: { migrations_applied: 6, extensions: ['postgis', 'postgis_raster', 'h3', 'h3_postgis'] },
  model: 'orchestrator-judgment/v1',
  non_business: true,
  ...over,
});
const evidence = [{ observation: 'suite output shows 0 failures', ref: 'node --test stdout' }];

test('registration fails closed on every missing or dishonest field', () => {
  assert.equal(validateForecast(forecast(), { now: NOW }), true);
  assert.throws(() => validateForecast(forecast({ probability: 1 }), { now: NOW }), /FORECAST_PROBABILITY/, 'certainty is not a forecast');
  assert.throws(() => validateForecast(forecast({ probability: 0 }), { now: NOW }), /FORECAST_PROBABILITY/);
  assert.throws(() => validateForecast(forecast({ resolves_by: '2026-08-18T15:00:00Z' }), { now: NOW }), /FORECAST_HORIZON/, 'past resolution refused');
  assert.throws(() => validateForecast(forecast({ resolution_method: '' }), { now: NOW }), /FORECAST_FIELD/);
  assert.throws(() => validateForecast(forecast({ input_snapshot: null }), { now: NOW }), /FORECAST_FIELD/);
  assert.throws(() => validateForecast(forecast({ non_business: false }), { now: NOW }), /FORECAST_CLASS/);
});

test('a forecast is PENDING at registration — emission never creates truth', () => {
  const ledger = new ForecastLedger(tmp());
  const r = ledger.register(forecast(), { now: NOW });
  assert.equal(r.registered, true);
  assert.equal(ledger.pending({ now: NOW }).length, 1);
  assert.equal(ledger.calibration().mean_brier, null, 'no resolved forecasts -> no accuracy claims');
  assert.match(ledger.calibration().note, /no accuracy claims/);
});

test('identical forecasts dedupe by content identity', () => {
  const ledger = new ForecastLedger(tmp());
  assert.equal(ledger.register(forecast(), { now: NOW }).registered, true);
  const again = ledger.register(forecast(), { now: NOW });
  assert.equal(again.registered, false);
  assert.equal(again.deduped, true);
});

test('resolution demands explicit boolean outcome and real evidence; Brier math is honest', () => {
  const ledger = new ForecastLedger(tmp());
  const { forecast_id } = ledger.register(forecast({ probability: 0.7 }), { now: NOW });
  assert.throws(() => ledger.resolve(forecast_id, { outcome: 'yes', evidence }), /OUTCOME_REQUIRED/);
  assert.throws(() => ledger.resolve(forecast_id, { outcome: true, evidence: [] }), /EVIDENCE_REQUIRED/);
  const res = ledger.resolve(forecast_id, { outcome: true, evidence, now: new Date('2026-08-18T16:30:00Z') });
  assert.equal(res.brier_score, 0.09, '(0.7-1)^2 = 0.09');
  assert.equal(res.late, false);
  assert.equal(ledger.calibration().resolved, 1);
  assert.equal(ledger.calibration().mean_brier, 0.09);
});

test('history gets no second draft: re-resolution refused; unknown forecast refused', () => {
  const ledger = new ForecastLedger(tmp());
  const { forecast_id } = ledger.register(forecast(), { now: NOW });
  ledger.resolve(forecast_id, { outcome: false, evidence, now: new Date('2026-08-18T16:30:00Z') });
  assert.throws(() => ledger.resolve(forecast_id, { outcome: true, evidence }), /ALREADY_RESOLVED/);
  assert.throws(() => ledger.resolve('fc_deadbeef00000000', { outcome: true, evidence }), /FORECAST_UNKNOWN/);
});

test('late resolution is recorded as late, never hidden', () => {
  const ledger = new ForecastLedger(tmp());
  const { forecast_id } = ledger.register(forecast(), { now: NOW });
  const res = ledger.resolve(forecast_id, { outcome: true, evidence, now: new Date('2026-08-19T09:00:00Z') });
  assert.equal(res.late, true);
});

test('tamper detection: mutation, deletion, reorder, replay all break the chain and appends quarantine', () => {
  const file = tmp();
  const ledger = new ForecastLedger(file);
  const a = ledger.register(forecast(), { now: NOW });
  ledger.register(forecast({ statement: 'a second distinct claim about the future', target: 'other' }), { now: NOW });
  ledger.resolve(a.forecast_id, { outcome: true, evidence, now: new Date('2026-08-18T16:30:00Z') });
  const original = fs.readFileSync(file, 'utf8');
  const lines = original.trim().split('\n');

  fs.writeFileSync(file, original.replace('"probability":0.7', '"probability":0.95'));
  assert.equal(verifyForecastFile(file).valid, false, 'a flattering rewrite breaks the chain');
  fs.writeFileSync(file, [lines[0], lines[2]].join('\n') + '\n');
  assert.equal(verifyForecastFile(file).valid, false);
  fs.writeFileSync(file, [lines[1], lines[0], lines[2]].join('\n') + '\n');
  assert.equal(verifyForecastFile(file).valid, false);
  fs.writeFileSync(file, [...lines, lines[1]].join('\n') + '\n');
  assert.equal(verifyForecastFile(file).valid, false);

  fs.writeFileSync(file, original.replace('"probability":0.7', '"probability":0.95'));
  assert.throws(() => new ForecastLedger(file).register(forecast({ target: 'x', statement: 'y new claim here' }), { now: NOW }), /CHAIN_BROKEN/);
  assert.ok(fs.readdirSync(path.dirname(file)).some((f) => f.includes('quarantined')));
});

test('rollback-safe: the ledger reads with node builtins alone', () => {
  const file = tmp();
  const ledger = new ForecastLedger(file);
  ledger.register(forecast(), { now: NOW });
  const verdict = verifyForecastFile(file);
  assert.equal(verdict.valid, true);
  assert.equal(verdict.count, 1);
});
