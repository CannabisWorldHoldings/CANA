// VA CCA / NOIRA WATCH EVIDENCE — Virginia Pre-Entry slice 2 (Transfer Test #1).
//
// This is NOT a news scraper. It is the evidence lane for regulator watching:
// every observation becomes a structured, hash-chained, tamper-evident event:
//   EVENT → SOURCE → CONTENT HASH → CHANGE → MARKET IMPACT → DEADLINE
//   → RECOMMENDED ACTION → OWNER AUTHORITY REQUIRED.
//
// LAWS:
//   - OBSERVE_ONLY. This module exposes no network, submission, or contact
//     capability. Any recommended action that would touch the outside world
//     carries owner_authority_required: true — always.
//   - Deadlines are never guessed. A deadline is either derived from an
//     admitted countdown fact (cited) or explicitly UNKNOWN.
//   - Events are hash-chained (genesis = 64 zeros, mirroring the
//     continuation kernel's receipt discipline) and time-monotonic.

import { createHash } from 'node:crypto';

export const VA_WATCH_SCHEMA_VERSION = 'cana-va-watch-evidence/v1';
export const WATCH_GENESIS_DIGEST = '0'.repeat(64);

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Signal class → market impact + advisory action. Advisory strings only. */
const SIGNAL_DOCTRINE = Object.freeze({
  RULEMAKING: Object.freeze({
    market_impact: 'PUBLIC_COMMENT_WINDOW_MAY_BE_OPENING',
    recommended_action:
      'Review the filed rulemaking document; prepare comment filing for owner decision',
  }),
  APPLICATION_WINDOW: Object.freeze({
    market_impact: 'LICENSE_APPLICANT_GRAPH_SOURCE_AVAILABLE',
    recommended_action: 'Ingest published applications into the applicant graph',
  }),
  BOARD_MEETING: Object.freeze({
    market_impact: 'REGULATOR_DECISION_FORUM_SCHEDULED',
    recommended_action: 'Review agenda; extract decisions into market model',
  }),
  REGULATOR_ANNOUNCEMENT: Object.freeze({
    market_impact: 'REGULATORY_STATE_MAY_HAVE_CHANGED',
    recommended_action: 'Diff announcement against current market model',
  }),
  REGISTRY_CHANGE: Object.freeze({
    market_impact: 'LICENSED_ENTITY_SET_MAY_HAVE_CHANGED',
    recommended_action:
      'Refresh registry fixture and pinned counts in the same commit; re-run extraction',
  }),
});

/**
 * Compare a fresh observation of a watch target against the prior content
 * digest. Pure change detection — no interpretation.
 */
export function createWatchObservation({ targetId, url, fetchedAt, contentSha256, previousSha256 } = {}) {
  if (typeof targetId !== 'string' || targetId.length === 0) {
    throw new Error('createWatchObservation: targetId is required');
  }
  if (typeof url !== 'string' || !url.startsWith('https://')) {
    throw new Error('createWatchObservation: url must be https');
  }
  if (!/^[0-9a-f]{64}$/.test(contentSha256 ?? '')) {
    throw new Error('createWatchObservation: contentSha256 must be a sha256 hex digest');
  }
  const at = fetchedAt instanceof Date ? fetchedAt : new Date(fetchedAt);
  if (Number.isNaN(at.getTime())) {
    throw new Error('createWatchObservation: fetchedAt must be a valid time');
  }
  let change = 'FIRST_OBSERVATION';
  if (previousSha256 !== undefined && previousSha256 !== null) {
    if (!/^[0-9a-f]{64}$/.test(previousSha256)) {
      throw new Error('createWatchObservation: previousSha256 must be a sha256 hex digest');
    }
    change = previousSha256 === contentSha256 ? 'UNCHANGED' : 'CHANGED';
  }
  return Object.freeze({
    target_id: targetId,
    source_url: url,
    fetched_at: at.toISOString(),
    content_sha256: contentSha256,
    previous_sha256: previousSha256 ?? null,
    change,
  });
}

/**
 * Compile an observation into a chained watch event. `deadline` must be an
 * admitted countdown fact `{ date, citation }` or omitted → UNKNOWN.
 */
export function compileWatchEvent({ observation, signal, marketId = 'US-VA', deadline, previousEventDigest } = {}) {
  if (!observation || typeof observation.content_sha256 !== 'string') {
    throw new Error('compileWatchEvent: observation is required');
  }
  const doctrine = SIGNAL_DOCTRINE[signal];
  if (!doctrine) {
    throw new Error(`compileWatchEvent: unknown signal class: ${signal}`);
  }
  const prev = previousEventDigest ?? WATCH_GENESIS_DIGEST;
  if (!/^[0-9a-f]{64}$/.test(prev)) {
    throw new Error('compileWatchEvent: previousEventDigest must be a sha256 hex digest');
  }
  let deadlineValue;
  if (deadline === undefined || deadline === null) {
    deadlineValue = Object.freeze({ state: 'UNKNOWN' });
  } else if (
    typeof deadline.date === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(deadline.date) &&
    typeof deadline.citation === 'string' &&
    deadline.citation.length > 0
  ) {
    deadlineValue = Object.freeze({ state: 'KNOWN', date: deadline.date, citation: deadline.citation });
  } else {
    throw new Error('compileWatchEvent: deadline must be {date, citation} or absent — never guessed');
  }

  const payload = {
    schema_version: VA_WATCH_SCHEMA_VERSION,
    market_id: marketId,
    observe_only: true,
    signal,
    observation,
    market_impact: doctrine.market_impact,
    deadline: deadlineValue,
    recommended_action: doctrine.recommended_action,
    owner_authority_required: true,
    previous_event_digest: prev,
  };
  const event_digest = sha256(canonicalJson(payload));
  return Object.freeze({ ...payload, event_digest });
}

/** Append with chain + time monotonicity verification. Tamper-evident. */
export function appendWatchEvent(chain, event) {
  if (!Array.isArray(chain)) throw new Error('appendWatchEvent: chain must be an array');
  const expectedPrev = chain.length === 0 ? WATCH_GENESIS_DIGEST : chain[chain.length - 1].event_digest;
  if (event.previous_event_digest !== expectedPrev) {
    throw new Error('appendWatchEvent: chain linkage broken');
  }
  const { event_digest, ...payload } = event;
  if (sha256(canonicalJson(payload)) !== event_digest) {
    throw new Error('appendWatchEvent: event digest does not match payload — tamper evident');
  }
  if (
    chain.length > 0 &&
    event.observation.fetched_at < chain[chain.length - 1].observation.fetched_at
  ) {
    throw new Error('appendWatchEvent: time reversed');
  }
  return Object.freeze([...chain, event]);
}
