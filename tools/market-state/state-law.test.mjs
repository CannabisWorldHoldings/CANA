// MARKET-STATE LAW courts — the four kinds must stay separate under every
// pressure: promotion, derivation, transition, and plain sloppiness.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deriveClaim, promoteToListingFact, transition, validateAssertion,
} from './state-law.mjs';

const NOW = new Date('2026-08-18T12:00:00Z');
const evidence = [{ observation: 'regulator layer row', ref: 'dcgis:abca:layer-31' }];

const observed = (over = {}) => ({
  target: 'merchant:ABCA-117379:status', state_kind: 'OBSERVED_REALITY',
  evidence, observed_at: '2026-08-18T10:00:00Z', ...over,
});
const estimated = (over = {}) => ({
  target: 'merchant:ABCA-117379:open-now', state_kind: 'ESTIMATED_CURRENT_STATE',
  method: 'hours-model over last observation', confidence: 0.7, basis: evidence,
  as_of: '2026-08-18T11:00:00Z', estimator: 'hours-estimator/1', ...over,
});
const forecast = (over = {}) => ({
  target: 'demand:ward-8:weekend', state_kind: 'FORECAST_STATE',
  forecast_ref: 'fc_35a51637296c5763', resolves_by: '2026-08-25T00:00:00Z', ...over,
});
const counterfactual = (over = {}) => ({
  target: 'merchant:ABCA-117379:if-free-month', state_kind: 'COUNTERFACTUAL_WORLD',
  intervention: 'offer one free month', method: 'cohort analogy', ...over,
});

test('every kind validates on its own terms; untyped and mistyped state is refused', () => {
  assert.equal(validateAssertion(observed()).state_kind, 'OBSERVED_REALITY');
  assert.equal(validateAssertion(estimated()).state_kind, 'ESTIMATED_CURRENT_STATE');
  assert.equal(validateAssertion(forecast()).state_kind, 'FORECAST_STATE');
  assert.equal(validateAssertion(counterfactual()).state_kind, 'COUNTERFACTUAL_WORLD');
  assert.throws(() => validateAssertion({ target: 'x' }), /STATE_KIND_REQUIRED/);
  assert.throws(() => validateAssertion(observed({ evidence: [] })), /OBSERVATION_UNEVIDENCED/);
  assert.throws(() => validateAssertion(observed({ probability: 0.9 })), /OBSERVATION_IS_NOT_A_GUESS/);
  assert.throws(() => validateAssertion(estimated({ confidence: 1 })), /ESTIMATE_CONFIDENCE/, 'certainty is an observation, not an estimate');
  assert.throws(() => validateAssertion(estimated({ estimator: '' })), /ESTIMATOR_REQUIRED/);
  assert.throws(() => validateAssertion(forecast({ forecast_ref: 'dashboard-hunch' })), /FORECAST_UNLEDGERED/);
  assert.throws(() => validateAssertion(forecast({ observed_at: '2026-08-18T10:00:00Z' })), /FORECAST_IS_NOT_OBSERVED/);
  assert.throws(() => validateAssertion(counterfactual({ observed: true })), /SIMULATION_IS_NOT_OBSERVED/);
});

test('MIXING COURT: a forecast is never inventory, an estimate is never evidence, a simulation is never a fact', () => {
  assert.equal(promoteToListingFact(observed(), { now: NOW }).eligible, true);
  assert.throws(() => promoteToListingFact(forecast(), { now: NOW }), /FORECAST_IS_NOT_INVENTORY/);
  assert.throws(() => promoteToListingFact(estimated(), { now: NOW }), /ESTIMATE_IS_NOT_EVIDENCE/);
  assert.throws(() => promoteToListingFact(counterfactual(), { now: NOW }), /SIMULATION_IS_NOT_A_FACT/);
  assert.throws(
    () => promoteToListingFact(observed({ observed_at: '2026-05-01T00:00:00Z' }), { now: NOW, maxAgeDays: 30 }),
    /OBSERVATION_STALE/,
    'stale observations must decay explicitly, not linger as current truth',
  );
});

test('LAUNDERING COURT: a derived claim carries the weakest input kind; stronger declarations refuse', () => {
  const derived = deriveClaim({ target: 'ward-8:availability-outlook', inputs: [observed(), forecast()] });
  assert.equal(derived.state_kind, 'FORECAST_STATE', 'observed × forecast derives a forecast, never an observation');
  assert.throws(
    () => deriveClaim({ target: 'x', inputs: [observed(), estimated()], declared_kind: 'OBSERVED_REALITY' }),
    /TYPE_LAUNDERING/,
  );
  assert.throws(
    () => deriveClaim({ target: 'x', inputs: [observed(), counterfactual()], declared_kind: 'FORECAST_STATE' }),
    /TYPE_LAUNDERING/,
    'counterfactual inputs cap the chain at counterfactual',
  );
  const honest = deriveClaim({ target: 'x', inputs: [observed(), estimated()], declared_kind: 'ESTIMATED_CURRENT_STATE' });
  assert.equal(honest.state_kind, 'ESTIMATED_CURRENT_STATE');
  assert.throws(() => deriveClaim({ target: 'x', inputs: [] }), /DERIVATION_EMPTY/);
});

test('TRANSITION COURT: decay is explicit and recorded; upgrades demand new observation evidence', () => {
  const decay = transition(observed(), { to: 'ESTIMATED_CURRENT_STATE', method: 'staleness decay', estimator: 'decay/1', now: NOW });
  assert.equal(decay.transitioned, true);
  assert.equal(decay.record.state_kind, 'ESTIMATED_CURRENT_STATE');
  assert.equal(decay.record.decayed_from_observation_at, '2026-08-18T10:00:00Z', 'the decay remembers what it decayed from');

  assert.throws(() => transition(estimated(), { to: 'OBSERVED_REALITY', now: NOW }), /NO_SILENT_UPGRADE/);
  assert.throws(() => transition(forecast(), { to: 'OBSERVED_REALITY', evidence, now: NOW }), /NO_SILENT_UPGRADE/, 'a forecast never becomes observed — its RESOLUTION is a new observation');
  const upgrade = transition(estimated(), { to: 'OBSERVED_REALITY', evidence: [{ observation: 'fresh store visit', ref: 'receipt:visit-1' }], now: NOW });
  assert.equal(upgrade.record.state_kind, 'OBSERVED_REALITY');
  assert.match(upgrade.note, /new observation/);
  assert.throws(() => transition(counterfactual(), { to: 'FORECAST_STATE', now: NOW }), /NO_SILENT_UPGRADE/, 'a counterfactual strengthening to forecast is an upgrade — refused like every unearned strengthening');
  assert.throws(() => transition(estimated(), { to: 'FORECAST_STATE', now: NOW }), /TRANSITION_UNDEFINED/, 'estimate→forecast is not a lawful lane — forecasts are born in the ledger, not converted');
});
