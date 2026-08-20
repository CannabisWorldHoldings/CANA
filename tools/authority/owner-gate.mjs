// tools/authority/owner-gate.mjs — the ONE canonical owner-authorization vocabulary.
//
// OWNER DECISION (settled): every owner authorization binds AT MINIMUM: gate_id, action_type,
// tenant/scope, exact action digest, nonce, issued_at, expires_at, single_use, issuer,
// signature/protected-auth proof, consumed_at, result receipt. A boolean like ownerApproved=true is
// NOT authority.
//
// This module mints and admits owner GATE authorizations (the owner-gated / external-effect class).
// It never trusts an ambient flag: an owner-gated action is admitted ONLY by a signed grant whose
// EVERY bound field matches the request, whose signature verifies under the owner root, whose nonce
// has never been consumed (single-use), and which has not expired. Nonce consumption is delegated to
// an atomic serializable store (nonce.mjs) so exactly one concurrent redemption can win.

import { AuthorityError, hashCanonical, requireText, isText } from './canon.mjs';

export const OWNER_GATE_SCHEMA = 'cana.owner-authorization/1';

// The single reconciled owner-gated vocabulary (superset of Hermes OWNER_ONLY, mission-2
// external/production, governor.json brakes). External effects are the canonical owner-gated class.
export const OWNER_GATED = Object.freeze(new Set([
  'DEPLOY', 'PAYMENT', 'DNS_WRITE', 'MERGE_TO_MAIN', 'PRODUCTION_ACCESS', 'SPEND', 'EMAIL_SEND',
  'NETWORK_EGRESS', 'ROTATE_KEY', 'POLICY_MUTATION', 'REVOKE_OWNER', 'CREDENTIAL_DISCLOSURE',
  'DELETE_PRODUCTION_DATA', 'CONTACT_MERCHANT', 'PUBLIC_CLAIM',
]));

export function isOwnerGated(actionType) {
  return OWNER_GATED.has(actionType);
}

// The exact action digest binds an owner authorization to ONE concrete action — action_type +
// resource + tenant + scope + the caller's own action payload. A grant for one action cannot be
// replayed onto a different one because the digest won't match.
export function actionDigest({ action_type, resource, tenant, scope, action }) {
  return hashCanonical({
    action_type, resource: resource ?? null, tenant, scope: scope ?? null, action: action ?? null,
  });
}

// The canonical signed body — EXACTLY the owner-mandated minimum fields (minus consumed_at/result
// receipt, which are recorded by the authority AFTER admission, not signed by the owner).
function grantBody(g) {
  return {
    schema: OWNER_GATE_SCHEMA,
    gate_id: g.gate_id,
    action_type: g.action_type,
    tenant: g.tenant,
    scope: g.scope ?? null,
    action_digest: g.action_digest,
    nonce: g.nonce,
    issued_at: g.issued_at,
    expires_at: g.expires_at,
    single_use: g.single_use,
    issuer: g.issuer,
  };
}

// Owner (out of band, via the DEV signing oracle) mints a grant for exactly ONE action.
export function mintOwnerAuthorization(signer, {
  gate_id, action_type, resource, tenant, scope = null, action = null,
  now, ttlMs, nonce, issuer = 'OWNER', single_use = true,
}) {
  requireText(gate_id, 'gate_id');
  requireText(action_type, 'action_type');
  requireText(tenant, 'tenant');
  requireText(nonce, 'nonce');
  requireText(issuer, 'issuer');
  const digest = actionDigest({ action_type, resource, tenant, scope, action });
  const body = grantBody({
    gate_id, action_type, tenant, scope, action_digest: digest, nonce,
    issued_at: new Date(now).toISOString(),
    expires_at: new Date(now + ttlMs).toISOString(),
    single_use, issuer,
  });
  const proof = signer.sign(hashCanonical(body)); // {sig, key_id, identity, trust_label}
  return Object.freeze({ ...body, resource: resource ?? null, proof });
}

// Admission. Returns { ok, code, grant } — the grant is returned so the authority can record
// consumed_at + a result receipt against the exact admitted authorization. `consumeNonce` is an
// atomic single-use claim (nonce.mjs). `verify` is the owner-root verifier (fail-closed in prod).
export function admitOwnerAuthorization(verifier, grant, {
  action_type, resource, tenant, scope = null, action = null, now, consumeNonce,
}) {
  if (!grant || typeof grant !== 'object') return { ok: false, code: 'OWNER_GATE_REQUIRED' };
  // Booleans are NOT authority: the grant must be the full signed vocabulary.
  for (const f of ['gate_id', 'action_type', 'tenant', 'action_digest', 'nonce', 'issued_at', 'expires_at', 'issuer']) {
    if (!isText(grant[f])) return { ok: false, code: 'OWNER_GRANT_MALFORMED', detail: `missing ${f}` };
  }
  if (typeof grant.single_use !== 'boolean') return { ok: false, code: 'OWNER_GRANT_MALFORMED', detail: 'single_use' };
  if (grant.schema !== OWNER_GATE_SCHEMA) return { ok: false, code: 'OWNER_GRANT_MALFORMED', detail: 'schema' };

  // Scope binding: the grant must name THIS action, tenant, and scope exactly.
  if (grant.action_type !== action_type || grant.tenant !== tenant) {
    return { ok: false, code: 'OWNER_GRANT_SCOPE_MISMATCH' };
  }
  if ((grant.scope ?? null) !== (scope ?? null)) return { ok: false, code: 'OWNER_GRANT_SCOPE_MISMATCH' };
  const expectDigest = actionDigest({ action_type, resource, tenant, scope, action });
  if (grant.action_digest !== expectDigest) return { ok: false, code: 'OWNER_GRANT_ACTION_MISMATCH' };

  // Recompute the signed body and verify the proof under the OWNER ROOT (not a process key).
  const recomputed = hashCanonical(grantBody(grant));
  if (!verifier.verify(recomputed, grant.proof)) {
    // Distinguish fail-closed (no admissible verifier) from a genuinely bad signature.
    const reason = typeof verifier.unavailableReason === 'function' ? verifier.unavailableReason() : null;
    if (reason) return { ok: false, code: reason };
    return { ok: false, code: 'OWNER_GRANT_BAD_SIGNATURE' };
  }

  if (new Date(grant.expires_at).getTime() <= now) return { ok: false, code: 'OWNER_GRANT_EXPIRED' };

  // Single-use: atomic serializable consumption. Exactly one caller can win the nonce.
  if (grant.single_use !== false) {
    const claimed = consumeNonce(grant.nonce);
    if (!claimed) return { ok: false, code: 'OWNER_GRANT_REPLAY' };
  }
  return { ok: true, code: 'OWNER_GRANT_ADMITTED', grant };
}
