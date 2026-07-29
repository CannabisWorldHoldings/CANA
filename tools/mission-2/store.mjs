import fs from 'node:fs';
import path from 'node:path';
import {
  assertMission,
  canonicalize,
  clone,
  constantTimeEqual,
  deepFreeze,
  hashCanonical,
  requireText,
  sha256,
} from './canonical.mjs';
import { assertTransition } from './contracts.mjs';

const GENESIS_HASH = '0'.repeat(64);

function ensureInside(root, candidate) {
  const relative = path.relative(root, candidate);
  assertMission(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'STORE_PATH_ESCAPE', 'Store path escaped its root');
}

function atomicWrite(file, bytes) {
  const temp = `${file}.${process.pid}.${sha256(bytes).slice(0, 12)}.tmp`;
  const descriptor = fs.openSync(temp, 'wx', 0o600);
  try {
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(temp, file);
}

export class MissionStore {
  constructor(root) {
    this.root = path.resolve(root);
    this.eventsFile = path.join(this.root, 'events.jsonl');
    this.projectionFile = path.join(this.root, 'projection.json');
    this.lockFile = path.join(this.root, 'append.lock');
    this.evidenceDirectory = path.join(this.root, 'evidence');
    fs.mkdirSync(this.evidenceDirectory, { recursive: true, mode: 0o700 });
    if (!fs.existsSync(this.eventsFile)) {
      const descriptor = fs.openSync(this.eventsFile, 'wx', 0o600);
      fs.closeSync(descriptor);
    }
  }

  readEvents() {
    const content = fs.readFileSync(this.eventsFile, 'utf8');
    const events = content.split('\n').filter(Boolean).map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`CORRUPT_EVENT_JSON at line ${index + 1}: ${error.message}`);
      }
    });
    let previousHash = GENESIS_HASH;
    let sequence = 0;
    for (const event of events) {
      sequence += 1;
      assertMission(event.sequence === sequence, 'EVENT_SEQUENCE_CORRUPT', `Expected sequence ${sequence}`);
      assertMission(event.previous_hash === previousHash, 'EVENT_CHAIN_CORRUPT', `Previous hash mismatch at ${sequence}`);
      const { event_hash: claimed, ...body } = event;
      const recomputed = hashCanonical(body);
      assertMission(constantTimeEqual(claimed, recomputed), 'EVENT_HASH_CORRUPT', `Event hash mismatch at ${sequence}`);
      previousHash = claimed;
    }
    return events;
  }

  reconstruct({ verifyCheckpoint = true } = {}) {
    const events = this.readEvents();
    const missions = new Map();
    for (const event of events) {
      const current = missions.get(event.mission_id) ?? {
        mission_id: event.mission_id,
        version: 0,
        current_lifecycle_state: null,
        events: [],
        latest_checkpoint: null,
        execution_attempts: [],
        evidence_references: [],
        failure_history: [],
        promotion_status: 'NOT_EVALUATED',
        next_eligible_action: 'OBSERVE_SIGNAL',
        lease: null,
      };
      assertMission(event.mission_version === current.version + 1, 'MISSION_VERSION_CORRUPT', 'Mission version is not monotonic');
      if (current.current_lifecycle_state && event.lifecycle_state !== current.current_lifecycle_state) {
        assertTransition(current.current_lifecycle_state, event.lifecycle_state);
      }
      current.version = event.mission_version;
      current.current_lifecycle_state = event.lifecycle_state;
      current.tenant_id = current.tenant_id ?? event.tenant_id;
      current.workspace_id = current.workspace_id ?? event.workspace_id;
      current.events.push(event.event_hash);
      current.latest_checkpoint = event.payload.checkpoint ?? current.latest_checkpoint;
      if (event.payload.attempt) current.execution_attempts.push(event.payload.attempt);
      if (event.payload.evidence_ref) current.evidence_references.push(event.payload.evidence_ref);
      if (event.payload.failure) current.failure_history.push(event.payload.failure);
      if (event.payload.promotion_status) current.promotion_status = event.payload.promotion_status;
      if (event.payload.next_eligible_action) current.next_eligible_action = event.payload.next_eligible_action;
      if (Object.hasOwn(event.payload, 'lease')) current.lease = event.payload.lease;
      missions.set(event.mission_id, current);
    }
    const projection = {
      schema_version: 'cana.mission-store-projection/1.0.0',
      event_count: events.length,
      last_event_hash: events.at(-1)?.event_hash ?? GENESIS_HASH,
      missions: Object.fromEntries([...missions.entries()].sort(([a], [b]) => a.localeCompare(b))),
    };
    if (verifyCheckpoint && fs.existsSync(this.projectionFile)) {
      const checkpoint = JSON.parse(fs.readFileSync(this.projectionFile, 'utf8'));
      assertMission(checkpoint.event_count === projection.event_count, 'EVENT_DELETION_DETECTED', 'Durable event count differs from the last committed projection');
      assertMission(checkpoint.last_event_hash === projection.last_event_hash, 'EVENT_HISTORY_DIVERGED', 'Durable event hash differs from the last committed projection');
    }
    return deepFreeze(projection);
  }

  append({ missionId, tenantId, workspaceId, lifecycleState, actor, occurredAt, expectedVersion, payload = {} }) {
    requireText(missionId, 'missionId');
    requireText(tenantId, 'tenantId');
    requireText(workspaceId, 'workspaceId');
    requireText(actor, 'actor');
    const lock = fs.openSync(this.lockFile, 'wx', 0o600);
    try {
      const projection = this.reconstruct();
      const current = projection.missions[missionId] ?? null;
      assertMission((current?.version ?? 0) === expectedVersion, 'STALE_STATE', `Expected version ${expectedVersion}`, {
        actual: current?.version ?? 0,
      });
      assertMission(!current || current.tenant_id === tenantId, 'CROSS_TENANT_DENIED', 'Mission tenant cannot change');
      assertMission(!current || current.workspace_id === workspaceId, 'CROSS_WORKSPACE_DENIED', 'Mission workspace cannot change');
      if (current && current.current_lifecycle_state !== lifecycleState) {
        assertTransition(current.current_lifecycle_state, lifecycleState);
      }
      const events = this.readEvents();
      const body = {
        schema_version: 'cana.mission-event/1.0.0',
        sequence: events.length + 1,
        previous_hash: events.at(-1)?.event_hash ?? GENESIS_HASH,
        mission_id: missionId,
        mission_version: expectedVersion + 1,
        tenant_id: tenantId,
        workspace_id: workspaceId,
        lifecycle_state: lifecycleState,
        actor,
        occurred_at: occurredAt,
        payload: clone(payload),
      };
      const event = { ...body, event_hash: hashCanonical(body) };
      const descriptor = fs.openSync(this.eventsFile, 'a', 0o600);
      try {
        fs.writeSync(descriptor, `${canonicalize(event)}\n`);
        fs.fsyncSync(descriptor);
      } finally {
        fs.closeSync(descriptor);
      }
      atomicWrite(this.projectionFile, `${canonicalize(this.reconstruct({ verifyCheckpoint: false }))}\n`);
      return deepFreeze(event);
    } finally {
      fs.closeSync(lock);
      fs.unlinkSync(this.lockFile);
    }
  }

  writeEvidence(value) {
    const bytes = Buffer.from(canonicalize(value));
    const digest = sha256(bytes);
    const file = path.join(this.evidenceDirectory, `${digest}.json`);
    ensureInside(this.root, file);
    try {
      const descriptor = fs.openSync(file, 'wx', 0o600);
      try {
        fs.writeFileSync(descriptor, bytes);
        fs.fsyncSync(descriptor);
      } finally {
        fs.closeSync(descriptor);
      }
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      assertMission(fs.readFileSync(file).equals(bytes), 'EVIDENCE_COLLISION', 'Existing evidence bytes do not match content address');
    }
    return deepFreeze({ ref: `sha256:${digest}`, sha256: digest, bytes: bytes.length });
  }

  readEvidence(reference) {
    assertMission(/^sha256:[0-9a-f]{64}$/.test(reference), 'INVALID_EVIDENCE_REFERENCE', 'Evidence reference must be content addressed');
    const digest = reference.slice('sha256:'.length);
    const file = path.join(this.evidenceDirectory, `${digest}.json`);
    ensureInside(this.root, file);
    const bytes = fs.readFileSync(file);
    assertMission(sha256(bytes) === digest, 'EVIDENCE_TAMPERED', 'Evidence content hash mismatch');
    return JSON.parse(bytes);
  }
}
