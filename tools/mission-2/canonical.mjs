import { createHash, timingSafeEqual } from 'node:crypto';

export class MissionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'MissionError';
    this.code = code;
    this.details = details;
  }
}

export function assertMission(condition, code, message, details) {
  if (!condition) throw new MissionError(code, message, details);
}

function canonicalValue(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    assertMission(Number.isFinite(value), 'NON_FINITE_NUMBER', 'Canonical values require finite numbers');
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalValue);
  assertMission(
    typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype,
    'NON_CANONICAL_VALUE',
    'Canonical values must be plain JSON objects',
  );
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => {
      const item = value[key];
      assertMission(item !== undefined, 'UNDEFINED_VALUE', `Undefined value at ${key}`);
      return [key, canonicalValue(item)];
    }),
  );
}

export function canonicalize(value) {
  return JSON.stringify(canonicalValue(value));
}

export function sha256(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  return createHash('sha256').update(bytes).digest('hex');
}

export function hashCanonical(value) {
  return sha256(canonicalize(value));
}

export function constantTimeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function deterministicId(prefix, value, length = 24) {
  return `${prefix}_${hashCanonical(value).slice(0, length)}`;
}

export function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (ArrayBuffer.isView(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

export function clone(value) {
  return structuredClone(value);
}

export function requireText(value, field) {
  assertMission(typeof value === 'string' && value.trim().length > 0, 'FIELD_REQUIRED', `${field} is required`, { field });
  return value;
}

export function requireSha(value, field) {
  assertMission(/^[0-9a-f]{40}$/.test(value), 'INVALID_GIT_IDENTITY', `${field} must be a lowercase 40-hex Git identity`, { field });
  return value;
}

export function requireSha256(value, field) {
  assertMission(/^[0-9a-f]{64}$/.test(value), 'INVALID_SHA256', `${field} must be a lowercase SHA-256`, { field });
  return value;
}

export function requireIso(value, field) {
  requireText(value, field);
  const timestamp = new Date(value);
  assertMission(!Number.isNaN(timestamp.getTime()) && timestamp.toISOString() === value, 'INVALID_TIMESTAMP', `${field} must be canonical ISO-8601`, { field });
  return value;
}

export function normalizeExactPath(value) {
  requireText(value, 'path');
  assertMission(!value.startsWith('/') && !value.startsWith('\\'), 'ABSOLUTE_PATH_DENIED', 'Authorized paths must be repository-relative');
  assertMission(!value.includes('\0') && !value.includes('\\'), 'MALFORMED_PATH', 'Authorized paths must be normalized POSIX paths');
  const parts = value.split('/');
  assertMission(parts.every((part) => part && part !== '.' && part !== '..'), 'PATH_TRAVERSAL_DENIED', 'Authorized paths may not traverse');
  return parts.join('/');
}

export function uniqueSorted(values, field) {
  assertMission(Array.isArray(values), 'ARRAY_REQUIRED', `${field} must be an array`, { field });
  const normalized = values.map((value) => requireText(value, field));
  assertMission(new Set(normalized).size === normalized.length, 'DUPLICATE_VALUE', `${field} contains duplicates`, { field });
  return [...normalized].sort();
}
