// tools/authority/authority.mjs — THE SINGLE SEAT. One authorize(request), the only place a CANA
// Authority authorization object is minted. This is the Architecture-Court winner (Candidate C: a
// thin CANA Authority facade delegating each scarce gene to the specialist that owns it), landed in
// the real merged tree and hardened per the four Phase-E items.
//
// COMPOSITION (each gene from its specialist):
//   generator != judge precondition ....... tools/mission-2/authorization.mjs (authorizeMission)
//   deterministic reproducible receipt .... tools/mission-2/authorization.mjs
//   Ed25519 signed execution lease ........ tools/mission-2/lease.mjs
//   capability ⊆ authorization + atomic
//     budget reservation + revocation +
//     replay/idempotency .................. tools/authority/containment.mjs (NATIVE NODE PORT of
//                                            governor-kernel rsi.py — Phase E1; no Python subprocess)
//   owner gate (canonical vocabulary) ..... tools/authority/owner-gate.mjs
//   root of trust (DEV_ONLY / fail-closed)  tools/authority/signer.mjs (Phase E3)
//   single-use nonce (atomic) ............. tools/authority/nonce.mjs (Phase E4)
//   lease TTL reclaim ..................... tools/authority/lease-reclaim.mjs (Phase E2)
//   hash-chained durable decision receipts  tools/authority/receipts.mjs
//
// Federation census (tools/federation) is ADMISSION-ONLY: authorize() may optionally CHECK that a
// capability is registered, but registration is NEVER sufficient — the containment gate still runs.
// The resident governor (tools/vanguard/governor.mjs) stays orchestration; it is NOT an authorizer.
//
// authorize() NEVER executes an effect. It returns a signed AUTHORIZATION OBJECT — the ONLY input
// that skills-src/hermes-governed-packet.mjs makeGrant will bind a grant to (Phase D). The object is
// signed via the signer interface, so Hermes verifies it WITHOUT self-authorizing or self-verifying.

import { authorizeMission } from '../mission-2/authorization.mjs';
import { issueExecutionLease, assertAdmittedLease } from '../mission-2/lease.mjs';
import {
  AuthorityError, hashCanonical, canonical, requireText, isText,
} from './canon.mjs';
import { ownerRootVerifier } from './signer.mjs';
import { ContainmentStore } from './containment.mjs';
import {
  isOwnerGated, admitOwnerAuthorization, actionDigest as ownerActionDigest,
} from './owner-gate.mjs';
import { NonceStore } from './nonce.mjs';
import { DecisionChain } from './receipts.mjs';

export const AUTHORIZATION_SCHEMA = 'cana.authority-authorization/1';

// The exact-action digest an authorization is bound to. makeGrant recomputes this from the packet
// intent to prove the authorization was minted for THIS action, not replayed onto another.
export function authorizationActionDigest({ action_type, resource, tenant, scope, action }) {
  return hashCanonical({
    action_type, resource: resource ?? null, tenant, scope: scope ?? null, action: action ?? null,
  });
}

// The canonical signed body of an authorization object. Signing this (via the signer interface) is
// what makes the object un-forgeable: an executor cannot mint one without the owner-root signing
// oracle, and cannot tamper a field without breaking the recompute+verify.
function authorizationBody(a) {
  return {
    schema: AUTHORIZATION_SCHEMA,
    id: a.id,
    tenant: a.tenant,
    scope: a.scope ?? null,
    action_type: a.action_type,
    action_digest: a.action_digest,
    capability: a.capability,
    budget_units: a.budget_units,
    issuer: a.issuer,
    issued_at: a.issued_at,
    expires_at: a.expires_at,
    nonce: a.nonce,
    mission_receipt_hash: a.mission_receipt_hash,
    owner_gated: a.owner_gated,
    owner_gate_id: a.owner_gate_id ?? null,
  };
}

// Deterministic, self-certifying id = digest of the canonical body WITHOUT the id field. Computed
// identically at mint time (authorize) and verify time (verifyAuthorization / makeGrant).
function deriveAuthorizationId(a) {
  const { id: _drop, ...bodyForId } = authorizationBody({ ...a, id: '' });
  return `auth_${hashCanonical(bodyForId).slice(0, 32)}`;
}

// VERIFY an authorization object independently (used by makeGrant in Hermes). Pure function over the
// object + the owner-root verifier. Returns { ok, code }. Never trusts a boolean; always recomputes
// the body and verifies the signature under the owner root.
export function verifyAuthorization(auth, verifier, { now, action_type, resource, tenant, scope = null, action = null } = {}) {
  if (!auth || typeof auth !== 'object') return { ok: false, code: 'AUTHORIZATION_ABSENT' };
  if (auth.schema !== AUTHORIZATION_SCHEMA) return { ok: false, code: 'AUTHORIZATION_MALFORMED' };
  for (const f of ['id', 'tenant', 'action_type', 'action_digest', 'capability', 'issuer', 'issued_at', 'expires_at', 'nonce', 'mission_receipt_hash']) {
    if (!isText(auth[f])) return { ok: false, code: 'AUTHORIZATION_MALFORMED', detail: `missing ${f}` };
  }
  if (!auth.proof || typeof auth.proof !== 'object') return { ok: false, code: 'AUTHORIZATION_UNSIGNED' };
  // id must equal the digest of the body WITHOUT the id field (a forged/edited id cannot survive
  // this — it is exactly how authorize() derives the id).
  const expectId = deriveAuthorizationId(auth);
  if (auth.id !== expectId) return { ok: false, code: 'AUTHORIZATION_ID_FORGED' };
  // Signature under the owner root (fail-closed in production via the verifier). Signed over the FULL
  // canonical body (id included), exactly as authorize() signed it.
  const body = authorizationBody(auth);
  if (!verifier.verify(hashCanonical(body), auth.proof)) {
    const reason = typeof verifier.unavailableReason === 'function' ? verifier.unavailableReason() : null;
    return { ok: false, code: reason ?? 'AUTHORIZATION_SIGNATURE_INVALID' };
  }
  if (now != null && new Date(auth.expires_at).getTime() <= now) return { ok: false, code: 'AUTHORIZATION_EXPIRED' };
  // Optional action binding: if the caller names the action, the digest must match exactly.
  if (action_type != null) {
    const expect = authorizationActionDigest({ action_type, resource, tenant, scope, action });
    if (auth.action_digest !== expect) return { ok: false, code: 'AUTHORIZATION_ACTION_MISMATCH' };
    if (auth.action_type !== action_type) return { ok: false, code: 'AUTHORIZATION_ACTION_MISMATCH' };
  }
  if (tenant != null && auth.tenant !== tenant) return { ok: false, code: 'AUTHORIZATION_TENANT_MISMATCH' };
  return { ok: true, code: 'AUTHORIZATION_VALID', auth };
}

// ── THE SINGLE authorize() SEAT ─────────────────────────────────────────────
// request = {
//   now (ISO), tenant, scope?, executorIdentity,
//   action: { action_type, resource, action? },          // the concrete action
//   capability, budgetUnits,                               // Hermes-shaped capability being granted
//   mission, contextPacket,                                // mission-2 verdict inputs (generator!=judge)
//   containment: { authorization_id, worker_capability_id, worker_id, actor_id, site_id,
//                  mission_id?, evidence_refs?, rollback_contract?, budget? },  // gk-port inputs
//   ownerGrant?,                                           // signed owner authorization (owner-gated)
//   lease?: { workerId, ttlMs, leaseAuthority },           // optional Plane-3 lease
//   signer,                                                // owner-root SIGNING oracle (mints the object)
//   verifier?,                                             // owner-root VERIFIER (defaults from stateDir/owner root)
//   ownerRootDir,                                          // where owner-root pub lives
// }
// opts = { stateDir, env? }
export function authorize(request, opts) {
  const {
    now: nowIso, tenant, scope = null, executorIdentity,
    action, capability, budgetUnits,
    mission, contextPacket, containment,
    ownerGrant, lease, signer, ownerRootDir,
  } = request;
  const env = opts?.env ?? process.env;
  const stateDir = opts.stateDir;
  requireText(stateDir, 'opts.stateDir');
  requireText(tenant, 'request.tenant');
  requireText(executorIdentity, 'request.executorIdentity');
  if (!action || !isText(action.action_type)) throw new AuthorityError('ACTION_REQUIRED', 'request.action.action_type is required');
  requireText(capability, 'request.capability');

  const now = new Date(nowIso).getTime();
  const chain = new DecisionChain(stateDir);
  const nonces = new NonceStore(stateDir);
  const store = new ContainmentStore(stateDir);
  const verifier = request.verifier ?? ownerRootVerifier(ownerRootDir, { env });

  const deny = (code, stage, detail) => {
    chain.append({
      decision: 'DENIED', code, stage: stage ?? null, tenant,
      action_type: action.action_type, at: new Date(now).toISOString(),
    });
    return { admitted: false, code, stage: stage ?? null, detail: detail ?? null };
  };

  // ── SPECIALIST 1 — owner gate (owner-gated / external-effect). Canonical vocabulary, single-use.
  const ownerGated = Boolean(request.externalEffect) || isOwnerGated(action.action_type);
  let ownerGateId = null;
  if (ownerGated) {
    const admitted = admitOwnerAuthorization(verifier, ownerGrant, {
      action_type: action.action_type, resource: action.resource ?? null, tenant, scope,
      action: action.action ?? null, now,
      consumeNonce: (n) => nonces.consume(n),
    });
    if (!admitted.ok) return deny(admitted.code, 'OWNER_GATE', admitted.detail);
    ownerGateId = admitted.grant.gate_id;
  }

  // ── SPECIALIST 2 — Mission-2 policy verdict (generator != judge, tenant, rollback, expiry, forgery)
  let m2;
  try {
    m2 = authorizeMission({
      mission, contextPacket, now: new Date(now), executorIdentity,
    });
  } catch (e) {
    return deny(e.code ?? 'POLICY_DENIED', 'POLICY_M2', e.message);
  }
  // Tenant of the request must match the mission's tenant (no ambient tenant).
  if (mission.tenant_id !== tenant) return deny('CROSS_TENANT_DENIED', 'POLICY_M2', 'request tenant != mission tenant');

  // ── SPECIALIST 3 — containment: capability ⊆ authorization, action allowlist, atomic budget,
  //    revocation, replay. NATIVE NODE PORT (Phase E1), NOT a Python subprocess.
  const c = {
    id: `act_${hashCanonical({ ...containment, action_type: action.action_type, resource: action.resource, now }).slice(0, 24)}`,
    action_type: action.action_type,
    resource: action.resource ?? '',
    authorization_id: containment?.authorization_id,
    worker_capability_id: containment?.worker_capability_id,
    worker_id: containment?.worker_id,
    actor_id: containment?.actor_id,
    tenant_id: tenant,
    site_id: containment?.site_id,
    mission_id: containment?.mission_id ?? null,
    evidence_refs: containment?.evidence_refs ?? [],
    rollback_contract: containment?.rollback_contract ?? '',
    budget: containment?.budget ?? {},
    not_before: containment?.not_before ?? null,
    expires_at: containment?.expires_at ?? null,
  };
  let reservation;
  try {
    reservation = store.authorizeAndReserve(c, { now: new Date(now).toISOString() });
  } catch (e) {
    if (e instanceof AuthorityError) return deny(e.code, e.stage ?? 'CONTAINMENT', e.detail);
    return deny('CONTAINMENT_ERROR', 'CONTAINMENT', e.message);
  }

  // ── COMPOSE — mint the signed AUTHORIZATION OBJECT (the only makeGrant input). Bind the exact
  //    action digest, tenant/scope, capability subset, expiry, nonce, and the mission receipt hash.
  requireText(m2.expires_at, 'mission expires_at');
  if (!signer || typeof signer.sign !== 'function') {
    return deny('SIGNER_REQUIRED', 'COMPOSE', 'authorize() requires an owner-root signing oracle');
  }
  const digest = authorizationActionDigest({
    action_type: action.action_type, resource: action.resource ?? null, tenant, scope, action: action.action ?? null,
  });
  const nonce = `n_${hashCanonical({ digest, tenant, capability, m2: m2.authorization_receipt_hash, seq: chain.head().seq + 1 }).slice(0, 24)}`;
  const draft = {
    tenant, scope, action_type: action.action_type, action_digest: digest,
    capability, budget_units: budgetUnits ?? 1,
    issuer: signer.identity ?? 'OWNER_SIGNER',
    issued_at: new Date(now).toISOString(),
    expires_at: m2.expires_at,
    nonce,
    mission_receipt_hash: m2.authorization_receipt_hash,
    owner_gated: ownerGated,
    owner_gate_id: ownerGateId,
  };
  // id = digest of the body WITHOUT id, so id is deterministic and self-certifying.
  const id = deriveAuthorizationId({ ...draft, id: '' });
  const full = { ...draft, id };
  const signedBody = authorizationBody(full);
  const proof = signer.sign(hashCanonical(signedBody));
  const authorization = Object.freeze({
    schema: AUTHORIZATION_SCHEMA, ...full, resource: action.resource ?? null, proof,
  });

  // durable, tamper-evident decision receipt (hash chained)
  const durable = chain.append({
    decision: 'AUTHORIZED',
    authorization_id: id,
    tenant, scope, action_type: action.action_type,
    capability, executor_identity: executorIdentity,
    verifier_identity: mission.verifier_identity,
    mission_receipt_hash: m2.authorization_receipt_hash,
    reservation_ids: reservation.reservationIds,
    owner_gate_id: ownerGateId,
    at: new Date(now).toISOString(),
  });

  // ── SPECIALIST 4 — optional Mission-2 Ed25519 lease for Plane-3 execution.
  let issuedLease = null;
  if (lease) {
    issuedLease = issueExecutionLease({
      missionId: mission.mission_id,
      authorizationReceiptHash: m2.authorization_receipt_hash,
      workerId: lease.workerId,
      version: durable.seq,
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + lease.ttlMs).toISOString(),
      authority: lease.leaseAuthority,
    });
  }

  return {
    admitted: true, code: 'AUTHORIZED',
    authorization, durable, mission_receipt: m2,
    reservation_ids: reservation.reservationIds,
    lease: issuedLease,
  };
}

// Verify a previously-issued Plane-3 lease (delegates to mission-2).
export function admitLease({ lease, missionId, workerId, authorizationReceiptHash, authorityPublicKey, now }) {
  try {
    assertAdmittedLease({ lease, missionId, workerId, authorizationReceiptHash, authorityPublicKey, now: new Date(now) });
    return { ok: true };
  } catch (e) {
    return { ok: false, code: e.code ?? 'LEASE_DENIED', detail: e.message };
  }
}

// Crash reconstruction: re-verify the durable decision chain from bytes alone.
export function reconstruct(opts) {
  return new DecisionChain(opts.stateDir).verify();
}

export { DecisionChain, ContainmentStore, NonceStore };
export { ownerRootVerifier, provisionDevOwnerRoot, devOwnerSigner } from './signer.mjs';
export { LeaseRegistry } from './lease-reclaim.mjs';
export { mintOwnerAuthorization, isOwnerGated, OWNER_GATED } from './owner-gate.mjs';
export { canonical, hashCanonical };
