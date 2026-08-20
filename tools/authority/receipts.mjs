// tools/authority/receipts.mjs — durable, hash-chained DECISION receipts with crash reconstruction.
//
// The "continuation gene" the tournament winner composes: an append-only, tamper-evident log of
// every authorize() DECISION (AUTHORIZED or DENIED). Each row binds the previous entry's hash, so
// mutating, deleting, reordering, or replaying any row breaks a from-bytes recompute. Reconstruction
// re-reads the file independently of any in-memory state, so a crash mid-run leaves a verifiable log.
//
// This is NEW glue and holds no key: integrity is by hash chain (recompute), authenticity of the
// underlying decision is carried by the mission-2 receipt + owner proof inside each row.

import {
  readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { sha256hex, canonical, GENESIS } from './canon.mjs';

export class DecisionChain {
  constructor(dir) {
    mkdirSync(dir, { recursive: true });
    this.log = join(dir, 'decisions.jsonl');
    if (!existsSync(this.log)) writeFileSync(this.log, '');
  }

  _rows() {
    const raw = readFileSync(this.log, 'utf8').trim();
    if (!raw) return [];
    return raw.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  }

  head() {
    const rows = this._rows();
    return rows.length ? rows[rows.length - 1] : { seq: -1, entry_hash: GENESIS };
  }

  // Append a decision row. entry_hash covers the body + seq + prev_hash, so the chain is
  // self-verifying from bytes alone.
  append(body) {
    const prev = this.head();
    const seq = prev.seq + 1;
    const core = { ...body, seq, prev_hash: prev.entry_hash };
    const entry_hash = sha256hex(canonical(core));
    const row = { ...core, entry_hash };
    appendFileSync(this.log, `${JSON.stringify(row)}\n`);
    return row;
  }

  // Re-verify the whole chain from bytes — the crash-reconstruction primitive.
  verify() {
    const rows = this._rows();
    let prev = GENESIS;
    for (let i = 0; i < rows.length; i++) {
      const { entry_hash, ...core } = rows[i];
      if (core.prev_hash !== prev) return { ok: false, at: i, reason: 'PREV_HASH_BREAK' };
      if (sha256hex(canonical(core)) !== entry_hash) return { ok: false, at: i, reason: 'HASH_BREAK' };
      prev = entry_hash;
    }
    return { ok: true, length: rows.length };
  }

  rows() { return this._rows(); }
}
