import fs from 'node:fs';
import path from 'node:path';
import { createHmac, randomBytes } from 'node:crypto';
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
const HEAD_SCHEMA = 'cana.mission-store-head/2.0.0';

function ensureInside(root, candidate) {
  const relative = path.relative(root, candidate);
  assertMission(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'STORE_PATH_ESCAPE', 'Store path escaped its root');
}

function pathExists(candidate) {
  try {
    fs.lstatSync(candidate);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function assertNotSymlink(candidate, code = 'STORE_SYMLINK_DENIED') {
  const stat = fs.lstatSync(candidate);
  assertMission(!stat.isSymbolicLink(), code, `Symlink denied: ${candidate}`);
  return stat;
}

function assertFileIdentity(descriptor, file, code) {
  const opened = fs.fstatSync(descriptor);
  const current = fs.statSync(file);
  assertMission(
    opened.isFile() && opened.dev === current.dev && opened.ino === current.ino,
    code,
    `Opened file identity differs from validated path: ${file}`,
  );
}

function readNoFollow(file, code) {
  assertNotSymlink(file, code);
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    assertFileIdentity(descriptor, file, code);
    return fs.readFileSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function atomicWrite(file, bytes) {
  const parent = path.dirname(file);
  assertMission(
    fs.realpathSync(parent) === parent,
    'STORE_SYMLINK_DENIED',
    `Atomic-write parent is not canonical: ${parent}`,
  );
  if (pathExists(file)) {
    const stat = assertNotSymlink(file);
    assertMission(stat.isFile(), 'STORE_FILE_TYPE_DENIED', `Expected a regular file: ${file}`);
  }
  const temp = `${file}.${process.pid}.${sha256(bytes).slice(0, 12)}.tmp`;
  const descriptor = fs.openSync(
    temp,
    fs.constants.O_WRONLY
      | fs.constants.O_CREAT
      | fs.constants.O_EXCL
      | (fs.constants.O_NOFOLLOW ?? 0),
    0o600,
  );
  try {
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(temp, file);
  const parentDescriptor = fs.openSync(parent, fs.constants.O_RDONLY);
  try {
    fs.fsyncSync(parentDescriptor);
  } catch (error) {
    if (error.code !== 'EINVAL') throw error;
  } finally {
    fs.closeSync(parentDescriptor);
  }
}

function headBody(eventCount, lastEventHash) {
  return {
    schema_version: HEAD_SCHEMA,
    event_count: eventCount,
    last_event_hash: lastEventHash,
  };
}

function sealedHead(eventCount, lastEventHash, anchorKey) {
  const body = headBody(eventCount, lastEventHash);
  return {
    ...body,
    head_hash: createHmac('sha256', anchorKey)
      .update(canonicalize(body))
      .digest('hex'),
  };
}

function createAnchorKey(file) {
  const descriptor = fs.openSync(
    file,
    fs.constants.O_WRONLY
      | fs.constants.O_CREAT
      | fs.constants.O_EXCL
      | (fs.constants.O_NOFOLLOW ?? 0),
    0o600,
  );
  try {
    fs.writeFileSync(descriptor, randomBytes(32));
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    if (error.code === 'EPERM') return true;
    throw error;
  }
}

function acquireAppendLock(file) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const descriptor = fs.openSync(
        file,
        fs.constants.O_WRONLY
          | fs.constants.O_CREAT
          | fs.constants.O_EXCL
          | (fs.constants.O_NOFOLLOW ?? 0),
        0o600,
      );
      const body = `${canonicalize({
        schema_version: 'cana.mission-store-lock/1.0.0',
        pid: process.pid,
        nonce: randomBytes(16).toString('hex'),
      })}\n`;
      fs.writeFileSync(descriptor, body);
      fs.fsyncSync(descriptor);
      return descriptor;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let lock;
      try {
        lock = JSON.parse(readNoFollow(file, 'STORE_LOCK_SYMLINK_DENIED').toString('utf8'));
      } catch (readError) {
        if (readError instanceof SyntaxError) {
          assertMission(false, 'STORE_LOCK_CORRUPT', 'Append lock is malformed');
        }
        throw readError;
      }
      assertMission(
        lock?.schema_version === 'cana.mission-store-lock/1.0.0'
          && Number.isInteger(lock.pid)
          && lock.pid > 0
          && /^[0-9a-f]{32}$/.test(lock.nonce ?? ''),
        'STORE_LOCK_CORRUPT',
        'Append lock is malformed',
      );
      assertMission(
        !processIsAlive(lock.pid),
        'STORE_LOCKED',
        'Another live process owns the mission-store append lock',
      );
      const before = assertNotSymlink(file, 'STORE_LOCK_SYMLINK_DENIED');
      const current = fs.lstatSync(file);
      assertMission(
        before.dev === current.dev && before.ino === current.ino,
        'STORE_LOCK_REPLACED',
        'Append lock changed during stale-lock recovery',
      );
      fs.unlinkSync(file);
    }
  }
  assertMission(false, 'STORE_LOCKED', 'Could not acquire mission-store append lock');
}

function releaseAppendLock(file, descriptor) {
  const opened = fs.fstatSync(descriptor);
  const current = fs.lstatSync(file);
  assertMission(
    opened.dev === current.dev && opened.ino === current.ino,
    'STORE_LOCK_REPLACED',
    'Append lock changed before release',
  );
  fs.closeSync(descriptor);
  fs.unlinkSync(file);
}

function projectEvents(events) {
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
      authorization_evidence_ref: null,
      authorization_receipt_hash: null,
      execution_receipt_hash: null,
      verifier_receipt_hash: null,
      verifier_verdict: null,
      verifier_identity: null,
      truth_record_hash: null,
      winner_memory_hash: null,
      rollback_receipt_hash: null,
      retry_not_before: null,
      resume_state: null,
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
    for (const field of [
      'lease',
      'authorization_evidence_ref',
      'authorization_receipt_hash',
      'execution_receipt_hash',
      'verifier_receipt_hash',
      'verifier_verdict',
      'verifier_identity',
      'truth_record_hash',
      'winner_memory_hash',
      'rollback_receipt_hash',
      'retry_not_before',
      'resume_state',
    ]) {
      if (Object.hasOwn(event.payload, field)) current[field] = event.payload[field];
    }
    missions.set(event.mission_id, current);
  }
  return {
    schema_version: 'cana.mission-store-projection/1.0.0',
    event_count: events.length,
    last_event_hash: events.at(-1)?.event_hash ?? GENESIS_HASH,
    missions: Object.fromEntries([...missions.entries()].sort(([a], [b]) => a.localeCompare(b))),
  };
}

export class MissionStore {
  constructor(root) {
    const requestedRoot = path.resolve(root);
    if (pathExists(requestedRoot)) {
      const stat = assertNotSymlink(requestedRoot, 'STORE_ROOT_SYMLINK_DENIED');
      assertMission(stat.isDirectory(), 'STORE_ROOT_TYPE_DENIED', 'Mission store root must be a directory');
    } else {
      fs.mkdirSync(requestedRoot, { recursive: true, mode: 0o700 });
    }
    this.root = fs.realpathSync(requestedRoot);
    this.eventsFile = path.join(this.root, 'events.jsonl');
    this.projectionFile = path.join(this.root, 'projection.json');
    this.headFile = path.join(this.root, 'head.json');
    this.anchorKeyFile = `${this.root}.head-key`;
    this.lockFile = path.join(this.root, 'append.lock');
    this.evidenceDirectory = path.join(this.root, 'evidence');
    if (pathExists(this.evidenceDirectory)) {
      const stat = assertNotSymlink(this.evidenceDirectory, 'EVIDENCE_SYMLINK_DENIED');
      assertMission(stat.isDirectory(), 'EVIDENCE_PATH_TYPE_DENIED', 'Evidence path must be a directory');
      assertMission(
        fs.realpathSync(this.evidenceDirectory) === this.evidenceDirectory,
        'EVIDENCE_SYMLINK_DENIED',
        'Evidence directory must be canonical',
      );
    } else {
      fs.mkdirSync(this.evidenceDirectory, { mode: 0o700 });
    }
    if (!pathExists(this.eventsFile)) {
      const descriptor = fs.openSync(
        this.eventsFile,
        fs.constants.O_WRONLY
          | fs.constants.O_CREAT
          | fs.constants.O_EXCL
          | (fs.constants.O_NOFOLLOW ?? 0),
        0o600,
      );
      fs.closeSync(descriptor);
    } else {
      const stat = assertNotSymlink(this.eventsFile);
      assertMission(stat.isFile(), 'STORE_FILE_TYPE_DENIED', 'Event log must be a regular file');
    }
    if (!pathExists(this.headFile)) {
      assertMission(
        fs.statSync(this.eventsFile).size === 0,
        'HEAD_ANCHOR_MISSING',
        'A non-empty event log requires its independent head anchor',
      );
    } else {
      const stat = assertNotSymlink(this.headFile);
      assertMission(stat.isFile(), 'STORE_FILE_TYPE_DENIED', 'Head anchor must be a regular file');
    }
    if (pathExists(this.projectionFile)) {
      const stat = assertNotSymlink(this.projectionFile);
      assertMission(stat.isFile(), 'STORE_FILE_TYPE_DENIED', 'Projection must be a regular file');
    }
    const durableStateExists = fs.statSync(this.eventsFile).size > 0
      || pathExists(this.headFile)
      || pathExists(this.projectionFile);
    if (!pathExists(this.anchorKeyFile)) {
      assertMission(
        !durableStateExists,
        'HEAD_ANCHOR_KEY_MISSING',
        'Existing durable state requires its external head-anchor key',
      );
      createAnchorKey(this.anchorKeyFile);
    }
    const keyStat = assertNotSymlink(this.anchorKeyFile, 'HEAD_ANCHOR_KEY_SYMLINK_DENIED');
    assertMission(
      keyStat.isFile() && (keyStat.mode & 0o077) === 0,
      'HEAD_ANCHOR_KEY_INVALID',
      'Head-anchor key must be a private regular file',
    );
    this.anchorKey = readNoFollow(
      this.anchorKeyFile,
      'HEAD_ANCHOR_KEY_SYMLINK_DENIED',
    );
    assertMission(
      this.anchorKey.length === 32,
      'HEAD_ANCHOR_KEY_INVALID',
      'Head-anchor key must contain exactly 32 bytes',
    );
    if (!pathExists(this.headFile)) {
      atomicWrite(
        this.headFile,
        `${canonicalize(sealedHead(0, GENESIS_HASH, this.anchorKey))}\n`,
      );
    }
  }

  readEvents() {
    const content = readNoFollow(this.eventsFile, 'EVENT_LOG_SYMLINK_DENIED').toString('utf8');
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

  readHead() {
    let head;
    try {
      head = JSON.parse(readNoFollow(this.headFile, 'HEAD_ANCHOR_SYMLINK_DENIED').toString('utf8'));
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`CORRUPT_HEAD_JSON: ${error.message}`);
      }
      throw error;
    }
    const { head_hash: claimed, ...body } = head;
    const expectedMac = createHmac('sha256', this.anchorKey)
      .update(canonicalize(body))
      .digest('hex');
    assertMission(
      JSON.stringify(Object.keys(head).sort())
        === JSON.stringify(['event_count', 'head_hash', 'last_event_hash', 'schema_version'])
      && head.schema_version === HEAD_SCHEMA
        && Number.isInteger(head.event_count)
        && head.event_count >= 0
        && /^[0-9a-f]{64}$/.test(head.last_event_hash ?? '')
        && constantTimeEqual(claimed, expectedMac),
      'HEAD_ANCHOR_CORRUPT',
      'Durable head anchor is malformed or tampered',
    );
    return head;
  }

  reconstruct({ repair = true } = {}) {
    const events = this.readEvents();
    const projection = projectEvents(events);
    const head = this.readHead();
    assertMission(
      head.event_count <= projection.event_count,
      'EVENT_DELETION_DETECTED',
      'Durable event log is shorter than the independent head anchor',
    );
    const headPrefixHash = head.event_count === 0
      ? GENESIS_HASH
      : events[head.event_count - 1]?.event_hash;
    assertMission(
      head.last_event_hash === headPrefixHash,
      'EVENT_HISTORY_DIVERGED',
      'Durable event log diverges from the independent head anchor',
    );
    if (head.event_count < projection.event_count && repair) {
      atomicWrite(
        this.headFile,
        `${canonicalize(sealedHead(
          projection.event_count,
          projection.last_event_hash,
          this.anchorKey,
        ))}\n`,
      );
    }

    let projectionNeedsRepair = !pathExists(this.projectionFile);
    if (!projectionNeedsRepair) {
      let checkpoint;
      try {
        checkpoint = JSON.parse(readNoFollow(this.projectionFile, 'PROJECTION_SYMLINK_DENIED').toString('utf8'));
      } catch (error) {
        if (error instanceof SyntaxError) {
          throw new Error(`CORRUPT_PROJECTION_JSON: ${error.message}`);
        }
        throw error;
      }
      assertMission(
        Number.isInteger(checkpoint.event_count)
          && checkpoint.event_count >= 0
          && checkpoint.event_count <= projection.event_count,
        'EVENT_DELETION_DETECTED',
        'Projection claims events absent from the durable event log',
      );
      const expectedCheckpoint = projectEvents(events.slice(0, checkpoint.event_count));
      assertMission(
        constantTimeEqual(hashCanonical(checkpoint), hashCanonical(expectedCheckpoint)),
        'PROJECTION_CORRUPT',
        'Projection does not reconstruct from its event prefix',
      );
      projectionNeedsRepair = checkpoint.event_count < projection.event_count;
    }
    if (projectionNeedsRepair && repair) {
      atomicWrite(this.projectionFile, `${canonicalize(projection)}\n`);
    }
    return deepFreeze(projection);
  }

  append({ missionId, tenantId, workspaceId, lifecycleState, actor, occurredAt, expectedVersion, payload = {} }) {
    requireText(missionId, 'missionId');
    requireText(tenantId, 'tenantId');
    requireText(workspaceId, 'workspaceId');
    requireText(actor, 'actor');
    const lock = acquireAppendLock(this.lockFile);
    try {
      const projection = this.reconstruct();
      const current = projection.missions[missionId] ?? null;
      assertMission((current?.version ?? 0) === expectedVersion, 'STALE_STATE', `Expected version ${expectedVersion}`, {
        actual: current?.version ?? 0,
      });
      assertMission(!current || current.tenant_id === tenantId, 'CROSS_TENANT_DENIED', 'Mission tenant cannot change');
      assertMission(!current || current.workspace_id === workspaceId, 'CROSS_WORKSPACE_DENIED', 'Mission workspace cannot change');
      assertMission(
        current || lifecycleState === 'SIGNAL_OBSERVED',
        'INVALID_INITIAL_STATE',
        'A mission event chain must begin with SIGNAL_OBSERVED',
      );
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
      const descriptor = fs.openSync(
        this.eventsFile,
        fs.constants.O_WRONLY
          | fs.constants.O_APPEND
          | (fs.constants.O_NOFOLLOW ?? 0),
        0o600,
      );
      try {
        assertFileIdentity(descriptor, this.eventsFile, 'EVENT_LOG_REPLACED');
        fs.writeSync(descriptor, `${canonicalize(event)}\n`);
        fs.fsyncSync(descriptor);
      } finally {
        fs.closeSync(descriptor);
      }
      const updatedProjection = this.reconstruct({ repair: false });
      atomicWrite(
        this.headFile,
        `${canonicalize(sealedHead(
          updatedProjection.event_count,
          updatedProjection.last_event_hash,
          this.anchorKey,
        ))}\n`,
      );
      atomicWrite(this.projectionFile, `${canonicalize(updatedProjection)}\n`);
      return deepFreeze(event);
    } finally {
      releaseAppendLock(this.lockFile, lock);
    }
  }

  writeEvidence(value) {
    assertMission(
      fs.realpathSync(this.evidenceDirectory) === this.evidenceDirectory
        && !fs.lstatSync(this.evidenceDirectory).isSymbolicLink(),
      'EVIDENCE_SYMLINK_DENIED',
      'Evidence directory was replaced by a symlink',
    );
    const bytes = Buffer.from(canonicalize(value));
    const digest = sha256(bytes);
    const file = path.join(this.evidenceDirectory, `${digest}.json`);
    ensureInside(this.root, file);
    try {
      const descriptor = fs.openSync(
        file,
        fs.constants.O_WRONLY
          | fs.constants.O_CREAT
          | fs.constants.O_EXCL
          | (fs.constants.O_NOFOLLOW ?? 0),
        0o600,
      );
      try {
        fs.writeFileSync(descriptor, bytes);
        fs.fsyncSync(descriptor);
      } finally {
        fs.closeSync(descriptor);
      }
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      assertMission(
        readNoFollow(file, 'EVIDENCE_SYMLINK_DENIED').equals(bytes),
        'EVIDENCE_COLLISION',
        'Existing evidence bytes do not match content address',
      );
    }
    return deepFreeze({ ref: `sha256:${digest}`, sha256: digest, bytes: bytes.length });
  }

  readEvidence(reference) {
    assertMission(/^sha256:[0-9a-f]{64}$/.test(reference), 'INVALID_EVIDENCE_REFERENCE', 'Evidence reference must be content addressed');
    const digest = reference.slice('sha256:'.length);
    const file = path.join(this.evidenceDirectory, `${digest}.json`);
    ensureInside(this.root, file);
    assertMission(
      fs.realpathSync(this.evidenceDirectory) === this.evidenceDirectory
        && !fs.lstatSync(this.evidenceDirectory).isSymbolicLink(),
      'EVIDENCE_SYMLINK_DENIED',
      'Evidence directory was replaced by a symlink',
    );
    const bytes = readNoFollow(file, 'EVIDENCE_SYMLINK_DENIED');
    assertMission(sha256(bytes) === digest, 'EVIDENCE_TAMPERED', 'Evidence content hash mismatch');
    return JSON.parse(bytes);
  }
}
