// LANE-PARAMETRIC MARKET ACQUISITION — one durable reality store, many lanes.
//
// The D.C. orchestrator (live-reality-acquisition.mjs) is deliberately
// UNTOUCHED: its ArcGIS revision-bound laws are n=1 of their class and its
// courts prove D.C. unchanged. This orchestrator serves the HTML lane class
// (VA + MD today) through the SAME acquisition state machine and the SAME
// store interface (transactionStore semantics: sourceKey+tenant keyed models,
// content-hash idempotent persistContent) — one persistence layer, market
// contracts supplying the differences.
//
// LAWS (inherited, not invented):
//   - ACQUISITION ≠ VERIFICATION: receipts end UNKNOWN/decision-ineligible.
//   - IDEMPOTENCY: same source + same content ⇒ SOURCE_UNCHANGED outcome,
//     content artifact reused (created:0), lineage appended — never duplicated.
//   - HTML sources carry NO revision identifiers: revision stays UNKNOWN and
//     SOURCE_UNCHANGED is NOT revalidation-eligible (content hash is never
//     promoted into a fake regulatory revision).
//   - Hash-chained state events; time monotonic; tenant-scoped; circuit law.

import { createHash } from 'node:crypto';

import {
  classifyAcquisitionTerminal,
  createAcquisitionState,
  transitionAcquisition,
  GENESIS_EVENT_DIGEST,
} from './acquisition-state-machine.mjs';
import { acquisitionLaneForSourceKey } from './market-acquisition-lanes.mjs';

const CIRCUIT_WORK_CLASS = 'LIVE_ACQUISITION';
const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_COOLDOWN_MS = 10 * 60 * 1000;
const TENANT_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/;

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
const digest = (value) => createHash('sha256').update(typeof value === 'string' ? value : canonicalJson(value)).digest('hex');

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function exactIso(value, code = 'CANA_LIVE_REALITY_TIME_INVALID') {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) fail(code);
  return date.toISOString();
}

function tenantKey(value) {
  const tenant = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!TENANT_PATTERN.test(tenant)) fail('CANA_REALITY_TENANT_INVALID');
  return tenant;
}

function validateVersions(versions) {
  if (!versions || typeof versions !== 'object' || Array.isArray(versions)) fail('CANA_LIVE_REALITY_VERSION_PROVENANCE_REQUIRED');
  if (!/^[a-f0-9]{40}$/.test(versions.repositoryCommitSha ?? '')) fail('CANA_LIVE_REALITY_VERSION_PROVENANCE_REQUIRED');
  if (!/^[a-f0-9]{40}$/.test(versions.repositoryTreeSha ?? '')) fail('CANA_LIVE_REALITY_VERSION_PROVENANCE_REQUIRED');
  for (const name of [
    'adapterVersion', 'parserVersion', 'compilerVersion', 'entityResolverVersion',
    'authorityPolicyVersion', 'freshnessPolicyVersion', 'verificationCourtVersion',
  ]) {
    if (typeof versions[name] !== 'string' || versions[name].length < 1 || versions[name].length > 160) {
      fail('CANA_LIVE_REALITY_VERSION_PROVENANCE_REQUIRED');
    }
  }
  return Object.freeze({ ...versions });
}

const circuitState = (event) => event?.state ?? 'HEALTHY';
const circuitFailures = (event) => Number(event?.failure_count ?? event?.failureCount ?? 0);
const circuitSequence = (event) => Number(event?.sequence ?? 0);
const circuitDigest = (event) => event?.event_digest ?? event?.eventHash ?? GENESIS_EVENT_DIGEST;
function circuitCooldown(event) {
  const value = event?.cooldown_until ?? event?.cooldownUntil;
  return value ? new Date(value) : null;
}

function createCircuitEvent(previous, { state, failureCount, cooldownUntil, reason, at }) {
  const unsigned = {
    schema_version: 'cana-live-reality-circuit-event/v1',
    sequence: circuitSequence(previous) + 1,
    state,
    failure_count: failureCount,
    cooldown_until: cooldownUntil,
    reason,
    at,
    prior_event_digest: circuitDigest(previous),
  };
  return Object.freeze({ ...unsigned, event_digest: digest(unsigned) });
}

function operatorFailure(code) {
  return new Set([
    'CANA_REALITY_TENANT_INVALID',
    'CANA_LIVE_REALITY_ATTEMPT_ID_INVALID',
    'CANA_LIVE_REALITY_VERSION_PROVENANCE_REQUIRED',
    'CANA_LIVE_REALITY_CIRCUIT_OPEN',
    'CANA_LIVE_REALITY_SOURCE_NOT_ADMITTED',
  ]).has(code) || /NOT_AUTHORIZED|FETCH_IMPL_REQUIRED/.test(code);
}

function eventContext({ lane, event, tenant, requestedAt, versions, detail = {}, outcome = null, persisted = null, errorCode = null, disposition = null }) {
  return Object.freeze({
    state: event.state,
    outcome,
    source_key: lane.sourceKey,
    tenant,
    attempt_id: event.attempt_id,
    sequence: event.sequence,
    requested_at: requestedAt,
    event_at: event.at,
    fetched_at: detail.fetched_at ?? persisted?.fetched_at ?? null,
    completed_at: ['COMPLETED', 'FAILED'].includes(event.state) ? event.at : null,
    predicate_scope: lane.predicateScope,
    source_revision: 'UNKNOWN',
    pre_revision: null,
    post_revision: null,
    pre_count: detail.pre_count ?? persisted?.pre_count ?? null,
    post_count: detail.post_count ?? persisted?.post_count ?? null,
    request_digest: lane.contractDigest,
    completeness: persisted ? 'COMPLETE' : detail.record_count === undefined ? 'UNKNOWN' : 'PARTIAL',
    record_count: detail.record_count ?? persisted?.record_count ?? null,
    payload_bytes: detail.payload_bytes ?? persisted?.wire_bytes ?? null,
    adapter_contract_digest: lane.contractDigest,
    content_artifact_id: persisted?.contentArtifactId ?? null,
    snapshot_id: persisted?.snapshotId ?? null,
    content_sha256: persisted?.contentSha256 ?? null,
    response: persisted?.response ?? null,
    versions,
    trigger_kind: 'OWNER_MAINTENANCE_CLI',
    prior_event_digest: event.prior_event_digest,
    event_digest: event.event_digest,
    error_code: errorCode,
    disposition,
    retry_after: null,
  });
}

export async function acquireMarketReality(store, {
  sourceKey,
  tenant,
  attemptId,
  asOf,
  env = process.env,
  fetchImpl,
  clock = () => new Date(),
  versions,
} = {}) {
  if (!store || typeof store.runExclusive !== 'function') fail('CANA_LIVE_REALITY_STORE_INVALID');
  const lane = acquisitionLaneForSourceKey(sourceKey);
  if (!lane) fail('CANA_LIVE_REALITY_SOURCE_NOT_ADMITTED');
  tenant = tenantKey(tenant);
  if (typeof attemptId !== 'string' || attemptId.length < 1 || attemptId.length > 160) fail('CANA_LIVE_REALITY_ATTEMPT_ID_INVALID');
  const requestedAt = exactIso(asOf);
  versions = validateVersions(versions);
  const scope = Object.freeze({ sourceKey: lane.sourceKey, tenant, workClass: CIRCUIT_WORK_CLASS });

  return store.runExclusive(scope, async (tx) => {
    let state = createAcquisitionState({
      attemptId,
      sourceKey: lane.sourceKey,
      at: requestedAt,
      requestDigest: lane.contractDigest,
    });
    let context = eventContext({ lane, event: state.events[0], tenant, requestedAt, versions });
    await tx.appendAcquisitionEvent({ event: state.events[0], context });
    let latestCircuit = await tx.latestCircuit(scope);
    let persisted = null;

    const nextTime = () => exactIso(clock());
    const move = async (nextState, detail = {}, extra = {}) => {
      state = transitionAcquisition(state, { state: nextState, at: extra.at ?? nextTime(), detail });
      const event = state.events.at(-1);
      context = eventContext({
        lane, event, tenant, requestedAt, versions, detail, persisted,
        outcome: extra.outcome ?? null,
        errorCode: extra.errorCode ?? null,
        disposition: extra.disposition ?? null,
      });
      const row = await tx.appendAcquisitionEvent({ event, context });
      return { event, row };
    };

    try {
      lane.assertAuthority({ env });
      if (circuitState(latestCircuit) === 'OPEN_CIRCUIT') {
        const cooldown = circuitCooldown(latestCircuit);
        if (!cooldown || new Date(requestedAt) < cooldown) fail('CANA_LIVE_REALITY_CIRCUIT_OPEN');
        latestCircuit = await tx.appendCircuitEvent(scope, createCircuitEvent(latestCircuit, {
          state: 'PROBE_ALLOWED',
          failureCount: circuitFailures(latestCircuit),
          cooldownUntil: cooldown.toISOString(),
          reason: 'COOLDOWN_ELAPSED',
          at: requestedAt,
        }));
      }

      await move('PREFLIGHT_VALIDATED', { authority: 'OWNER_OPT_IN', fixed_origin: true });
      await move('FETCHING', { request_digest: lane.contractDigest });
      const capture = await lane.capture({
        fetchImpl,
        env,
        clock,
        onStage: async (stage, detail) => move(stage, detail, { at: detail.fetched_at }),
      });

      const prior = await tx.latestContent({ sourceKey: capture.source_key, tenant });
      const changed = prior?.content_sha256 !== capture.content_sha256;
      if (changed) await move('CHANGED', { content_sha256: capture.content_sha256 });
      else await move('UNCHANGED', { content_sha256: capture.content_sha256 });

      persisted = await tx.persistContent({ capture });
      persisted = Object.freeze({ ...persisted, ...capture });
      if (changed) await move('PERSISTED', { content_sha256: capture.content_sha256 });
      else await move('REVALIDATION_PENDING', { content_sha256: capture.content_sha256 });

      const outcome = changed ? 'SOURCE_CHANGED' : 'SOURCE_UNCHANGED';
      // HTML lane law: revisions do not exist ⇒ never revision-bound.
      const disposition = classifyAcquisitionTerminal({ outcome, revisionBound: false });
      const terminal = await move('COMPLETED', {
        content_sha256: capture.content_sha256,
        pre_count: capture.pre_count,
        post_count: capture.post_count,
        record_count: capture.record_count,
        fetched_at: capture.fetched_at,
        payload_bytes: capture.wire_bytes,
      }, { outcome, disposition });
      const capabilityUnsigned = {
        schema_version: 'cana-live-reality-capability-receipt/v1',
        acquisition_event_id: terminal.row.id,
        source_key: capture.source_key,
        observed_at: terminal.event.at,
        capabilities: capture.capability,
      };
      await tx.appendCapabilityReceipt(Object.freeze({ ...capabilityUnsigned, receipt_digest: digest(capabilityUnsigned) }));
      latestCircuit = await tx.appendCircuitEvent(scope, createCircuitEvent(latestCircuit, {
        state: 'HEALTHY', failureCount: 0, cooldownUntil: null,
        reason: 'SOURCE_OBSERVATION_COMPLETE', at: terminal.event.at,
      }));
      return Object.freeze({
        schema_version: 'cana-live-reality-acquisition-receipt/v1',
        state: 'COMPLETED',
        outcome,
        market_id: lane.marketId,
        source_key: capture.source_key,
        tenant,
        attempt_id: attemptId,
        requested_at: requestedAt,
        acquired_at: capture.fetched_at,
        completed_at: terminal.event.at,
        ...disposition,
        revision_bound: false,
        acquisition_event_id: terminal.row.id,
        content_artifact_id: persisted.contentArtifactId,
        snapshot_id: persisted.snapshotId,
        content_sha256: capture.content_sha256,
        content_artifacts_created: persisted.created ? 1 : 0,
        record_count: capture.record_count,
        terminal_event_digest: terminal.event.event_digest,
        circuit_state: circuitState(latestCircuit),
        verification: 'UNKNOWN',
        decision_eligible: false,
        compilations_created: 0,
        claims_created: 0,
        verification_events_created: 0,
        public_truth_mutations: 0,
        external_effects: 0,
      });
    } catch (error) {
      if (state.state === 'COMPLETED') fail('CANA_LIVE_REALITY_COMPLETION_PERSISTENCE_FAILED');
      const errorCode = typeof error?.code === 'string' ? error.code
        : /^CANA_[A-Z0-9_:]+/.test(error?.message ?? '') ? error.message.split(':')[0]
        : 'CANA_LIVE_REALITY_UNEXPECTED_FAILURE';
      const disposition = classifyAcquisitionTerminal({ errorCode });
      if (!['COMPLETED', 'FAILED'].includes(state.state)) {
        await move('FAILED', { error_code: errorCode, ...disposition }, {
          outcome: 'SOURCE_FAILED', errorCode, disposition,
        });
      }
      if (!operatorFailure(errorCode)) {
        const failures = circuitFailures(latestCircuit) + 1;
        const open = failures >= CIRCUIT_FAILURE_THRESHOLD;
        const at = state.events.at(-1).at;
        latestCircuit = await tx.appendCircuitEvent(scope, createCircuitEvent(latestCircuit, {
          state: open ? 'OPEN_CIRCUIT' : 'DEGRADED',
          failureCount: failures,
          cooldownUntil: open ? new Date(new Date(at).getTime() + CIRCUIT_COOLDOWN_MS).toISOString() : null,
          reason: errorCode, at,
        }));
      }
      return Object.freeze({
        schema_version: 'cana-live-reality-acquisition-receipt/v1',
        state: 'FAILED',
        outcome: 'SOURCE_FAILED',
        market_id: lane.marketId,
        source_key: lane.sourceKey,
        tenant,
        attempt_id: attemptId,
        requested_at: requestedAt,
        completed_at: state.events.at(-1).at,
        error_code: errorCode,
        ...disposition,
        terminal_event_digest: state.events.at(-1).event_digest,
        circuit_state: circuitState(latestCircuit),
        content_artifacts_created: 0,
        compilations_created: 0,
        claims_created: 0,
        verification_events_created: 0,
        public_truth_mutations: 0,
        external_effects: 0,
      });
    }
  });
}
