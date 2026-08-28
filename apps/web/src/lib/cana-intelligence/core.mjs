import { createHash, randomUUID } from 'node:crypto';

export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

export function digest(value, prefix = 'sha256') {
  return `${prefix}:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

export function newId(prefix) { return `${prefix}_${randomUUID()}`; }

// Evidence objects must use plain JSON-compatible values. Dates/Maps/Sets are rejected
// because Object.freeze does not make their internal slots immutable.
export function assertPlainData(value, path = '$') {
  if (value === null || ['string','number','boolean','undefined'].includes(typeof value)) return true;
  if (Array.isArray(value)) { value.forEach((v,i)=>assertPlainData(v,`${path}[${i}]`)); return true; }
  assert(Object.getPrototypeOf(value) === Object.prototype, `non-plain evidence value at ${path}`, 'NON_PLAIN_EVIDENCE');
  for (const [k,v] of Object.entries(value)) assertPlainData(v, `${path}.${k}`);
  return true;
}

export function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (value instanceof Date || value instanceof Map || value instanceof Set) {
    throw Object.assign(new Error('mutable built-in forbidden in sealed evidence object'), { code: 'MUTABLE_BUILTIN_FORBIDDEN' });
  }
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

export function sealPlain(value) { assertPlainData(value); return deepFreeze(value); }

export function assert(condition, message, code = 'CANA_ASSERTION_FAILED') {
  if (!condition) { const error = new Error(message); error.code = code; throw error; }
}

export function clamp(n, lo = 0, hi = 1) { return Math.min(hi, Math.max(lo, n)); }
export function iso(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value);
  assert(Number.isFinite(d.getTime()), 'valid timestamp required', 'INVALID_TIMESTAMP');
  return d.toISOString();
}
