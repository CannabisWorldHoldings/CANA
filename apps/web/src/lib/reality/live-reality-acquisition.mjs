import { createHash } from 'node:crypto';

import {
  ABCA_LIVE_CONTRACT,
  ABCA_LIVE_CONTRACT_DIGEST,
  assertLiveAcquisitionAuthority,
  captureAbcaReality,
} from './live-abca-adapter.mjs';
import {
  GENESIS_EVENT_DIGEST,
  classifyAcquisitionTerminal,
  createAcquisitionState,
  transitionAcquisition,
} from './acquisition-state-machine.mjs';

const CIRCUIT_WORK_CLASS = 'LIVE_ACQUISITION';
const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_COOLDOWN_MS = 10 * 60 * 1000;
const PREDICATE_SCOPE = 'licensed_retailer_identity,status,address,coordinates';
const TENANT_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/;

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : canonicalJson(value)).digest('hex');
}

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

function boundedIdentifier(value, code) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 160) fail(code);
  return value;
}

function validateVersions(versions) {
  if (!versions || typeof versions !== 'object' || Array.isArray(versions)) fail('CANA_LIVE_REALITY_VERSION_PROVENANCE_REQUIRED');
  if (!/^[a-f0-9]{40}$/.test(versions.repositoryCommitSha ?? '')) fail('CANA_LIVE_REALITY_VERSION_PROVENANCE_REQUIRED');
  if (versions.repositoryTreeSha !== undefined && !/^[a-f0-9]{40}$/.test(versions.repositoryTreeSha)) {
    fail('CANA_LIVE_REALITY_VERSION_PROVENANCE_REQUIRED');
  }
  for (const name of [
    'adapterVersion',
    'parserVersion',
    'compilerVersion',
    'entityResolverVersion',
    'authorityPolicyVersion',
    'freshnessPolicyVersion',
    'verificationCourtVersion',
  ]) boundedIdentifier(versions[name], 'CANA_LIVE_REALITY_VERSION_PROVENANCE_REQUIRED');
  return Object.freeze({ ...versions });
}

function circuitValue(event, snake, camel) {
  return event?.[snake] ?? event?.[camel];
}

function circuitState(event) {
  return event?.state ?? 'HEALTHY';
}

function circuitFailures(event) {
  return Number(circuitValue(event, 'failure_count', 'failureCount') ?? 0);
}

function circuitSequence(event) {
  return Number(event?.sequence ?? 0);
}

function circuitDigest(event) {
  return circuitValue(event, 'event_digest', 'eventHash') ?? GENESIS_EVENT_DIGEST;
}

function circuitCooldown(event) {
  const value = circuitValue(event, 'cooldown_until', 'cooldownUntil');
  return value ? new Date(value) : null;
}

function retryAfter(error, at) {
  const observedAt = new Date(at);
  if (!Number.isFinite(observedAt.getTime())) return null;
  if (Number.isFinite(error?.retryAfterMs)) {
    return new Date(observedAt.getTime() + error.retryAfterMs).toISOString();
  }
  const exact = new Date(error?.retryAfterAt);
  if (Number.isFinite(exact.getTime()) && exact > observedAt) {
    return new Date(Math.min(exact.getTime(), observedAt.getTime() + 24 * 60 * 60 * 1000)).toISOString();
  }
  return null;
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

function sourceFailure(code) {
  return !new Set([
    'CANA_LIVE_REALITY_AUTHORITY_REQUIRED',
    'CANA_LIVE_REALITY_CI_REFUSED',
    'CANA_LIVE_REALITY_PROXY_REFUSED',
    'CANA_LIVE_REALITY_REQUEST_INPUT_REFUSED',
    'CANA_LIVE_REALITY_FIXTURE_METADATA_REFUSED',
    'CANA_LIVE_REALITY_CIRCUIT_OPEN',
    'CANA_REALITY_TENANT_INVALID',
    'CANA_LIVE_REALITY_ATTEMPT_ID_INVALID',
    'CANA_LIVE_REALITY_VERSION_PROVENANCE_REQUIRED',
  ]).has(code);
}

function outcomeForFailure(code) {
  if (/PARTIAL|RECORD_COUNT/.test(code)) return 'SOURCE_PARTIAL';
  if (/SCHEMA|REVISION_UNKNOWN|FIELD|GLOBALID|LICENSE|OBJECTID/.test(code)) return 'SOURCE_SCHEMA_CHANGED';
  return 'SOURCE_FAILED';
}

function eventContext({
  event,
  tenant,
  requestedAt,
  versions,
  detail = {},
  outcome = null,
  persisted = null,
  errorCode = null,
  disposition = null,
}) {
  return Object.freeze({
    state: event.state,
    outcome,
    source_key: ABCA_LIVE_CONTRACT.sourceKey,
    tenant,
    attempt_id: event.attempt_id,
    sequence: event.sequence,
    requested_at: requestedAt,
    event_at: event.at,
    fetched_at: detail.fetched_at ?? persisted?.fetched_at ?? null,
    completed_at: ['COMPLETED', 'FAILED'].includes(event.state) ? event.at : null,
    predicate_scope: PREDICATE_SCOPE,
    source_revision: detail.post_revision ?? detail.pre_revision ?? persisted?.post_revision ?? 'UNKNOWN',
    pre_revision: detail.pre_revision ?? persisted?.pre_revision ?? null,
    post_revision: detail.post_revision ?? persisted?.post_revision ?? null,
    pre_count: detail.pre_count ?? persisted?.pre_count ?? null,
    post_count: detail.post_count ?? persisted?.post_count ?? null,
    request_digest: ABCA_LIVE_CONTRACT_DIGEST,
    completeness: persisted ? 'COMPLETE' : detail.record_count === undefined ? 'UNKNOWN' : 'PARTIAL',
    record_count: detail.record_count ?? persisted?.record_count ?? null,
    payload_bytes: detail.payload_bytes ?? persisted?.wire_bytes ?? null,
    adapter_contract_digest: ABCA_LIVE_CONTRACT_DIGEST,
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
    retry_after: detail.retry_after ?? null,
  });
}

function failureReceipt({
  attemptId,
  tenant,
  requestedAt,
  event,
  errorCode,
  outcome,
  circuit,
  disposition,
  retryAfterAt,
}) {
  return Object.freeze({
    schema_version: 'cana-live-reality-acquisition-receipt/v1',
    state: 'FAILED',
    outcome,
    source_key: ABCA_LIVE_CONTRACT.sourceKey,
    tenant,
    attempt_id: attemptId,
    requested_at: requestedAt,
    completed_at: event.at,
    error_code: errorCode,
    ...disposition,
    retry_after: retryAfterAt,
    terminal_event_digest: event.event_digest,
    circuit_state: circuitState(circuit),
    content_artifacts_created: 0,
    compilations_created: 0,
    claims_created: 0,
    verification_events_created: 0,
    public_truth_mutations: 0,
    external_effects: 0,
  });
}

export async function acquireLiveMarketReality(store, {
  tenant,
  attemptId,
  asOf,
  env = process.env,
  request,
  sourceCatalogModifiedDate,
  lookup,
  fetchImpl,
  clock = () => new Date(),
  versions,
} = {}) {
  if (!store || typeof store.runExclusive !== 'function') fail('CANA_LIVE_REALITY_STORE_INVALID');
  tenant = tenantKey(tenant);
  boundedIdentifier(attemptId, 'CANA_LIVE_REALITY_ATTEMPT_ID_INVALID');
  const requestedAt = exactIso(asOf);
  versions = validateVersions(versions);
  const scope = Object.freeze({ sourceKey: ABCA_LIVE_CONTRACT.sourceKey, tenant, workClass: CIRCUIT_WORK_CLASS });

  return store.runExclusive(scope, async (tx) => {
    let state = createAcquisitionState({
      attemptId,
      sourceKey: ABCA_LIVE_CONTRACT.sourceKey,
      at: requestedAt,
      requestDigest: ABCA_LIVE_CONTRACT_DIGEST,
    });
    let context = eventContext({ event: state.events[0], tenant, requestedAt, versions });
    await tx.appendAcquisitionEvent({ event: state.events[0], context });
    let latestCircuit = await tx.latestCircuit(scope);
    let persisted = null;

    const nextTime = () => exactIso(clock());
    const move = async (nextState, detail = {}, extra = {}) => {
      state = transitionAcquisition(state, { state: nextState, at: extra.at ?? nextTime(), detail });
      const event = state.events.at(-1);
      context = eventContext({
        event,
        tenant,
        requestedAt,
        versions,
        detail,
        persisted,
        outcome: extra.outcome ?? null,
        errorCode: extra.errorCode ?? null,
        disposition: extra.disposition ?? null,
      });
      const row = await tx.appendAcquisitionEvent({ event, context });
      return { event, row };
    };

    try {
      if (sourceCatalogModifiedDate !== undefined) fail('CANA_LIVE_REALITY_FIXTURE_METADATA_REFUSED');
      assertLiveAcquisitionAuthority({ env, request });
      if (circuitState(latestCircuit) === 'OPEN_CIRCUIT') {
        const cooldown = circuitCooldown(latestCircuit);
        if (!cooldown || new Date(requestedAt) < cooldown) fail('CANA_LIVE_REALITY_CIRCUIT_OPEN');
        const probe = createCircuitEvent(latestCircuit, {
          state: 'PROBE_ALLOWED',
          failureCount: circuitFailures(latestCircuit),
          cooldownUntil: cooldown.toISOString(),
          reason: 'COOLDOWN_ELAPSED',
          at: requestedAt,
        });
        latestCircuit = await tx.appendCircuitEvent(scope, probe);
      }

      await move('PREFLIGHT_VALIDATED', { authority: 'OWNER_OPT_IN', fixed_origin: true });
      await move('FETCHING', { request_digest: ABCA_LIVE_CONTRACT_DIGEST });
      const capture = await captureAbcaReality({
        fetchImpl,
        lookup,
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
      const revisionBound = capture.pre_revision !== null && capture.post_revision !== null;
      const disposition = classifyAcquisitionTerminal({ outcome, revisionBound });
      const terminal = await move('COMPLETED', {
        content_sha256: capture.content_sha256,
        pre_revision: capture.pre_revision,
        post_revision: capture.post_revision,
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
      await tx.appendCapabilityReceipt(Object.freeze({
        ...capabilityUnsigned,
        receipt_digest: digest(capabilityUnsigned),
      }));
      const healthy = createCircuitEvent(latestCircuit, {
        state: 'HEALTHY',
        failureCount: 0,
        cooldownUntil: null,
        reason: 'SOURCE_OBSERVATION_COMPLETE',
        at: terminal.event.at,
      });
      latestCircuit = await tx.appendCircuitEvent(scope, healthy);
      return Object.freeze({
        schema_version: 'cana-live-reality-acquisition-receipt/v1',
        state: 'COMPLETED',
        outcome,
        source_key: capture.source_key,
        tenant,
        attempt_id: attemptId,
        requested_at: requestedAt,
        acquired_at: capture.fetched_at,
        completed_at: terminal.event.at,
        ...disposition,
        revision_bound: revisionBound,
        acquisition_event_id: terminal.row.id,
        content_artifact_id: persisted.contentArtifactId,
        snapshot_id: persisted.snapshotId,
        content_sha256: capture.content_sha256,
        content_artifacts_created: persisted.created ? 1 : 0,
        terminal_event_digest: terminal.event.event_digest,
        circuit_state: circuitState(latestCircuit),
        compilations_created: 0,
        claims_created: 0,
        verification_events_created: 0,
        public_truth_mutations: 0,
        external_effects: 0,
      });
    } catch (error) {
      const errorCode = typeof error?.code === 'string' ? error.code : 'CANA_LIVE_REALITY_UNEXPECTED_FAILURE';
      const disposition = classifyAcquisitionTerminal({ errorCode });
      const rateLimitRetryAt = errorCode === 'CANA_LIVE_REALITY_RATE_LIMITED'
        ? retryAfter(error, state.events.at(-1).at)
        : null;
      if (!['COMPLETED', 'FAILED'].includes(state.state)) {
        await move('FAILED', { error_code: errorCode, retry_after: rateLimitRetryAt, ...disposition }, {
          outcome: outcomeForFailure(errorCode),
          errorCode,
          disposition,
        });
      }
      if (sourceFailure(errorCode)) {
        const failures = circuitFailures(latestCircuit) + 1;
        const open = errorCode === 'CANA_LIVE_REALITY_RATE_LIMITED' || failures >= CIRCUIT_FAILURE_THRESHOLD;
        const at = state.events.at(-1).at;
        const cooldownUntil = open
          ? rateLimitRetryAt ?? new Date(new Date(at).getTime() + CIRCUIT_COOLDOWN_MS).toISOString()
          : null;
        const circuitEvent = createCircuitEvent(latestCircuit, {
          state: open ? 'OPEN_CIRCUIT' : 'DEGRADED',
          failureCount: failures,
          cooldownUntil,
          reason: errorCode,
          at,
        });
        latestCircuit = await tx.appendCircuitEvent(scope, circuitEvent);
      }
      return failureReceipt({
        attemptId,
        tenant,
        requestedAt,
        event: state.events.at(-1),
        errorCode,
        outcome: outcomeForFailure(errorCode),
        circuit: latestCircuit,
        disposition,
        retryAfterAt: rateLimitRetryAt,
      });
    }
  });
}

function prismaEventData(event, context) {
  const response = context.response ?? {};
  const versions = context.versions;
  return {
    sourceKey: context.source_key,
    attemptId: context.attempt_id,
    sequence: context.sequence,
    state: context.state,
    outcome: context.outcome,
    predicateScope: context.predicate_scope,
    requestedAt: new Date(context.requested_at),
    eventAt: new Date(context.event_at),
    fetchedAt: context.fetched_at ? new Date(context.fetched_at) : null,
    completedAt: context.completed_at ? new Date(context.completed_at) : null,
    sourceRevision: context.source_revision,
    preSourceRevision: context.pre_revision,
    postSourceRevision: context.post_revision,
    revisionState: context.source_revision === 'UNKNOWN' ? 'UNKNOWN' : 'OBSERVED',
    etag: response.etag,
    lastModified: response.last_modified,
    httpStatus: response.http_status,
    responseContentType: response.content_type,
    requestDigest: context.request_digest,
    completeness: context.completeness,
    observedRecordCount: context.record_count,
    preObservedRecordCount: context.pre_count,
    postObservedRecordCount: context.post_count,
    observedPayloadBytes: context.payload_bytes,
    adapterVersion: versions.adapterVersion,
    adapterContractDigest: context.adapter_contract_digest,
    parserVersion: versions.parserVersion,
    compilerVersion: versions.compilerVersion,
    entityResolverVersion: versions.entityResolverVersion,
    authorityPolicyVersion: versions.authorityPolicyVersion,
    freshnessPolicyVersion: versions.freshnessPolicyVersion,
    verificationCourtVersion: versions.verificationCourtVersion,
    repositoryCommitSha: versions.repositoryCommitSha,
    repositoryTreeSha: versions.repositoryTreeSha,
    triggerKind: context.trigger_kind,
    tenant: context.tenant,
    contentArtifactId: context.content_artifact_id,
    snapshotId: context.snapshot_id,
    priorEventHash: context.prior_event_digest,
    eventHash: context.event_digest,
    errorCode: context.error_code,
    errorDetail: context.disposition ? JSON.stringify({
      disposition: context.disposition,
      retry_after: context.retry_after,
    }) : null,
  };
}

function transactionStore(tx) {
  return Object.freeze({
    async latestContent({ sourceKey, tenant }) {
      const event = await tx.marketSourceAcquisitionEvent.findFirst({
        where: { sourceKey, tenant, state: 'COMPLETED', contentArtifactId: { not: null } },
        orderBy: [{ eventAt: 'desc' }, { sequence: 'desc' }],
        select: { contentArtifactId: true, snapshotId: true, contentArtifact: { select: { contentSha256: true } } },
      });
      return event ? {
        content_artifact_id: event.contentArtifactId,
        snapshot_id: event.snapshotId,
        content_sha256: event.contentArtifact.contentSha256,
      } : null;
    },
    async appendAcquisitionEvent({ event, context }) {
      return tx.marketSourceAcquisitionEvent.create({ data: prismaEventData(event, context) });
    },
    async persistContent({ capture }) {
      let snapshot = await tx.marketSourceSnapshot.findUnique({
        where: { sourceKey_payloadSha256: { sourceKey: capture.source_key, payloadSha256: capture.content_sha256 } },
      });
      if (!snapshot) {
        snapshot = await tx.marketSourceSnapshot.create({ data: {
          sourceKey: capture.source_key,
          sourceUrl: capture.source_url,
          queryParameters: JSON.stringify({
            contract_digest: capture.request_digest,
            query: capture.manifest.query,
            manifest_base64: capture.manifest_bytes.toString('base64'),
            provenance_mode: 'LIVE',
            source_catalog_modified_date: null,
          }),
          fetchedAt: new Date(capture.fetched_at),
          sourceModifiedAt: capture.source_modified_at ? new Date(capture.source_modified_at) : null,
          payloadSha256: capture.content_sha256,
          payloadBytes: capture.snapshot_bytes.length,
          recordCount: capture.record_count,
          schemaVersion: capture.manifest.schema_version,
          payloadJson: capture.snapshot_bytes.toString('utf8'),
          completeness: 'COMPLETE',
        } });
      }
      let content = await tx.marketSourceContentArtifact.findUnique({
        where: { sourceKey_contentSha256: { sourceKey: capture.source_key, contentSha256: capture.content_sha256 } },
      });
      let created = false;
      if (!content) {
        content = await tx.marketSourceContentArtifact.create({ data: {
          snapshotId: snapshot.id,
          sourceKey: capture.source_key,
          sourceUrl: capture.source_url,
          requestContractDigest: capture.request_digest,
          contentSha256: capture.content_sha256,
          payloadBytes: capture.snapshot_bytes.length,
          recordCount: capture.record_count,
          schemaVersion: capture.manifest.schema_version,
        } });
        created = true;
      }
      return {
        contentArtifactId: content.id,
        snapshotId: snapshot.id,
        contentSha256: content.contentSha256,
        payloadBytes: content.payloadBytes,
        created,
      };
    },
    async appendCapabilityReceipt(receipt) {
      return tx.marketSourceCapabilityReceipt.create({ data: {
        acquisitionEventId: receipt.acquisition_event_id,
        sourceKey: receipt.source_key,
        observedAt: new Date(receipt.observed_at),
        capabilitiesJson: JSON.stringify(receipt.capabilities),
        limitsJson: JSON.stringify(receipt.capabilities.limits),
        schemaDigest: receipt.capabilities.schema_digest,
        receiptDigest: receipt.receipt_digest,
      } });
    },
    async latestCircuit(scope) {
      return tx.marketSourceCircuitEvent.findFirst({
        where: { sourceKey: scope.sourceKey, tenant: scope.tenant, workClass: scope.workClass },
        orderBy: [{ sequence: 'desc' }],
      });
    },
    async appendCircuitEvent(scope, event) {
      return tx.marketSourceCircuitEvent.create({ data: {
        sourceKey: scope.sourceKey,
        tenant: scope.tenant,
        workClass: scope.workClass,
        sequence: event.sequence,
        state: event.state,
        failureCount: event.failure_count,
        cooldownUntil: event.cooldown_until ? new Date(event.cooldown_until) : null,
        reason: event.reason,
        priorEventHash: event.prior_event_digest,
        eventHash: event.event_digest,
        createdAt: new Date(event.at),
      } });
    },
  });
}

export function createPrismaAcquisitionStore(prisma) {
  if (!prisma || typeof prisma.$transaction !== 'function') fail('CANA_LIVE_REALITY_STORE_INVALID');
  return Object.freeze({
    async runExclusive(scope, work) {
      return prisma.$transaction(async (tx) => {
        await tx.$queryRawUnsafe(
          'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))::text AS lock_result',
          `${scope.sourceKey}:${scope.workClass}`,
        );
        return work(transactionStore(tx));
      }, { isolationLevel: 'Serializable', timeout: 60_000 });
    },
  });
}
