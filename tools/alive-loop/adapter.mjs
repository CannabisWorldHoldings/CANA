// ALIVE LOOP v1 — the Minimum Alive Loop, executable.
// Spec: docs/convergence/mission-1/MINIMUM_ALIVE_LOOP_SPEC.md (DESIGN_READY → implemented here).
//
// This is the ONE thin composition adapter the spec permits. It creates no new
// governor, router, or loop engine — it composes the exact seams the spec selects:
//
//   compile()                            skills-src/sitemind-context-compiler.mjs
//   makeChangeEvent/makeCandidate/
//   promote/toWinnerMemory               skills-src/cana-signal-to-fix.mjs
//   makeGrant/sealPacket/makeReceipt     skills-src/hermes-governed-packet.mjs
//
// OS SEAM PROVENANCE (spec table rows "Lease/idempotency storage" and "Receipt
// mechanics" name runtime/mission.py / runtime/rsi.py / runtime/evidence.py from
// the Intelligence OS): that repository is NOT present in this environment, and
// the import boundary forbids copying unallowlisted modules. Their CONTRACTS —
// one active lease per idempotency key, retry without duplicate logical effect,
// append-only hash-bound evidence — are re-implemented minimally below, marked
// [OS-CONTRACT], per the spec's "selectively port the named OS seams" boundary.
//
// AUTHORITY LAW: models propose → policy authorizes → narrow executors act →
// evidence proves. The adapter never grants itself capabilities: every cycle
// starts from an explicit CANA mission grant and fails closed on any absent,
// expired, inconsistent, or unknown field. Provider route is 'none'|'mock' only.
// Cost must be 0. External effects must be 0. Owner-only capabilities refuse.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { compile } from '../../skills-src/sitemind-context-compiler.mjs';
import {
  makeCandidate, makeChangeEvent, promote, toWinnerMemory,
} from '../../skills-src/cana-signal-to-fix.mjs';
import {
  CAPABILITIES, OWNER_ONLY, makeGrant, sealPacket, makeReceipt,
} from '../../skills-src/hermes-governed-packet.mjs';

export const LOOP_SCHEMA = 'cana-alive-loop/1';
export const STATES = Object.freeze([
  'GRANTED', 'LEASED', 'COMPILED', 'PROPOSED', 'SEALED',
  'EXECUTED_LOCAL', 'RECEIPTED', 'MEASURED', 'ADMITTED', 'REJECTED', 'CLOSED',
]);
const ROUTES = Object.freeze(['none', 'mock']);

const sha = (value) => createHash('sha256').update(value).digest('hex');
const text = (value) => typeof value === 'string' && value.trim() !== '';
const canonical = (value) => JSON.stringify(sortKeys(value));
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sortKeys(value[k])]));
  }
  return value;
}

export class LoopRefusal extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = 'LoopRefusal';
    this.code = code;
  }
}
const refuse = (code, message) => { throw new LoopRefusal(code, message); };

/** Deterministic idempotency key over the STABLE grant fields (spec: input contract). */
export function idempotencyKey(grant) {
  return sha(canonical({
    mission_id: grant.mission_id,
    mission_version: grant.mission_version,
    cana_commit: grant.cana_commit,
    cana_tree: grant.cana_tree,
    objective: grant.objective,
    metric: grant.metric,
    target: grant.target,
    allowed_paths: grant.allowed_paths,
    capabilities: grant.capabilities,
    provider_route: grant.provider_route,
    policy_version: grant.policy_version,
    schema_version: grant.schema_version,
  }));
}

/**
 * Validate a CANA mission grant. Every rule fails CLOSED (spec: "Any absent,
 * expired, inconsistent, or unknown field fails closed.").
 */
export function validateMissionGrant(grant, { now = new Date(), repoHead, repoTree } = {}) {
  if (!grant || typeof grant !== 'object') refuse('GRANT_ABSENT', 'a mission grant object is required');
  const need = (cond, code, msg) => { if (!cond) refuse(code, msg); };

  need(text(grant.mission_id), 'GRANT_FIELD', 'mission_id required');
  need(Number.isInteger(grant.mission_version) && grant.mission_version >= 1, 'GRANT_FIELD', 'mission_version must be a positive integer');
  need(text(grant.issued_at) && !Number.isNaN(Date.parse(grant.issued_at)), 'GRANT_FIELD', 'issued_at must be a valid time');
  need(text(grant.expires_at) && !Number.isNaN(Date.parse(grant.expires_at)), 'GRANT_FIELD', 'expires_at must be a valid time');
  need(Date.parse(grant.expires_at) > now.getTime(), 'GRANT_EXPIRED', 'grant already expired');
  need(text(grant.cana_commit), 'GRANT_FIELD', 'exact cana_commit required');
  need(text(grant.cana_tree), 'GRANT_FIELD', 'exact cana_tree required');
  // Court 1 — exact-source/tree refusal.
  if (repoHead) need(grant.cana_commit === repoHead, 'TREE_MISMATCH', `grant pins ${grant.cana_commit.slice(0, 12)} but candidate is ${repoHead.slice(0, 12)}`);
  if (repoTree) need(grant.cana_tree === repoTree, 'TREE_MISMATCH', `grant pins tree ${grant.cana_tree.slice(0, 12)} but candidate tree is ${repoTree.slice(0, 12)}`);
  need(text(grant.target), 'GRANT_FIELD', 'target required');
  need(Array.isArray(grant.allowed_paths) && grant.allowed_paths.length > 0 && grant.allowed_paths.every(text), 'GRANT_FIELD', 'allowed_paths must be a non-empty string array');
  need(text(grant.objective), 'GRANT_FIELD', 'objective required');
  need(text(grant.metric), 'GRANT_FIELD', 'predeclared metric required');
  need(Number.isInteger(grant.max_attempts) && grant.max_attempts >= 1, 'GRANT_FIELD', 'max_attempts must be a positive integer');
  need(Number.isInteger(grant.max_runtime_ms) && grant.max_runtime_ms > 0, 'GRANT_FIELD', 'max_runtime_ms must be a positive integer');
  need(Number.isInteger(grant.max_bytes) && grant.max_bytes > 0, 'GRANT_FIELD', 'max_bytes must be a positive integer');
  need(grant.max_cost === 0, 'COST_NONZERO', 'first-court grants must carry max_cost 0');
  need(Array.isArray(grant.capabilities) && grant.capabilities.length > 0, 'GRANT_FIELD', 'capability allowlist required');
  for (const cap of grant.capabilities) {
    if (OWNER_ONLY.includes(cap)) refuse('OWNER_ONLY_CAPABILITY', `${cap} is owner-only and cannot appear in an agent grant`);
    if (!CAPABILITIES.includes(cap)) refuse('UNKNOWN_CAPABILITY', `unknown capability ${cap}`);
  }
  need(Array.isArray(grant.evidence_requirements) && grant.evidence_requirements.length > 0, 'GRANT_FIELD', 'evidence requirements required');
  need(text(grant.policy_version), 'GRANT_FIELD', 'policy_version required');
  need(text(grant.schema_version), 'GRANT_FIELD', 'schema_version required');
  need(ROUTES.includes(grant.provider_route), 'PROVIDER_ROUTE', `provider_route must be one of ${ROUTES.join('|')}`);
  if (grant.hermes_candidate != null) {
    need(typeof grant.hermes_candidate === 'object', 'GRANT_FIELD', 'hermes_candidate must be an object when present');
    need(grant.hermes_candidate.evaluation_only === true, 'HERMES_NOT_EVALUATION_ONLY', 'a hermes candidate must be marked evaluation_only');
    need(grant.hermes_candidate.approved !== true, 'HERMES_UNAPPROVED_ONLY', 'no approved Hermes pin exists; an approved flag here is inconsistent with canonical state');
  }
  const expectedKey = idempotencyKey(grant);
  need(text(grant.idempotency_key), 'GRANT_FIELD', 'idempotency_key required');
  // Court 3 — tampering: any drift between stable fields and the key refuses.
  need(grant.idempotency_key === expectedKey, 'IDEMPOTENCY_MISMATCH', 'idempotency_key does not recompute from the stable grant fields — the grant was altered after issuance');
  return Object.freeze({ ...grant });
}

/**
 * [OS-CONTRACT: runtime/evidence.py] Append-only, hash-chained cycle store.
 * Each record binds seq, state, payload digest and the previous hash; the chain
 * recomputes from bytes alone, so mutation, deletion, reordering, or replay of
 * any record breaks verification (court 8).
 */
export class CycleStore {
  constructor(filePath) {
    this.filePath = filePath;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }

  records() {
    if (!fs.existsSync(this.filePath)) return [];
    const lines = fs.readFileSync(this.filePath, 'utf8').split('\n').filter((l) => l.trim() !== '');
    return lines.map((line) => JSON.parse(line));
  }

  verifyChain() {
    const records = this.records();
    let prev = 'GENESIS';
    for (const record of records) {
      const expected = sha(canonical({
        seq: record.seq, at: record.at, state: record.state,
        mission_id: record.mission_id, idem_key: record.idem_key,
        payload_digest: record.payload_digest, prev_hash: record.prev_hash,
      }));
      if (record.prev_hash !== prev || record.hash !== expected) {
        return { valid: false, at_seq: record.seq };
      }
      prev = record.hash;
    }
    return { valid: true, count: records.length };
  }

  append({ state, missionId, idemKey, payload }) {
    const verdict = this.verifyChain();
    if (!verdict.valid) {
      const quarantine = `${this.filePath}.quarantined.${Date.now()}`;
      fs.copyFileSync(this.filePath, quarantine);
      refuse('CHAIN_BROKEN', `receipt chain fails verification at seq ${verdict.at_seq}; cycle quarantined to ${quarantine}`);
    }
    const records = this.records();
    const prev = records.length === 0 ? 'GENESIS' : records[records.length - 1].hash;
    const record = {
      seq: records.length,
      at: new Date().toISOString(),
      state,
      mission_id: missionId,
      idem_key: idemKey,
      payload_digest: sha(canonical(payload ?? null)),
      prev_hash: prev,
    };
    record.hash = sha(canonical({
      seq: record.seq, at: record.at, state: record.state,
      mission_id: record.mission_id, idem_key: record.idem_key,
      payload_digest: record.payload_digest, prev_hash: record.prev_hash,
    }));
    fs.appendFileSync(this.filePath, `${JSON.stringify({ ...record, payload })}\n`);
    return record;
  }

  lastState() {
    const records = this.records();
    return records.length === 0 ? null : records[records.length - 1].state;
  }

  stateRecord(state) {
    return this.records().find((r) => r.state === state) ?? null;
  }
}

/** Standalone verifier — usable after the adapter is removed (court 14). */
export function verifyChainFile(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter((l) => l.trim() !== '');
  let prev = 'GENESIS';
  for (const [index, line] of lines.entries()) {
    const record = JSON.parse(line);
    const expected = createHash('sha256').update(JSON.stringify(sortKeys({
      seq: record.seq, at: record.at, state: record.state,
      mission_id: record.mission_id, idem_key: record.idem_key,
      payload_digest: record.payload_digest, prev_hash: record.prev_hash,
    }))).digest('hex');
    if (record.prev_hash !== prev || record.hash !== expected) return { valid: false, at: index };
    prev = record.hash;
  }
  return { valid: true, count: lines.length };
}

/**
 * [OS-CONTRACT: runtime/mission.py lease] One active lease per idempotency key,
 * acquired atomically (O_EXCL). A lost lock is never auto-stolen: resolution is
 * an explicit, logged operator action (spec: failure behavior).
 */
export class Lease {
  constructor(dir, idemKey) {
    this.path = path.join(dir, `lease.${idemKey.slice(0, 24)}`);
  }

  acquire() {
    fs.mkdirSync(path.dirname(this.path), { recursive: true });
    try {
      const fd = fs.openSync(this.path, 'wx');
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
      fs.closeSync(fd);
      return true;
    } catch (error) {
      if (error.code === 'EEXIST') return false;
      throw error;
    }
  }

  release() {
    try { fs.unlinkSync(this.path); } catch { /* already released */ }
  }
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

function withinAllowedPaths(touched, allowed) {
  return (touched ?? []).every((t) => allowed.some((a) => {
    const norm = path.posix.normalize(String(t));
    if (norm.startsWith('..') || path.posix.isAbsolute(norm)) return false;
    return norm === a || norm.startsWith(a.endsWith('/') ? a : `${a}/`);
  }));
}

/**
 * Run ONE governed cycle through the spec's state machine. `fixture` is the
 * bounded local executor: it receives the FROZEN sealed packet and must return
 * { succeeded, evidence[], failureReason?, observed_side_effects, touched_paths[],
 *   output, measurement? }. It cannot mutate policy, route, grant, or evidence
 * meaning (court 10): the adapter freezes its input, ignores every foreign key,
 * and recomputes all digests itself.
 */
export async function runCycle({
  grant: rawGrant, facts, fixture, storeDir, now = new Date(), repoHead, repoTree, intentSubjects,
}) {
  const grant = validateMissionGrant(rawGrant, { now, repoHead, repoTree });
  const idemKey = grant.idempotency_key;
  const store = new CycleStore(path.join(storeDir, `cycle.${idemKey.slice(0, 24)}.jsonl`));

  // Idempotent resume (courts 6 & 7): a CLOSED chain returns its result; a
  // partial chain resumes AFTER its last recorded state without re-appending.
  const chain = store.verifyChain();
  if (!chain.valid) refuse('CHAIN_BROKEN', `existing cycle store fails verification at seq ${chain.at_seq}`);
  if (store.lastState() === 'CLOSED') {
    return { resumed: true, final_state: 'CLOSED', store_path: store.filePath, records: store.records() };
  }
  const done = new Set(store.records().map((r) => r.state));
  const mark = (state, payload) => {
    if (done.has(state)) return store.stateRecord(state);
    return store.append({ state, missionId: grant.mission_id, idemKey, payload });
  };

  mark('GRANTED', { grant });

  const lease = new Lease(storeDir, idemKey);
  if (!done.has('LEASED')) {
    if (!lease.acquire()) refuse('LEASE_HELD', 'another worker holds the lease for this idempotency key');
    mark('LEASED', { pid: process.pid });
  }

  try {
    // COMPILED — deterministic context (court 2).
    const compiled = compile({ objective: grant.objective, facts, now });
    if (!compiled.valid) refuse('CONTEXT_INVALID', compiled.errors.join('; '));
    mark('COMPILED', { packet_digest: compiled.packet.packet_digest, counts: compiled.packet.counts });

    // PROPOSED — candidate + ChangeEvent through the canonical boundary.
    const event = makeChangeEvent({
      source: 'alive-loop-sensor',
      surface: grant.target,
      kind: 'STRUCTURAL',
      observedAt: now.toISOString(),
      observation: grant.objective,
      evidenceRef: store.filePath,
      confidence: 1,
    });
    const candidate = makeCandidate({
      event,
      brittlePoint: 'unverified assumption that the pinned tree satisfies the predeclared metric',
      hypothesis: `executing the bounded local fixture proves: ${grant.metric}`,
      improvement: 'the loop holds a receipt-backed answer instead of an assumption',
      falsificationTest: `fixture reports the metric false or courts fail at ${grant.cana_commit.slice(0, 12)}`,
      rollback: 'discard candidate; cycle store retains the full evidence chain',
      outcomeMetric: grant.metric,
      plane: 'LOCAL_VERIFICATION',
    });
    if (!candidate.valid) refuse('CANDIDATE_INVALID', candidate.errors.join('; '));
    mark('PROPOSED', { event_id: event.event_id, candidate_id: candidate.candidate_id });

    // SEALED — bind context to authority; capability comes from the grant.
    const capabilityGrant = makeGrant({
      capability: grant.capabilities[0],
      budgetUnits: Math.max(1, grant.max_attempts),
      expiresAt: grant.expires_at,
      issuedBy: `CANA mission ${grant.mission_id} v${grant.mission_version}`,
      now,
    });
    if (!capabilityGrant.valid) refuse('CAPABILITY_GRANT_INVALID', capabilityGrant.errors.join('; '));
    const sealed = sealPacket({
      contextPacket: compiled.packet,
      grant: capabilityGrant,
      intent: {
        description: grant.objective,
        successTest: grant.metric,
        rollback: 'discard candidate; the cycle store retains the full evidence chain',
        capability: grant.capabilities[0],
        subjects: intentSubjects ?? [grant.target],
      },
      now,
    });
    if (!sealed.valid) refuse('SEAL_REFUSED', sealed.errors.join('; '));
    mark('SEALED', { packet_digest: sealed.packet.packet_digest, capability: grant.capabilities[0], route: grant.provider_route });

    // EXECUTED_LOCAL — bounded fixture only; zero external effects; zero cost.
    const frozenPacket = deepFreeze(JSON.parse(JSON.stringify(sealed.packet)));
    const t0 = Date.now();
    const result = await fixture(frozenPacket);
    const runtimeMs = Date.now() - t0;
    if (runtimeMs > grant.max_runtime_ms) refuse('RUNTIME_EXCEEDED', `${runtimeMs}ms > ${grant.max_runtime_ms}ms`);
    if (!result || typeof result !== 'object') refuse('FIXTURE_INVALID', 'fixture must return an object');
    if (result.observed_side_effects !== 0) refuse('EXTERNAL_EFFECT', `observed_side_effects must be 0, got ${result.observed_side_effects}`);
    if (!withinAllowedPaths(result.touched_paths, grant.allowed_paths)) {
      refuse('PATH_ESCAPE', `fixture touched paths outside the grant allowlist: ${JSON.stringify(result.touched_paths)}`);
    }
    if (JSON.stringify(canonical(frozenPacket)) !== JSON.stringify(canonical(sealed.packet))) {
      refuse('PACKET_MUTATED', 'the sealed packet changed during execution');
    }
    const outputDigest = sha(canonical(result.output ?? null));
    mark('EXECUTED_LOCAL', {
      succeeded: result.succeeded === true,
      runtime_ms: runtimeMs,
      side_effects: 0,
      output_digest: outputDigest,
      bytes: Buffer.byteLength(JSON.stringify(result.output ?? '')),
    });

    // RECEIPTED — canonical execution receipt bound to packet + output digests.
    const receipt = makeReceipt({
      packet: sealed.packet,
      outcome: {
        succeeded: result.succeeded === true,
        evidence: result.evidence,
        failureReason: result.failureReason,
        budgetUsed: 1,
      },
      now,
    });
    if (!receipt.valid) refuse('RECEIPT_INVALID', receipt.errors.join('; '));
    mark('RECEIPTED', { receipt: receipt.receipt, output_digest: outputDigest });

    // MEASURED — observation with source and window, or explicitly UNKNOWN.
    const measurement = result.measurement && typeof result.measurement === 'object'
      ? { source: String(result.measurement.source ?? 'UNKNOWN'), window: String(result.measurement.window ?? 'UNKNOWN'), improved: result.measurement.improved === true, value: result.measurement.value ?? null, non_business: true }
      : { source: 'UNKNOWN', window: 'UNKNOWN', improved: false, value: null, non_business: true };
    mark('MEASURED', { measurement });

    // ADMITTED / REJECTED — the canonical Winner Memory gate decides.
    let staged = promote(candidate, { toStage: 'VALIDATED', evidence: { test_result: { receipt_digest: sha(canonical(receipt.receipt)) } } });
    if (staged.decision === 'ALLOWED') staged = promote(staged, { toStage: 'SHADOW', evidence: { shadow_observation: { output_digest: outputDigest, non_business: true } } });
    if (staged.decision === 'ALLOWED') staged = promote(staged, { toStage: 'CANARY', evidence: { exposure_record: { exposure: 'LOCAL_FIXTURE_ONLY', non_business: true } } });
    if (staged.decision === 'ALLOWED') staged = promote(staged, { toStage: 'PROMOTED', evidence: { outcome_measurement: measurement } });
    const lesson = toWinnerMemory(staged, measurement);
    if (lesson.stored) {
      mark('ADMITTED', { lesson });
    } else {
      mark('REJECTED', { reason: lesson.reason, denial_code: staged.denial_code ?? null });
    }

    mark('CLOSED', { final: lesson.stored ? 'ADMITTED' : 'REJECTED' });
    return {
      resumed: false,
      final_state: 'CLOSED',
      admitted: lesson.stored,
      lesson: lesson.stored ? lesson : null,
      rejection_reason: lesson.stored ? null : lesson.reason,
      store_path: store.filePath,
      chain: store.verifyChain(),
    };
  } finally {
    if (store.lastState() === 'CLOSED') lease.release();
  }
}

export const __dirnameOf = (metaUrl) => path.dirname(fileURLToPath(metaUrl));
