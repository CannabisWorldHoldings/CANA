// tools/authority/lease-reclaim.mjs — PHASE E2: lease TTL reclaim with explicit state transitions.
//
// The archaeology's Court-09 caveat, unfixed in all three prototypes: "Mission-2 leases expire and
// nothing reclaims them; the alive-loop lock deadlocks." Mission-2's Ed25519 lease (tools/mission-2/
// lease.mjs) proves EXPIRY-refusal but has no RECLAIM: a crashed holder's mission stays locked
// forever, and there is no explicit ACTIVE -> EXPIRED -> RECLAIMED lifecycle.
//
// This adds a durable lease-holder registry (one row per mission) with those exact transitions:
//   ACTIVE     — a holder owns the mission; heartbeats keep it fresh.
//   EXPIRED    — now() > lease_expires_at and not yet reclaimed (derived state).
//   RECLAIMED  — after TTL, a NEW holder atomically takes over; the reclaim bumps an epoch.
// Guarantees proven by the courts:
//   (a) crash-then-reclaim WORKS — a crashed holder's mission is reclaimable after its TTL.
//   (b) stale-holder-post-reclaim is REFUSED — the crashed holder's epoch is stale; its heartbeat /
//       release is rejected once a new holder has reclaimed, so it can never revive.
//
// Atomicity: the registry is a single JSON file guarded by an O_EXCL lockfile (same discipline as
// containment.mjs) so acquire/reclaim/heartbeat are serialized — two workers cannot both reclaim.

import {
  readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, openSync, closeSync, unlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { AuthorityError } from './canon.mjs';

export const LEASE_STATES = Object.freeze(['ACTIVE', 'EXPIRED', 'RECLAIMED']);

export class LeaseRegistry {
  constructor(dir) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
    this.path = join(dir, 'leases.json');
    this.lockPath = join(dir, 'leases.lock');
    if (!existsSync(this.path)) this._writeAtomic({});
  }

  _read() { try { return JSON.parse(readFileSync(this.path, 'utf8')); } catch { return {}; } }
  _writeAtomic(state) {
    const tmp = `${this.path}.tmp.${process.pid}.${Math.random().toString(36).slice(2)}`;
    writeFileSync(tmp, JSON.stringify(state));
    renameSync(tmp, this.path);
  }

  _withLock(fn) {
    const deadline = Date.now() + 8000;
    let fd = null;
    for (;;) {
      try { fd = openSync(this.lockPath, 'wx'); break; }
      catch (e) {
        if (e.code !== 'EEXIST') throw e;
        if (Date.now() > deadline) throw new AuthorityError('LEASE_LOCK_TIMEOUT', 'could not acquire lease lock');
        const spin = Date.now() + 2; while (Date.now() < spin) { /* noop */ }
      }
    }
    try { return fn(); }
    finally { try { closeSync(fd); } catch { /* */ } try { unlinkSync(this.lockPath); } catch { /* */ } }
  }

  // Derived lifecycle state for a mission at time `now`.
  status(missionId, now) {
    const row = this._read()[missionId];
    if (!row) return { state: null };
    const t = new Date(now).getTime();
    const expired = t > new Date(row.lease_expires_at).getTime();
    return {
      state: expired ? 'EXPIRED' : 'ACTIVE',
      holder: row.holder,
      epoch: row.epoch,
      lease_expires_at: row.lease_expires_at,
    };
  }

  // Acquire a lease for a mission. Succeeds if it is unheld, or held-but-EXPIRED (which RECLAIMS it
  // for the new holder and bumps the epoch). A live ACTIVE holder blocks acquisition.
  acquire({ missionId, holder, now, ttlMs }) {
    return this._withLock(() => {
      const state = this._read();
      const row = state[missionId];
      const t = new Date(now).getTime();
      if (row) {
        const expired = t > new Date(row.lease_expires_at).getTime();
        if (!expired) {
          throw new AuthorityError('LEASE_HELD', `mission ${missionId} is held by ${row.holder} until ${row.lease_expires_at}`);
        }
        // RECLAIM: expired holder is displaced; epoch advances so the stale holder is fenced off.
        const epoch = row.epoch + 1;
        state[missionId] = {
          holder, epoch,
          lease_started_at: new Date(now).toISOString(),
          lease_expires_at: new Date(t + ttlMs).toISOString(),
          last_heartbeat_at: new Date(now).toISOString(),
          reclaimed_from: row.holder,
          transitions: [...(row.transitions ?? []), { at: new Date(now).toISOString(), from: 'EXPIRED', to: 'RECLAIMED', by: holder, epoch }],
        };
        this._writeAtomic(state);
        return { acquired: true, reclaimed: true, epoch };
      }
      const epoch = 1;
      state[missionId] = {
        holder, epoch,
        lease_started_at: new Date(now).toISOString(),
        lease_expires_at: new Date(t + ttlMs).toISOString(),
        last_heartbeat_at: new Date(now).toISOString(),
        reclaimed_from: null,
        transitions: [{ at: new Date(now).toISOString(), from: null, to: 'ACTIVE', by: holder, epoch }],
      };
      this._writeAtomic(state);
      return { acquired: true, reclaimed: false, epoch };
    });
  }

  // A holder must present its epoch. A stale holder (older epoch than the current row) is FENCED:
  // its heartbeat/release is refused once someone else has reclaimed the mission.
  _assertCurrentHolder(state, missionId, holder, epoch) {
    const row = state[missionId];
    if (!row) throw new AuthorityError('LEASE_UNKNOWN', missionId);
    if (row.holder !== holder || row.epoch !== epoch) {
      throw new AuthorityError('LEASE_STALE_HOLDER',
        `holder ${holder}@epoch${epoch} was fenced; current is ${row.holder}@epoch${row.epoch}`);
    }
    return row;
  }

  heartbeat({ missionId, holder, epoch, now, ttlMs }) {
    return this._withLock(() => {
      const state = this._read();
      const row = this._assertCurrentHolder(state, missionId, holder, epoch);
      const t = new Date(now).getTime();
      if (t > new Date(row.lease_expires_at).getTime()) {
        throw new AuthorityError('LEASE_EXPIRED', `cannot heartbeat an expired lease for ${missionId}`);
      }
      row.last_heartbeat_at = new Date(now).toISOString();
      if (ttlMs) row.lease_expires_at = new Date(t + ttlMs).toISOString();
      this._writeAtomic(state);
      return { ok: true };
    });
  }

  release({ missionId, holder, epoch }) {
    return this._withLock(() => {
      const state = this._read();
      this._assertCurrentHolder(state, missionId, holder, epoch);
      delete state[missionId];
      this._writeAtomic(state);
      return { ok: true };
    });
  }
}
