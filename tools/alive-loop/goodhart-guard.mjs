// GOODHART GUARD — the blind confirmation gate (ShadowForge verdict M2).
//
// The trap this closes: a self-improving loop whose proposer, measurement,
// and judge are one process will optimize the MEASURE instead of the GOAL —
// and drift faster with every amplifier (evolutionary search, auto-missions).
//
// The mechanism: the CONFIRMATION metric is COMMITTED (salted content hash,
// sealed ledger) BEFORE candidates are generated, and is refused for
// confirmation if (a) its bytes drifted after commitment — the proposer
// cannot rewrite the judge after seeing candidates — or (b) the same metric
// was already consumed as a SELECTION signal — selection and confirmation
// must be different eyes. Every commitment, selection-use, and confirmation
// is a row in the same append-only hash-chained custody used by the other
// ledgers (payload digests recomputed — the hole the forecast court caught
// is closed here from birth).
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

export class GoodhartError extends Error {
  constructor(code, message) { super(`${code}: ${message}`); this.name = 'GoodhartError'; this.code = code; }
}
const refuse = (code, msg) => { throw new GoodhartError(code, msg); };

export class GoodhartGuard {
  constructor(ledgerPath) {
    this.ledgerPath = ledgerPath;
    fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  }

  records() {
    if (!fs.existsSync(this.ledgerPath)) return [];
    return fs.readFileSync(this.ledgerPath, 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l));
  }

  static rowHash(r) {
    return sha(canonical({ seq: r.seq, at: r.at, kind: r.kind, metric_id: r.metric_id, payload_digest: r.payload_digest, prev_hash: r.prev_hash }));
  }

  verifyChain() {
    let prev = 'GENESIS';
    for (const r of this.records()) {
      if (r.prev_hash !== prev || r.hash !== GoodhartGuard.rowHash(r)
        || sha(canonical(r.payload)) !== r.payload_digest) return { valid: false, at_seq: r.seq };
      prev = r.hash;
    }
    return { valid: true, count: this.records().length };
  }

  #append(kind, metricId, payload) {
    const verdict = this.verifyChain();
    if (!verdict.valid) {
      const q = `${this.ledgerPath}.quarantined.${Date.now()}`;
      if (fs.existsSync(this.ledgerPath)) fs.copyFileSync(this.ledgerPath, q);
      refuse('CHAIN_BROKEN', `guard ledger fails verification at seq ${verdict.at_seq}; quarantined to ${q}`);
    }
    const records = this.records();
    const prev = records.length === 0 ? 'GENESIS' : records[records.length - 1].hash;
    const row = { seq: records.length, at: new Date().toISOString(), kind, metric_id: metricId, payload_digest: sha(canonical(payload)), prev_hash: prev };
    row.hash = GoodhartGuard.rowHash(row);
    fs.appendFileSync(this.ledgerPath, `${JSON.stringify({ ...row, payload })}\n`);
    return row;
  }

  /**
   * Seal a confirmation metric BEFORE candidate generation. The commitment
   * binds the metric script's exact bytes (salted, so the hash reveals
   * nothing about content) plus its declared purpose. Committing the same
   * metric id twice is refused — a judge is appointed once.
   */
  commitConfirmation({ metricId, scriptPath, salt, purpose }) {
    if (!text(metricId)) refuse('METRIC_ID_REQUIRED', 'a metric identity is required');
    if (!text(salt) || salt.length < 16) refuse('SALT_REQUIRED', 'a salt of at least 16 chars is required — an unsalted commitment leaks the judge');
    if (!text(purpose)) refuse('PURPOSE_REQUIRED', 'state what this metric confirms');
    if (!fs.existsSync(scriptPath)) refuse('METRIC_SCRIPT_ABSENT', `no metric script at ${scriptPath}`);
    if (this.records().some((r) => r.kind === 'COMMITTED' && r.metric_id === metricId)) {
      refuse('ALREADY_COMMITTED', `metric ${metricId} is already sealed — a judge is appointed once`);
    }
    const bytes = fs.readFileSync(scriptPath);
    const commitment = sha(Buffer.concat([Buffer.from(salt), bytes]));
    this.#append('COMMITTED', metricId, {
      script_path: scriptPath, commitment, purpose,
      committed_at: new Date().toISOString(),
      // The salt is stored: this guard defends against POST-HOC judge editing
      // and selection reuse, not against a malicious ledger owner (the owner
      // holds the whole environment anyway). Bytes-drift is the threat model.
    });
    return { committed: true, metric_id: metricId, commitment };
  }

  /** Record that a metric was used as a SELECTION signal. Selection eyes cannot confirm. */
  recordSelectionUse({ metricId, context }) {
    if (!text(metricId)) refuse('METRIC_ID_REQUIRED', 'metric id required');
    this.#append('SELECTION_USE', metricId, { context: context ?? null, at: new Date().toISOString() });
    return { recorded: true };
  }

  /**
   * Blind confirmation. Refuses when: the metric was never committed; its
   * bytes drifted since commitment; or it was ever consumed for selection.
   * The runner executes the metric and must return { improved: boolean,
   * evidence: [{observation, ref}] } — the guard receipts the verdict.
   */
  confirm({ metricId, salt, runner }) {
    const commit = this.records().find((r) => r.kind === 'COMMITTED' && r.metric_id === metricId);
    if (!commit) refuse('METRIC_UNCOMMITTED', `metric ${metricId} was never sealed before generation`);
    if (this.records().some((r) => r.kind === 'SELECTION_USE' && r.metric_id === metricId)) {
      refuse('SELECTION_CONTAMINATED', `metric ${metricId} was consumed as a selection signal — selection eyes cannot confirm`);
    }
    const { script_path: scriptPath, commitment } = commit.payload;
    if (!fs.existsSync(scriptPath)) refuse('METRIC_SCRIPT_ABSENT', `sealed metric script missing at ${scriptPath}`);
    const bytes = fs.readFileSync(scriptPath);
    if (sha(Buffer.concat([Buffer.from(salt), bytes])) !== commitment) {
      refuse('JUDGE_DRIFTED', `metric ${metricId} bytes do not match the sealed commitment — the judge was edited after candidates existed`);
    }
    const result = runner({ scriptPath });
    if (!result || typeof result.improved !== 'boolean') refuse('CONFIRMATION_INVALID', 'runner must return an explicit boolean improved');
    if (!Array.isArray(result.evidence) || result.evidence.length === 0
      || !result.evidence.every((e) => text(e?.observation) && text(e?.ref))) {
      refuse('EVIDENCE_REQUIRED', 'confirmation requires evidence rows with observation + ref');
    }
    this.#append('CONFIRMED', metricId, {
      improved: result.improved, evidence: result.evidence,
      confirmed_at: new Date().toISOString(), commitment,
    });
    return { confirmed: true, metric_id: metricId, improved: result.improved };
  }
}

/** Standalone verifier — node builtins only, rollback-safe. */
export function verifyGuardFile(filePath) {
  const lines = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8').split('\n').filter((l) => l.trim() !== '') : [];
  let prev = 'GENESIS';
  for (const [i, line] of lines.entries()) {
    const r = JSON.parse(line);
    const expect = createHash('sha256').update(JSON.stringify(sortKeys({ seq: r.seq, at: r.at, kind: r.kind, metric_id: r.metric_id, payload_digest: r.payload_digest, prev_hash: r.prev_hash }))).digest('hex');
    const payloadDigest = createHash('sha256').update(JSON.stringify(sortKeys(r.payload))).digest('hex');
    if (r.prev_hash !== prev || r.hash !== expect || payloadDigest !== r.payload_digest) return { valid: false, at: i };
    prev = r.hash;
  }
  return { valid: true, count: lines.length };
}
