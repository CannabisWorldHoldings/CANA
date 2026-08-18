// DUAL PREDICTION SYSTEM — two independent predictors per target, both sealed
// before the outcome, both graded by reality, disagreement itself a signal.
//
// Absorbed from the recovery package's dual-evaluator law (13,992 dual states,
// zero disagreements) fused with this branch's forecast discipline:
//   - EVERY DUEL = champion predictor + independent baseline, registered as
//     TWO real forecasts in the existing ForecastLedger (absorption, not a
//     parallel ledger of predictions — one custody home for all prediction).
//   - DIVERGENCE IS A SIGNAL: |p_champion − p_baseline| beyond threshold flags
//     MODEL_FAMILY_QUESTION — "uncertainty inside a bad model family is false
//     comfort"; when two honest predictors disagree hard, the family itself
//     is under suspicion, not just the number.
//   - REALITY GRADES BOTH: resolution computes both Briers; the winner is
//     arithmetic, never asserted. A sophisticated model that cannot beat a
//     naive baseline LOSES, and the scoreboard remembers.
//   - NO HINDSIGHT GRADING: both predictors seal against the SAME input
//     snapshot at registration ("do not grade T0 with T1+ evidence").
//   - Custody: duel rows are chained in the flywheel directory, so the sweep
//     and the sealed judge audit the duel ledger automatically.
import fs from 'node:fs';
import path from 'node:path';

import { ForecastLedger } from '../alive-loop/forecast-ledger.mjs';
import { FlywheelStore } from '../alive-loop/flywheel.mjs';

const text = (v) => typeof v === 'string' && v.trim() !== '';

export class DuelError extends Error {
  constructor(code, message) { super(`${code}: ${message}`); this.name = 'DuelError'; this.code = code; }
}
const refuse = (code, msg) => { throw new DuelError(code, msg); };

export const DIVERGENCE_THRESHOLD = 0.25;

export class DualForecast {
  constructor({ forecastsPath, duelsPath }) {
    this.ledger = new ForecastLedger(forecastsPath);
    this.duels = new FlywheelStore(duelsPath);
  }

  records() { return this.duels.records(); }

  /**
   * Register a duel: one target, two independent predictors, one sealed
   * input snapshot. Both become real forecasts; the duel row binds them.
   */
  register({ target, scope, statement, resolves_by, resolution_method, input_snapshot, champion, baseline, now = new Date() }) {
    for (const [name, p] of [['champion', champion], ['baseline', baseline]]) {
      if (!p || !text(p.model)) refuse('PREDICTOR_INVALID', `${name} needs a model identity`);
      if (!(typeof p.probability === 'number' && p.probability > 0 && p.probability < 1)) {
        refuse('PREDICTOR_INVALID', `${name} probability must be strictly between 0 and 1`);
      }
      if (!text(p.basis)) refuse('PREDICTOR_INVALID', `${name} must state its basis — how was this number produced?`);
    }
    if (champion.model === baseline.model) refuse('PREDICTORS_NOT_INDEPENDENT', 'a duel needs two DISTINCT predictors — one mind arguing with itself is not a duel');

    const ids = {};
    for (const [name, p] of [['champion', champion], ['baseline', baseline]]) {
      const r = this.ledger.register({
        target: `${target} [${name}:${p.model}]`, scope, statement,
        probability: p.probability, horizon: 'nowcast',
        resolves_by, resolution_method,
        input_snapshot, // SAME snapshot for both — no hindsight asymmetry
        model: p.model, non_business: true,
      }, { now });
      ids[name] = r.forecast_id;
    }
    const divergence = Number(Math.abs(champion.probability - baseline.probability).toFixed(6));
    const duelId = `duel_${ids.champion.slice(3, 11)}${ids.baseline.slice(3, 7)}`;
    this.duels.append('DUEL_REGISTERED', duelId, {
      target, statement, resolves_by,
      champion: { model: champion.model, probability: champion.probability, basis: champion.basis, forecast_id: ids.champion },
      baseline: { model: baseline.model, probability: baseline.probability, basis: baseline.basis, forecast_id: ids.baseline },
      divergence,
      divergence_signal: divergence >= DIVERGENCE_THRESHOLD ? 'MODEL_FAMILY_QUESTION' : null,
    });
    return { duel_id: duelId, forecast_ids: ids, divergence, divergence_signal: divergence >= DIVERGENCE_THRESHOLD };
  }

  /** Reality grades BOTH. The winner is arithmetic. Ties are ties. */
  resolve(duelId, { outcome, evidence, now = new Date() }) {
    const reg = this.records().find((r) => r.kind === 'DUEL_REGISTERED' && r.cycle_id === duelId);
    if (!reg) refuse('DUEL_UNKNOWN', `no duel ${duelId}`);
    if (this.records().some((r) => r.kind === 'DUEL_RESOLVED' && r.cycle_id === duelId)) {
      refuse('ALREADY_RESOLVED', `duel ${duelId} already met reality`);
    }
    const rc = this.ledger.resolve(reg.payload.champion.forecast_id, { outcome, evidence, now });
    const rb = this.ledger.resolve(reg.payload.baseline.forecast_id, { outcome, evidence, now });
    const winner = rc.brier_score < rb.brier_score ? reg.payload.champion.model
      : rb.brier_score < rc.brier_score ? reg.payload.baseline.model
      : 'TIE';
    const baselineBeatChampion = rb.brier_score < rc.brier_score;
    this.duels.append('DUEL_RESOLVED', duelId, {
      outcome,
      champion: { model: reg.payload.champion.model, brier: rc.brier_score },
      baseline: { model: reg.payload.baseline.model, brier: rb.brier_score },
      winner, baseline_beat_champion: baselineBeatChampion,
      note: baselineBeatChampion
        ? 'the naive baseline beat the champion — a model that cannot beat triviality has not earned trust'
        : (winner === 'TIE' ? 'exact tie — no predictor earned an edge' : 'champion held'),
    });
    return { resolved: true, duel_id: duelId, winner, champion_brier: rc.brier_score, baseline_brier: rb.brier_score, baseline_beat_champion: baselineBeatChampion };
  }

  /** Per-predictor scoreboard across all resolved duels. Memory with teeth. */
  scoreboard() {
    const rows = this.records().filter((r) => r.kind === 'DUEL_RESOLVED');
    const acc = {};
    for (const r of rows) {
      for (const side of ['champion', 'baseline']) {
        const m = r.payload[side].model;
        acc[m] = acc[m] || { duels: 0, wins: 0, brier_sum: 0 };
        acc[m].duels += 1;
        acc[m].brier_sum += r.payload[side].brier;
        if (r.payload.winner === m) acc[m].wins += 1;
      }
    }
    return Object.fromEntries(Object.entries(acc).map(([m, s]) => [m, {
      duels: s.duels, wins: s.wins, mean_brier: Number((s.brier_sum / s.duels).toFixed(6)),
    }]));
  }

  open() {
    const resolved = new Set(this.records().filter((r) => r.kind === 'DUEL_RESOLVED').map((r) => r.cycle_id));
    return this.records().filter((r) => r.kind === 'DUEL_REGISTERED' && !resolved.has(r.cycle_id))
      .map((r) => ({ duel_id: r.cycle_id, target: r.payload.target, resolves_by: r.payload.resolves_by, divergence: r.payload.divergence }));
  }
}

export function liveDual(ROOT) {
  const LOCAL = path.join(ROOT, '.cana-local');
  return new DualForecast({
    forecastsPath: path.join(LOCAL, 'forecasts', 'ledger.jsonl'),
    duelsPath: path.join(LOCAL, 'flywheel', 'duels.jsonl'),
  });
}
