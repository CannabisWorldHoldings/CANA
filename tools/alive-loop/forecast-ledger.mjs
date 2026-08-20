// FORECAST LEDGER — prediction as a first-class, reality-graded primitive.
// (Predictive Readiness Fabric, first executable slice.)
//
// The law this enforces: NO PREDICTION BECOMES TRUTH BECAUSE A MODEL EMITTED
// IT. A forecast is registered PENDING with its probability, horizon, scope,
// and input snapshot sealed at registration time; it becomes RESOLVED only
// with evidence of the actual outcome; calibration (Brier score) is computed
// over the resolved set only. Unresolved forecasts expire to UNRESOLVED —
// never silently graded, never silently dropped.
//
// Same custody discipline as the winner memory: append-only, hash-chained,
// tamper/reorder/replay detection with quarantine, standalone verifier that
// works after the module is deleted. Registration and resolution are separate
// appended records, so history can never be rewritten to flatter the model.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const sha = (v) => createHash('sha256').update(v).digest('hex');
const text = (v) => typeof v === 'string' && v.trim() !== '';
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
}
const canonical = (v) => JSON.stringify(sortKeys(v));

export class ForecastError extends Error {
  constructor(code, message) { super(`${code}: ${message}`); this.name = 'ForecastError'; this.code = code; }
}
const refuse = (code, msg) => { throw new ForecastError(code, msg); };

/** Fail-closed registration validation (the input contract, small but strict). */
export function validateForecast(f, { now = new Date() } = {}) {
  if (!f || typeof f !== 'object') refuse('FORECAST_ABSENT', 'a forecast object is required');
  if (!text(f.target)) refuse('FORECAST_FIELD', 'target required — what fact will reality settle?');
  if (!text(f.scope)) refuse('FORECAST_FIELD', 'scope required (market/system area)');
  if (!text(f.statement)) refuse('FORECAST_FIELD', 'statement required — a falsifiable claim about the future');
  if (typeof f.probability !== 'number' || !(f.probability > 0 && f.probability < 1)) {
    refuse('FORECAST_PROBABILITY', 'probability must be strictly between 0 and 1 — certainty is not a forecast');
  }
  if (!text(f.horizon)) refuse('FORECAST_FIELD', 'horizon required (nowcast|short|operating|tactical|strategic)');
  if (!text(f.resolves_by) || Number.isNaN(Date.parse(f.resolves_by))) refuse('FORECAST_FIELD', 'resolves_by must be a valid time');
  if (Date.parse(f.resolves_by) <= now.getTime()) refuse('FORECAST_HORIZON', 'resolves_by must be in the future at registration');
  if (!text(f.resolution_method)) refuse('FORECAST_FIELD', 'resolution_method required — HOW will reality grade this?');
  if (!f.input_snapshot || typeof f.input_snapshot !== 'object') refuse('FORECAST_FIELD', 'input_snapshot required — what the model saw, sealed');
  if (!text(f.model)) refuse('FORECAST_FIELD', 'model identity required');
  if (f.non_business !== true) refuse('FORECAST_CLASS', 'first-court forecasts must be marked non_business: true');
  return true;
}

export class ForecastLedger {
  constructor(filePath) {
    this.filePath = filePath;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }

  records() {
    if (!fs.existsSync(this.filePath)) return [];
    return fs.readFileSync(this.filePath, 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l));
  }

  static rowHash(r) {
    return sha(canonical({ seq: r.seq, at: r.at, kind: r.kind, forecast_id: r.forecast_id, payload_digest: r.payload_digest, prev_hash: r.prev_hash }));
  }

  verifyChain() {
    let prev = 'GENESIS';
    for (const r of this.records()) {
      if (r.prev_hash !== prev || r.hash !== ForecastLedger.rowHash(r)
        || sha(canonical(r.payload)) !== r.payload_digest) return { valid: false, at_seq: r.seq };
      prev = r.hash;
    }
    return { valid: true, count: this.records().length };
  }

  #append(kind, forecastId, payload) {
    const verdict = this.verifyChain();
    if (!verdict.valid) {
      const q = `${this.filePath}.quarantined.${Date.now()}`;
      if (fs.existsSync(this.filePath)) fs.copyFileSync(this.filePath, q);
      refuse('CHAIN_BROKEN', `ledger fails verification at seq ${verdict.at_seq}; quarantined to ${q}`);
    }
    const records = this.records();
    const prev = records.length === 0 ? 'GENESIS' : records[records.length - 1].hash;
    const row = {
      seq: records.length, at: new Date().toISOString(), kind,
      forecast_id: forecastId, payload_digest: sha(canonical(payload)), prev_hash: prev,
    };
    row.hash = ForecastLedger.rowHash(row);
    fs.appendFileSync(this.filePath, `${JSON.stringify({ ...row, payload })}\n`);
    return row;
  }

  register(forecast, { now = new Date() } = {}) {
    validateForecast(forecast, { now });
    const forecastId = `fc_${sha(canonical({
      target: forecast.target, scope: forecast.scope, statement: forecast.statement,
      resolves_by: forecast.resolves_by, model: forecast.model, input: forecast.input_snapshot,
    })).slice(0, 16)}`;
    if (this.records().some((r) => r.kind === 'REGISTERED' && r.forecast_id === forecastId)) {
      return { registered: false, deduped: true, forecast_id: forecastId };
    }
    this.#append('REGISTERED', forecastId, { ...forecast, status: 'PENDING' });
    return { registered: true, deduped: false, forecast_id: forecastId };
  }

  /** Reality grades the forecast. Evidence is mandatory; re-resolution refused. */
  resolve(forecastId, { outcome, evidence, now = new Date() }) {
    const reg = this.records().find((r) => r.kind === 'REGISTERED' && r.forecast_id === forecastId);
    if (!reg) refuse('FORECAST_UNKNOWN', `no registered forecast ${forecastId}`);
    if (this.records().some((r) => r.kind === 'RESOLVED' && r.forecast_id === forecastId)) {
      refuse('ALREADY_RESOLVED', `forecast ${forecastId} already met reality — history does not get a second draft`);
    }
    if (typeof outcome !== 'boolean') refuse('OUTCOME_REQUIRED', 'outcome must be an explicit boolean — reality is not a maybe');
    if (!Array.isArray(evidence) || evidence.length === 0 || !evidence.every((e) => text(e?.observation) && text(e?.ref))) {
      refuse('EVIDENCE_REQUIRED', 'resolution requires evidence rows with observation + retrievable ref');
    }
    const p = reg.payload.probability;
    const brier = (p - (outcome ? 1 : 0)) ** 2;
    const late = Date.parse(now.toISOString()) > Date.parse(reg.payload.resolves_by);
    this.#append('RESOLVED', forecastId, {
      outcome, evidence, resolved_at: now.toISOString(), late,
      probability_at_registration: p, brier_score: Number(brier.toFixed(6)),
    });
    return { resolved: true, forecast_id: forecastId, outcome, brier_score: Number(brier.toFixed(6)), late };
  }

  /** Calibration over the RESOLVED set only. Pending forecasts prove nothing. */
  calibration() {
    const resolved = this.records().filter((r) => r.kind === 'RESOLVED');
    if (resolved.length === 0) return { resolved: 0, mean_brier: null, note: 'no resolved forecasts — no accuracy claims permitted' };
    const mean = resolved.reduce((s, r) => s + r.payload.brier_score, 0) / resolved.length;
    return { resolved: resolved.length, mean_brier: Number(mean.toFixed(6)), pending: this.pending().length };
  }

  pending({ now = new Date() } = {}) {
    const resolvedIds = new Set(this.records().filter((r) => r.kind === 'RESOLVED').map((r) => r.forecast_id));
    return this.records()
      .filter((r) => r.kind === 'REGISTERED' && !resolvedIds.has(r.forecast_id))
      .map((r) => ({ forecast_id: r.forecast_id, statement: r.payload.statement, probability: r.payload.probability, resolves_by: r.payload.resolves_by, overdue: Date.parse(r.payload.resolves_by) < now.getTime() }));
  }
}

/** Standalone verifier — readable with node builtins after rollback. */
export function verifyForecastFile(filePath) {
  const lines = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8').split('\n').filter((l) => l.trim() !== '') : [];
  let prev = 'GENESIS';
  for (const [i, line] of lines.entries()) {
    const r = JSON.parse(line);
    const expect = createHash('sha256').update(JSON.stringify(sortKeys({ seq: r.seq, at: r.at, kind: r.kind, forecast_id: r.forecast_id, payload_digest: r.payload_digest, prev_hash: r.prev_hash }))).digest('hex');
    const payloadDigest = createHash('sha256').update(JSON.stringify(sortKeys(r.payload))).digest('hex');
    if (r.prev_hash !== prev || r.hash !== expect || payloadDigest !== r.payload_digest) return { valid: false, at: i };
    prev = r.hash;
  }
  return { valid: true, count: lines.length };
}
