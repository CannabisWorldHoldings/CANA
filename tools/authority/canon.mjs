// tools/authority/canon.mjs — canonical serialization + hashing shared by the CANA Authority.
//
// Deterministic, sort-key JSON (matches the discipline in tools/mission-2/canonical.mjs and the
// governor-kernel runtime/rsi.py `canonical()` — sorted keys, tight separators) so a digest computed
// here reproduces byte-for-byte anywhere, and a tampered field always breaks a recompute.
//
// This is NEW glue. It performs NO I/O and holds no key. Root of trust is external (signer.mjs).

import { createHash } from 'node:crypto';

export const GENESIS = '0'.repeat(64);

function canonicalValue(value) {
  if (value === null) return null;
  const t = typeof value;
  if (t === 'string' || t === 'boolean') return value;
  if (t === 'number') {
    if (!Number.isFinite(value)) throw new Error('NON_FINITE_NUMBER');
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && t === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      const item = value[key];
      if (item === undefined) continue; // drop undefined the way JSON.stringify would
      out[key] = canonicalValue(item);
    }
    return out;
  }
  throw new Error(`NON_CANONICAL_VALUE:${t}`);
}

// Canonical JSON string with sorted keys and no whitespace.
export function canonical(value) {
  return JSON.stringify(canonicalValue(value));
}

export function sha256hex(input) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(String(input));
  return createHash('sha256').update(bytes).digest('hex');
}

// Digest over the canonical form of a value — the "recompute, do not trust" primitive.
export function hashCanonical(value) {
  return sha256hex(canonical(value));
}

export function isText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function requireText(value, field) {
  if (!isText(value)) throw new AuthorityError('FIELD_REQUIRED', `${field} is required`);
  return value;
}

// One typed error for every authority refusal. Carries a stable CODE (owner decision: booleans are
// not authority, and every refusal must name its reason).
export class AuthorityError extends Error {
  constructor(code, detail = '', stage = null) {
    super(`${code}: ${detail}`);
    this.name = 'AuthorityError';
    this.code = code;
    this.detail = detail;
    this.stage = stage;
  }
}
