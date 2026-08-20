// ECONOMIC LAYER courts — the allocator must refuse invented dollars, the
// regret ledger must demand alternatives and preserve uncertainty, and TTRL
// must measure real latencies without flattering itself.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { AllocatorError, allocate, score, validateCandidate } from './allocator.mjs';
import { RegretLedger, verifyRegretFile } from './regret-ledger.mjs';
import { analyzeTtrl } from './ttrl.mjs';
import { probeVerifier } from '../alive-loop/custody-sweep.mjs';

const cand = (over = {}) => ({
  id: 'c1', action: 'a real action', value_basis: 'UNKNOWN',
  learning_value: 4, compounding_value: 3, strategic_value: 3, gate_opening: 2,
  confidence: 0.8, reversibility: 1, cost: 2, risk: 1, ...over,
});

test('FABRICATED-VALUE LAW: numbers demand a basis; MEASURED demands evidence; ESTIMATED demands a method', () => {
  assert.throws(() => validateCandidate(cand({ expected_value: 5000 })), /VALUE_FABRICATED/);
  assert.throws(() => validateCandidate(cand({ value_basis: 'MEASURED', expected_value: 5000 })), /VALUE_UNEVIDENCED/);
  assert.throws(() => validateCandidate(cand({ value_basis: 'MEASURED', evidence: [{ observation: 'x', ref: 'y' }] })), /VALUE_MISSING/);
  assert.throws(() => validateCandidate(cand({ value_basis: 'ESTIMATED', expected_value: 100 })), /ESTIMATE_METHOD/);
  assert.equal(validateCandidate(cand()), true, 'UNKNOWN with no number is honest and rankable');
  assert.throws(() => validateCandidate(cand({ learning_value: 9 })), /SCALE_INVALID/);
});

test('allocation: deterministic ranking; blocked candidates ranked but NEVER chosen; gates carried with rank', () => {
  const portfolio = [
    cand({ id: 'build-x', learning_value: 5, compounding_value: 4 }),
    cand({ id: 'ignite', gate_opening: 5, strategic_value: 5, blocked_by: 'owner deploy gate + unintercepted egress' }),
    cand({ id: 'small-fix', learning_value: 1, compounding_value: 1, strategic_value: 1, gate_opening: 0 }),
  ];
  const result = allocate(portfolio, { slots: 2 });
  assert.equal(result.ranked.length, 3);
  assert.ok(!result.chosen.includes('ignite'), 'a gated action is never self-chosen');
  assert.equal(result.gated.length, 1);
  assert.ok(result.gated[0].rank >= 1 && result.gated[0].gate.includes('owner'));
  assert.ok(score(portfolio[0]) > score(portfolio[2]), 'learning and compounding outrank trivia pre-revenue');
  assert.throws(() => allocate([cand(), cand()]), /CANDIDATE_DUPLICATE/);
  assert.throws(() => allocate([]), /PORTFOLIO_EMPTY/);
});

const value = (over = {}) => ({ basis: 'ESTIMATED', method: 'learning-value rubric', value: 3, ...over });
const info = [{ observation: 'owner directive + board receipts', ref: 'boot report Turn 18' }];

test('REGRET: a decision without alternatives is refused; registration seals decision-time information', () => {
  const d = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'regret-')), 'regret.jsonl');
  const ledger = new RegretLedger(d);
  assert.throws(() => ledger.register({ chosen_action: 'x', alternatives: [], expected_value: value(), information_available: info, policy_version: 'p1' }), /ALTERNATIVES_REQUIRED/);
  assert.throws(() => ledger.register({ chosen_action: 'x', alternatives: [{ id: 'a', summary: 's', expected_value: { basis: 'UNKNOWN', value: 900 } }], expected_value: value(), information_available: info, policy_version: 'p1' }), /VALUE_FABRICATED/);
  const r = ledger.register({ chosen_action: 'x', alternatives: [{ id: 'do-nothing', summary: 'defer everything' }], expected_value: value(), information_available: info, policy_version: 'p1' });
  assert.equal(r.registered, true);
  assert.equal(ledger.open().length, 1);
});

test('REGRET settlement: computable regret computes; unresolved counterfactuals stay unresolved; no second draft', () => {
  const d = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'regret-')), 'regret.jsonl');
  const ledger = new RegretLedger(d);
  const { decision_id } = ledger.register({ chosen_action: 'campaign A', alternatives: [{ id: 'campaign-b', summary: 'the road not taken' }], expected_value: value(), information_available: info, policy_version: 'p1' });
  const s1 = ledger.settle(decision_id, {
    realized_value: { basis: 'MEASURED', value: 4100, evidence: [{ observation: 'attributed incremental value', ref: 'outcome.jsonl' }] },
    counterfactual_estimates: [{ alternative_id: 'campaign-b', value: { basis: 'ESTIMATED', method: 'holdout uplift model', value: 7800 } }],
  });
  assert.equal(s1.regret, 3700, 'a successful action can still carry opportunity regret');
  assert.throws(() => ledger.settle(decision_id, { realized_value: value(), counterfactual_estimates: [] }), /ALREADY_SETTLED/);

  const { decision_id: d2 } = ledger.register({ chosen_action: 'y', alternatives: [{ id: 'z', summary: 'alt' }], expected_value: { basis: 'UNKNOWN' }, information_available: info, policy_version: 'p1' });
  const s2 = ledger.settle(d2, { realized_value: { basis: 'UNKNOWN' }, counterfactual_estimates: [{ alternative_id: 'z', value: 'UNRESOLVED_COUNTERFACTUAL' }] });
  assert.equal(s2.regret, 'UNRESOLVED_COUNTERFACTUAL', 'preserved uncertainty beats false precision');
  assert.equal(verifyRegretFile(d).valid, true);
});

test('REGRET custody: body mutation breaks the chain; probe is STRICT', () => {
  const d = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'regret-')), 'regret.jsonl');
  const ledger = new RegretLedger(d);
  ledger.register({ chosen_action: 'a truthful record', alternatives: [{ id: 'n', summary: 'do nothing' }], expected_value: { basis: 'UNKNOWN' }, information_available: info, policy_version: 'p1' });
  fs.writeFileSync(d, fs.readFileSync(d, 'utf8').replace('a truthful record', 'a flattering rewrite'));
  assert.equal(verifyRegretFile(d).valid, false);
  assert.equal(probeVerifier('regret-ledger').verdict, 'STRICT');
});

test('TTRL: measures real stage latencies, finds the bottleneck, excludes heartbeats, refuses velocity claims with zero events', () => {
  const t = (s) => new Date(Date.parse('2026-08-18T10:00:00Z') + s * 1000).toISOString();
  const row = (seq, kind, cycle, at) => ({ seq, kind, cycle_id: cycle, at });
  const rows = [
    row(0, 'CYCLE_OPEN', 'fwc_1', t(0)), row(1, 'JUDGE_APPOINTED', 'fwc_1', t(5)),
    row(2, 'SENSED', 'fwc_1', t(10)), row(3, 'SELECTED', 'fwc_1', t(12)),
    row(4, 'FORECASTED', 'fwc_1', t(14)), row(5, 'EXECUTED', 'fwc_1', t(74)),
    row(6, 'CONFIRMED', 'fwc_1', t(200)), row(7, 'ADMITTED', 'fwc_1', t(202)),
    row(8, 'CYCLE_OPEN', 'fwc_2', t(300)), row(9, 'STEADY_STATE', 'fwc_2', t(305)),
  ];
  const verdict = analyzeTtrl(rows, { externalEvents: [{ label: 'detection receipt', at: t(-100) }] });
  assert.equal(verdict.learning_events, 1);
  assert.equal(verdict.heartbeats, 1, 'steady cycles are heartbeats, never averaged in');
  const c = verdict.cycles[0];
  assert.equal(c.in_cycle_ms, 202000);
  assert.equal(c.ttrl_ms, 302000, 'external detection marker extends the span honestly');
  assert.equal(c.bottleneck.stage, 'EXECUTED→CONFIRMED', 'the blind battery is the measured bottleneck');
  const empty = analyzeTtrl([row(0, 'CYCLE_OPEN', 'x', t(0)), row(1, 'STEADY_STATE', 'x', t(1))]);
  assert.equal(empty.mean_ttrl_ms, null);
  assert.match(empty.note, /no velocity claims permitted/);
});
