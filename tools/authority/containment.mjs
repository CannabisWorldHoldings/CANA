// tools/authority/containment.mjs — NATIVE NODE PORT of governor-kernel containment semantics.
//
// PHASE E1: the security-relevant containment genes ported to native Node inside tools/authority/,
// so the single seat does NOT shell out to Python. Source of truth (verbatim provenance):
//   packages/governor-kernel/standalone/runtime/rsi.py
//     _action_ok             rsi.py:60
//     _resource_ok           rsi.py:61-64
//     _covers                rsi.py:65-69
//     capability ⊆ auth      rsi.py:230-239   (actions subset, resources covered, budgets/depth ≤)
//     identity/tenant/site   rsi.py:240-244
//     action+resource gate   rsi.py:245-249
//     consequential rollback rsi.py:253-257
//     idempotency replay      rsi.py:258-262
//     atomic budget reserve  rsi.py:263-273   (SUM(reserved) inside BEGIN IMMEDIATE)
//     revocation             rsi.py:191-192, :212, :224
//
// The Python original enforces the transaction with SQLite BEGIN IMMEDIATE (rsi.py:196). Node has no
// ambient DB; this port keeps state in a single JSON file guarded by an in-process mutex AND a
// cross-process advisory lock (O_EXCL lockfile), and performs read→check→write as one critical
// section, so the reservation SUM-check is atomic against concurrent authorize() calls the same way
// BEGIN IMMEDIATE serializes them. Verdicts (accept + refusal CODE) are identical to the Python
// engine — proven by tools/authority/gk-compat.test.mjs.

import {
  readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, openSync, closeSync, unlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { AuthorityError } from './canon.mjs';

// ── matchers (ported verbatim from rsi.py:60-69) ──
export function actionOk(a, allowed) {
  return allowed.includes('*') || allowed.includes(a);
}
export function resourceOk(r, allowed) {
  for (const p of allowed) {
    if (p === '*' || p === r || (p.endsWith('*') && r.startsWith(p.slice(0, -1)))) return true;
  }
  return false;
}
// rsi.py:65-69 — does the parent's pattern set COVER a child pattern?
export function covers(parentPatterns, childPattern) {
  for (const p of parentPatterns) {
    if (p === '*' || p === childPattern) return true;
    if (p.endsWith('*') && childPattern.startsWith(p.slice(0, -1))) return true;
  }
  return false;
}

// A tiny durable store mirroring the rsi.py tables we actually use for a containment decision:
// authorizations, worker_capabilities, revocations, budgets, budget_reservations, idempotency.
export class ContainmentStore {
  constructor(dir) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
    this.path = join(dir, 'containment.json');
    this.lockPath = join(dir, 'containment.lock');
    if (!existsSync(this.path)) this._writeAtomic(this._empty());
  }

  _empty() {
    return {
      authorizations: {}, capabilities: {}, revocations: [],
      budgets: {}, reservations: [], idempotency: {},
    };
  }

  _read() {
    try { return JSON.parse(readFileSync(this.path, 'utf8')); }
    catch { return this._empty(); }
  }

  _writeAtomic(state) {
    const tmp = `${this.path}.tmp.${process.pid}.${Math.random().toString(36).slice(2)}`;
    writeFileSync(tmp, JSON.stringify(state));
    renameSync(tmp, this.path); // atomic replace on POSIX
  }

  // Cross-process critical section: spin on an O_EXCL lockfile. This is the Node stand-in for
  // SQLite's BEGIN IMMEDIATE — only one authorize() mutates budgets/idempotency at a time.
  _withLock(fn) {
    const deadline = Date.now() + 8000;
    let fd = null;
    for (;;) {
      try { fd = openSync(this.lockPath, 'wx'); break; }
      catch (e) {
        if (e.code !== 'EEXIST') throw e;
        if (Date.now() > deadline) throw new AuthorityError('CONTAINMENT_LOCK_TIMEOUT', 'could not acquire containment lock');
        // busy-wait a hair; contention windows here are microscopic
        const spin = Date.now() + 2; while (Date.now() < spin) { /* noop */ }
      }
    }
    try { return fn(); }
    finally { try { closeSync(fd); } catch { /* */ } try { unlinkSync(this.lockPath); } catch { /* */ } }
  }

  // ── issuance (mirrors rsi.issue_authorization / issue_capability, minus SQL) ──
  issueAuthorization(auth) {
    return this._withLock(() => {
      const state = this._read();
      state.authorizations[auth.id] = { ...auth, revoked: false };
      this._writeAtomic(state);
      return auth.id;
    });
  }

  issueCapability(cap) {
    return this._withLock(() => {
      const state = this._read();
      state.capabilities[cap.id] = { ...cap, revoked: false };
      this._writeAtomic(state);
      return cap.id;
    });
  }

  setBudget(name, limit) {
    return this._withLock(() => {
      const state = this._read();
      state.budgets[name] = { used: 0, limit_: limit };
      this._writeAtomic(state);
    });
  }

  revoke(targetType, targetId, reason = '') {
    return this._withLock(() => {
      const state = this._read();
      state.revocations.push({ target_type: targetType, target_id: targetId, reason });
      if (targetType === 'authorization' && state.authorizations[targetId]) state.authorizations[targetId].revoked = true;
      if (targetType === 'capability' && state.capabilities[targetId]) state.capabilities[targetId].revoked = true;
      this._writeAtomic(state);
    });
  }

  reservedTotal(name) {
    const state = this._read();
    return state.reservations
      .filter((r) => r.name === name && r.state === 'reserved')
      .reduce((s, r) => s + r.amount, 0);
  }

  _isRevoked(state, type, id) {
    return state.revocations.some((r) => r.target_type === type && r.target_id === id);
  }

  // ── the decision (ported from RSIGovernor.authorize_and_reserve, rsi.py:194-281) ──
  // Returns { reservationIds } on accept; throws AuthorityError(code) on refuse — identical CODES.
  authorizeAndReserve(c, { now }) {
    return this._withLock(() => {
      const state = this._read();

      // authorization
      if (!c.authorization_id) throw new AuthorityError('UNKNOWN_AUTHORIZATION', 'missing authorization_id', 'CONTAINMENT');
      const auth = state.authorizations[c.authorization_id];
      if (!auth) throw new AuthorityError('UNKNOWN_AUTHORIZATION', c.authorization_id, 'CONTAINMENT');
      if (auth.revoked || this._isRevoked(state, 'authorization', auth.id)) {
        throw new AuthorityError('AUTHORIZATION_REVOKED', auth.id, 'CONTAINMENT');
      }
      if (auth.not_before && now < auth.not_before) throw new AuthorityError('AUTHORIZATION_NOT_YET_VALID', auth.not_before, 'CONTAINMENT');
      if (auth.expires_at && now > auth.expires_at) throw new AuthorityError('AUTHORIZATION_EXPIRED', auth.expires_at, 'CONTAINMENT');

      // capability
      if (!c.worker_capability_id) throw new AuthorityError('UNKNOWN_CAPABILITY', 'missing worker_capability_id', 'CONTAINMENT');
      const cap = state.capabilities[c.worker_capability_id];
      if (!cap) throw new AuthorityError('UNKNOWN_CAPABILITY', c.worker_capability_id, 'CONTAINMENT');
      if (cap.revoked || this._isRevoked(state, 'capability', cap.id)) {
        throw new AuthorityError('CAPABILITY_REVOKED', cap.id, 'CONTAINMENT');
      }
      if (cap.authorization_id !== auth.id) throw new AuthorityError('CAPABILITY_BINDING', 'capability not bound to authorization', 'CONTAINMENT');
      if (cap.expires_at && now > cap.expires_at) throw new AuthorityError('CAPABILITY_EXPIRED', cap.expires_at, 'CONTAINMENT');

      // capability constraints ⊆ authorization (rsi.py:230-239)
      const aa = auth.allowed_actions; const ar = auth.allowed_resources;
      const ca = cap.allowed_actions; const cr = cap.allowed_resources;
      if (!aa.includes('*') && !ca.every((x) => aa.includes(x))) {
        throw new AuthorityError('CAPABILITY_EXCEEDS_AUTHORIZATION', 'actions exceed authorization', 'CONTAINMENT');
      }
      if (!ar.includes('*') && !cr.every((p) => covers(ar, p))) {
        throw new AuthorityError('CAPABILITY_EXCEEDS_AUTHORIZATION', 'resources exceed authorization', 'CONTAINMENT');
      }
      if (cap.call_budget > auth.call_budget || cap.runtime_budget > auth.runtime_budget
          || cap.delegation_depth > auth.delegation_depth) {
        throw new AuthorityError('CAPABILITY_EXCEEDS_AUTHORIZATION', 'budgets/depth exceed authorization', 'CONTAINMENT');
      }

      // identity / tenant / site (rsi.py:240-244)
      if (c.actor_id && c.actor_id !== auth.actor_id) throw new AuthorityError('IDENTITY_MISMATCH', 'actor', 'CONTAINMENT');
      if (c.tenant_id && c.tenant_id !== auth.tenant_id) throw new AuthorityError('CROSS_TENANT', c.tenant_id, 'CONTAINMENT');
      if (c.site_id && c.site_id !== auth.site_id) throw new AuthorityError('CROSS_SITE', c.site_id, 'CONTAINMENT');
      if (c.worker_id && c.worker_id !== cap.worker_id) throw new AuthorityError('IDENTITY_MISMATCH', 'worker', 'CONTAINMENT');

      // action + resource must pass BOTH auth and cap (rsi.py:245-249)
      if (!(actionOk(c.action_type, aa) && actionOk(c.action_type, ca))) {
        throw new AuthorityError('ACTION_NOT_ALLOWED', c.action_type, 'CONTAINMENT');
      }
      if (!(resourceOk(c.resource, ar) && resourceOk(c.resource, cr))) {
        throw new AuthorityError('RESOURCE_NOT_ALLOWED', c.resource, 'CONTAINMENT');
      }

      // contract time window (rsi.py:250-252)
      if (c.not_before && now < c.not_before) throw new AuthorityError('CONTRACT_NOT_YET_VALID', c.not_before, 'CONTAINMENT');
      if (c.expires_at && now > c.expires_at) throw new AuthorityError('CONTRACT_EXPIRED', c.expires_at, 'CONTAINMENT');

      // consequential requirements (rsi.py:253-257)
      if (isConsequential(c.action_type) && !(c.rollback_contract && String(c.rollback_contract).trim())) {
        throw new AuthorityError('MISSING_ROLLBACK', c.action_type, 'CONTAINMENT');
      }
      if (isConsequential(c.action_type) && (!c.evidence_refs || c.evidence_refs.length === 0)) {
        throw new AuthorityError('MISSING_EVIDENCE', c.action_type, 'CONTAINMENT');
      }

      // idempotency (rsi.py:258-262)
      let idemKey = null;
      if (c.mission_id) {
        idemKey = `${c.action_type}:${c.resource}:${c.mission_id}`;
        if (state.idempotency[idemKey]) throw new AuthorityError('IDEMPOTENCY_REPLAY', idemKey, 'CONTAINMENT');
      }

      // budget (atomic reservation, rsi.py:263-273) — SUM(reserved) inside the lock
      const resIds = [];
      const budget = c.budget || {};
      for (const [name, amount] of Object.entries(budget)) {
        const b = state.budgets[name];
        if (b === undefined) throw new AuthorityError('UNKNOWN_BUDGET', name, 'CONTAINMENT');
        const reserved = state.reservations
          .filter((r) => r.name === name && r.state === 'reserved')
          .reduce((s, r) => s + r.amount, 0);
        if (amount > b.limit_ - b.used - reserved + 1e-9) {
          throw new AuthorityError('BUDGET_EXCEEDED',
            `${name}: need ${amount}, remaining ${b.limit_ - b.used - reserved}`, 'CONTAINMENT');
        }
        const rid = `res_${cryptoRand()}`;
        state.reservations.push({ id: rid, name, amount, state: 'reserved', contract_id: c.id, mission_id: c.mission_id ?? null });
        resIds.push(rid);
      }

      // record idempotency on admit (rsi.py writes this via the ReceiptLedger; the B bridge writes it
      // on admit — FIX-2. We do the same so replay is refused without depending on a receipt.)
      if (idemKey) state.idempotency[idemKey] = { contract_id: c.id };

      this._writeAtomic(state);
      return { reservationIds: resIds };
    });
  }
}

// rsi.py:172-175 CONSEQUENTIAL set — but the authority's action vocabulary is CANA-shaped, so we key
// off an explicit flag the caller supplies (external effect / owner-gated). Kept here so the port is
// self-contained and the compat court can drive the SAME allowlist through both engines.
const CONSEQUENTIAL = new Set([
  'github.branch', 'github.commit', 'github.pr', 'site.publish', 'site.draft',
  'flag.set', 'campaign.spend', 'model.config', 'db.write', 'interpret.publish',
]);
export function isConsequential(actionType) { return CONSEQUENTIAL.has(actionType); }

function cryptoRand() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
