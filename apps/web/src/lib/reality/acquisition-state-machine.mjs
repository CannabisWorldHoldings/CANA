import { createHash } from 'node:crypto';

export const GENESIS_EVENT_DIGEST = '0'.repeat(64);

export const ACQUISITION_TRANSITIONS = Object.freeze({
  REQUESTED: Object.freeze(['PREFLIGHT_VALIDATED', 'FAILED']),
  PREFLIGHT_VALIDATED: Object.freeze(['FETCHING', 'FAILED']),
  FETCHING: Object.freeze(['CAPTURED', 'FAILED']),
  CAPTURED: Object.freeze(['POSTFLIGHT_VALIDATED', 'FAILED']),
  POSTFLIGHT_VALIDATED: Object.freeze(['CHANGED', 'UNCHANGED', 'FAILED']),
  CHANGED: Object.freeze(['PERSISTED', 'FAILED']),
  PERSISTED: Object.freeze(['COMPLETED', 'FAILED']),
  UNCHANGED: Object.freeze(['REVALIDATION_PENDING', 'FAILED']),
  REVALIDATION_PENDING: Object.freeze(['COMPLETED', 'FAILED']),
  COMPLETED: Object.freeze([]),
  FAILED: Object.freeze([]),
});

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function exactTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    fail('CANA_LIVE_REALITY_TIME_INVALID');
  }
  return date;
}

function boundedText(value, code, maximum) {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum) fail(code);
  return value;
}

function cleanDetail(value) {
  if (value === undefined) return Object.freeze({});
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('CANA_LIVE_REALITY_EVENT_DETAIL_INVALID');
  const serialized = canonicalJson(value);
  if (Buffer.byteLength(serialized) > 4096 || /authorization|cookie|credential|password|secret|token/i.test(serialized)) {
    fail('CANA_LIVE_REALITY_EVENT_DETAIL_INVALID');
  }
  return JSON.parse(serialized);
}

function eventFor({ attemptId, sourceKey, sequence, state, at, detail, priorEventDigest }) {
  const unsigned = {
    schema_version: 'cana-live-reality-acquisition-event/v1',
    attempt_id: attemptId,
    source_key: sourceKey,
    sequence,
    state,
    at,
    detail: cleanDetail(detail),
    prior_event_digest: priorEventDigest,
  };
  return deepFreeze({ ...unsigned, event_digest: digest(unsigned) });
}

export function createAcquisitionState({ attemptId, sourceKey, at, requestDigest }) {
  boundedText(attemptId, 'CANA_LIVE_REALITY_ATTEMPT_ID_INVALID', 160);
  boundedText(sourceKey, 'CANA_LIVE_REALITY_SOURCE_KEY_INVALID', 160);
  exactTime(at);
  if (!/^[a-f0-9]{64}$/.test(requestDigest ?? '')) fail('CANA_LIVE_REALITY_REQUEST_DIGEST_INVALID');
  const event = eventFor({
    attemptId,
    sourceKey,
    sequence: 1,
    state: 'REQUESTED',
    at,
    detail: { request_digest: requestDigest },
    priorEventDigest: GENESIS_EVENT_DIGEST,
  });
  return deepFreeze({
    schema_version: 'cana-live-reality-acquisition-state/v1',
    attempt_id: attemptId,
    source_key: sourceKey,
    request_digest: requestDigest,
    state: 'REQUESTED',
    events: [event],
  });
}

export function transitionAcquisition(current, { state, at, detail } = {}) {
  if (!current || current.schema_version !== 'cana-live-reality-acquisition-state/v1') {
    fail('CANA_LIVE_REALITY_STATE_INVALID');
  }
  const allowed = ACQUISITION_TRANSITIONS[current.state];
  if (!allowed) fail('CANA_LIVE_REALITY_STATE_INVALID');
  if (allowed.length === 0) fail('CANA_LIVE_REALITY_TERMINAL_STATE');
  if (!allowed.includes(state)) fail('CANA_LIVE_REALITY_TRANSITION_INVALID');
  const eventAt = exactTime(at);
  const previous = current.events.at(-1);
  if (eventAt < exactTime(previous.at)) fail('CANA_LIVE_REALITY_TIME_REVERSED');
  const event = eventFor({
    attemptId: current.attempt_id,
    sourceKey: current.source_key,
    sequence: previous.sequence + 1,
    state,
    at,
    detail,
    priorEventDigest: previous.event_digest,
  });
  return deepFreeze({
    ...current,
    state,
    events: [...current.events, event],
  });
}
