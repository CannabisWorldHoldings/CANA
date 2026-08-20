// REGRET LEDGER — decision quality as a first-class, reality-graded object.
//
// The Forecast Ledger asks "were we right?" The outcome courts ask "did it
// work?" This ledger asks the harder question: WAS THERE SOMETHING BETTER WE
// SHOULD HAVE DONE INSTEAD? A successful action can still carry opportunity
// regret if a rejected alternative would have been worth more.
//
// Laws (external red-team organ 2, under the standing truth discipline):
//   - A decision without alternatives is not a decision — registration
//     demands the road not taken, even when it is "do nothing".
//   - Expected values obey the fabricated-value law (numbers require a
//     MEASURED/ESTIMATED basis; UNKNOWN carries no number).
//   - Settlement is evidence-mandatory. Regret is computed ONLY when the
//     realized value AND at least one counterfactual are numeric; otherwise
//     regret is UNRESOLVED_COUNTERFACTUAL — preserved uncertainty beats
//     false precision.
//   - History gets no second draft: one settlement per decision.
//   - Same custody as every organ: append-only, hash-chained, payload
//     digests recomputed from birth, quarantine, standalone verifier.
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

export class RegretError extends Error {
  constructor(code, message) { super(`${code}: ${message}`); this.name = 'RegretError'; this.code = code; }
}
const refuse = (code, msg) => { throw new RegretError(code, msg); };

const validValue = (v, label) => {
  if (!v || typeof v !== 'object') refuse('VALUE_INVALID', `${label}: a value object {basis, value?, method?, evidence?} is required`);
  if (!['MEASURED', 'ESTIMATED', 'UNKNOWN'].includes(v.basis)) refuse('VALUE_BASIS', `${label}: basis must be MEASURED|ESTIMATED|UNKNOWN`);
  if (v.basis === 'UNKNOWN' && typeof v.value === 'number') refuse('VALUE_FABRICATED', `${label}: numeric value with UNKNOWN basis is an invented number`);
  if (v.basis === 'MEASURED' && !(Array.isArray(v.evidence) && v.evidence.length > 0 && v.evidence.every((e) => text(e?.observation) && text(e?.ref)))) {
    refuse('VALUE_UNEVIDENCED', `${label}: MEASURED demands evidence refs`);
  }
  if (v.basis === 'ESTIMATED' && !text(v.method)) refuse('ESTIMATE_METHOD', `${label}: ESTIMATED must state its method`);
  return true;
};

export class RegretLedger {
  constructor(filePath) {
    this.filePath = filePath;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }

  records() {
    if (!fs.existsSync(this.filePath)) return [];
    return fs.readFileSync(this.filePath, 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l));
  }

  static rowHash(r) {
    return sha(canonical({ seq: r.seq, at: r.at, kind: r.kind, decision_id: r.decision_id, payload_digest: r.payload_digest, prev_hash: r.prev_hash }));
  }

  verifyChain() {
    let prev = 'GENESIS';
    for (const r of this.records()) {
      if (r.prev_hash !== prev || r.hash !== RegretLedger.rowHash(r)
        || sha(canonical(r.payload ?? null)) !== r.payload_digest) return { valid: false, at_seq: r.seq };
      prev = r.hash;
    }
    return { valid: true, count: this.records().length };
  }

  #append(kind, decisionId, payload) {
    const verdict = this.verifyChain();
    if (!verdict.valid) {
      const q = `${this.filePath}.quarantined.${Date.now()}`;
      if (fs.existsSync(this.filePath)) fs.copyFileSync(this.filePath, q);
      refuse('CHAIN_BROKEN', `regret ledger fails verification at seq ${verdict.at_seq}; quarantined to ${q}`);
    }
    const records = this.records();
    const prev = records.length === 0 ? 'GENESIS' : records[records.length - 1].hash;
    const row = { seq: records.length, at: new Date().toISOString(), kind, decision_id: decisionId, payload_digest: sha(canonical(payload)), prev_hash: prev };
    row.hash = RegretLedger.rowHash(row);
    fs.appendFileSync(this.filePath, `${JSON.stringify({ ...row, payload })}\n`);
    return row;
  }

  /** Register a decision AS TAKEN, with the information available at decision time. */
  register({ chosen_action, alternatives, expected_value, information_available, policy_version, allocator_receipt, now = new Date() }) {
    if (!text(chosen_action)) refuse('DECISION_FIELD', 'chosen_action required — what was actually done?');
    if (!Array.isArray(alternatives) || alternatives.length === 0) {
      refuse('ALTERNATIVES_REQUIRED', 'a decision without alternatives is not a decision — record the road not taken, even "do nothing"');
    }
    for (const a of alternatives) {
      if (!text(a?.id) || !text(a?.summary)) refuse('ALTERNATIVE_INVALID', 'each alternative needs id + summary');
      if (a.expected_value != null) validValue(a.expected_value, `alternative ${a.id}`);
    }
    validValue(expected_value, 'chosen expected_value');
    if (!Array.isArray(information_available) || information_available.length === 0 || !information_available.every((e) => text(e?.observation) && text(e?.ref))) {
      refuse('INFORMATION_REQUIRED', 'record what was known at decision time — hindsight is not allowed to rewrite it');
    }
    if (!text(policy_version)) refuse('DECISION_FIELD', 'policy_version required');
    const decisionId = `dec_${sha(canonical({ chosen_action, at: now.toISOString(), alternatives: alternatives.map((a) => a.id) })).slice(0, 16)}`;
    this.#append('DECISION_REGISTERED', decisionId, {
      chosen_action, alternatives, expected_value, information_available,
      policy_version, allocator_receipt: allocator_receipt ?? null, decided_at: now.toISOString(),
    });
    return { registered: true, decision_id: decisionId };
  }

  /** Settle with reality. One settlement per decision; regret only when computable. */
  settle(decisionId, { realized_value, counterfactual_estimates, now = new Date() }) {
    const reg = this.records().find((r) => r.kind === 'DECISION_REGISTERED' && r.decision_id === decisionId);
    if (!reg) refuse('DECISION_UNKNOWN', `no registered decision ${decisionId}`);
    if (this.records().some((r) => r.kind === 'DECISION_SETTLED' && r.decision_id === decisionId)) {
      refuse('ALREADY_SETTLED', `decision ${decisionId} already met reality — history does not get a second draft`);
    }
    validValue(realized_value, 'realized_value');
    if (!Array.isArray(counterfactual_estimates)) refuse('COUNTERFACTUALS_REQUIRED', 'counterfactual_estimates array required (entries may be UNRESOLVED)');
    for (const c of counterfactual_estimates) {
      if (!text(c?.alternative_id)) refuse('COUNTERFACTUAL_INVALID', 'each counterfactual names its alternative_id');
      if (c.value !== 'UNRESOLVED_COUNTERFACTUAL') validValue(c.value, `counterfactual ${c.alternative_id}`);
    }
    const numericCfs = counterfactual_estimates.filter((c) => c.value !== 'UNRESOLVED_COUNTERFACTUAL' && typeof c.value.value === 'number');
    let regret = 'UNRESOLVED_COUNTERFACTUAL';
    if (typeof realized_value.value === 'number' && numericCfs.length > 0) {
      const best = Math.max(...numericCfs.map((c) => c.value.value));
      regret = Number(Math.max(0, best - realized_value.value).toFixed(6));
    }
    this.#append('DECISION_SETTLED', decisionId, {
      realized_value, counterfactual_estimates, regret, settled_at: now.toISOString(),
    });
    return { settled: true, decision_id: decisionId, regret };
  }

  open() {
    const settled = new Set(this.records().filter((r) => r.kind === 'DECISION_SETTLED').map((r) => r.decision_id));
    return this.records().filter((r) => r.kind === 'DECISION_REGISTERED' && !settled.has(r.decision_id))
      .map((r) => ({ decision_id: r.decision_id, chosen_action: r.payload.chosen_action, decided_at: r.payload.decided_at }));
  }
}

/** Standalone strict verifier — node builtins only, rollback-safe. */
export function verifyRegretFile(filePath) {
  const lines = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8').split('\n').filter((l) => l.trim() !== '') : [];
  let prev = 'GENESIS';
  for (const [i, line] of lines.entries()) {
    const r = JSON.parse(line);
    const expect = createHash('sha256').update(JSON.stringify(sortKeys({ seq: r.seq, at: r.at, kind: r.kind, decision_id: r.decision_id, payload_digest: r.payload_digest, prev_hash: r.prev_hash }))).digest('hex');
    const bodyDigest = createHash('sha256').update(JSON.stringify(sortKeys(r.payload ?? null))).digest('hex');
    if (r.prev_hash !== prev || r.hash !== expect || bodyDigest !== r.payload_digest) return { valid: false, at: i };
    prev = r.hash;
  }
  return { valid: true, count: lines.length };
}
