import { createPublicKey, verify } from 'node:crypto';
import {
  assertMission,
  canonicalize,
  constantTimeEqual,
  deepFreeze,
  deterministicId,
  hashCanonical,
  requireIso,
  requireSha256,
  requireText,
  sha256,
} from './canonical.mjs';

function leaseBody(lease) {
  return {
    schema_version: lease.schema_version,
    mission_id: lease.mission_id,
    authorization_receipt_hash: lease.authorization_receipt_hash,
    worker_id: lease.worker_id,
    token: lease.token,
    issued_at: lease.issued_at,
    expires_at: lease.expires_at,
    heartbeat_at: lease.heartbeat_at,
    lease_authority_key_id: lease.lease_authority_key_id,
  };
}

function verifyLeaseSignature(body, signature, authorityPublicKey) {
  assertMission(
    typeof authorityPublicKey === 'string' && authorityPublicKey.length > 0,
    'LEASE_AUTHORITY_REQUIRED',
    'A trusted CANA lease-authority public key is required',
  );
  let publicKey;
  try {
    publicKey = createPublicKey({
      key: Buffer.from(authorityPublicKey, 'base64'),
      format: 'der',
      type: 'spki',
    });
  } catch {
    assertMission(false, 'LEASE_AUTHORITY_INVALID', 'Lease-authority public key is malformed');
  }
  return verify(null, canonicalize(body), publicKey, Buffer.from(signature ?? '', 'base64'));
}

export function assertLeaseReceipt({
  lease,
  missionId,
  authorizationReceiptHash,
  workerId,
  now,
  authorityPublicKey,
}) {
  assertMission(
    lease && typeof lease === 'object',
    'LEASE_REQUIRED',
    'A CANA execution lease is required',
  );
  const body = leaseBody(lease);
  const expectedKeys = [...Object.keys(body), 'lease_receipt_hash', 'lease_signature'].sort();
  assertMission(
    JSON.stringify(Object.keys(lease).sort()) === JSON.stringify(expectedKeys),
    'LEASE_TAMPERED',
    'Execution lease fields differ from the canonical schema',
  );
  assertMission(
    constantTimeEqual(lease.lease_receipt_hash, hashCanonical(body)),
    'LEASE_TAMPERED',
    'Execution lease hash does not recompute',
  );
  const expectedKeyId = sha256(Buffer.from(authorityPublicKey ?? '', 'base64'));
  assertMission(
    constantTimeEqual(lease.lease_authority_key_id, expectedKeyId)
      && verifyLeaseSignature(body, lease.lease_signature, authorityPublicKey),
    'LEASE_AUTHENTICITY_DENIED',
    'Execution lease was not signed by the trusted CANA lease authority',
  );
  assertMission(
    lease.schema_version === 'cana.execution-lease/2.0.0',
    'LEASE_TAMPERED',
    'Execution lease schema is invalid',
  );
  assertMission(lease.mission_id === missionId, 'LEASE_MISSION_MISMATCH', 'Execution lease mission differs');
  assertMission(
    lease.authorization_receipt_hash === authorizationReceiptHash,
    'LEASE_AUTHORIZATION_MISMATCH',
    'Execution lease authorization differs',
  );
  assertMission(lease.worker_id === workerId, 'LEASE_WORKER_MISMATCH', 'Execution lease worker differs');
  requireIso(lease.issued_at, 'lease.issued_at');
  requireIso(lease.expires_at, 'lease.expires_at');
  requireIso(lease.heartbeat_at, 'lease.heartbeat_at');
  assertMission(
    new Date(lease.heartbeat_at).getTime() >= new Date(lease.issued_at).getTime(),
    'LEASE_TAMPERED',
    'Lease heartbeat predates issuance',
  );
  assertMission(
    new Date(lease.heartbeat_at).getTime() < new Date(lease.expires_at).getTime(),
    'LEASE_EXPIRED',
    'Lease heartbeat is outside its validity period',
  );
  assertMission(
    new Date(lease.expires_at).getTime() > now.getTime(),
    'LEASE_EXPIRED',
    'Execution lease expired',
  );
  return lease;
}

export function issueExecutionLease({
  missionId,
  authorizationReceiptHash,
  workerId,
  version,
  issuedAt,
  expiresAt,
  authority,
}) {
  requireText(missionId, 'missionId');
  requireSha256(authorizationReceiptHash, 'authorizationReceiptHash');
  requireText(workerId, 'workerId');
  assertMission(
    authority && typeof authority.sign === 'function',
    'LEASE_AUTHORITY_REQUIRED',
    'CANA lease issuance requires an authority signer',
  );
  requireSha256(authority.keyId, 'authority.keyId');
  const body = {
    schema_version: 'cana.execution-lease/2.0.0',
    mission_id: missionId,
    authorization_receipt_hash: authorizationReceiptHash,
    worker_id: workerId,
    token: deterministicId('lease', {
      mission_id: missionId,
      authorization_receipt_hash: authorizationReceiptHash,
      worker_id: workerId,
      version,
      issued_at: issuedAt,
    }),
    issued_at: requireIso(issuedAt, 'issuedAt'),
    expires_at: requireIso(expiresAt, 'expiresAt'),
    heartbeat_at: requireIso(issuedAt, 'issuedAt'),
    lease_authority_key_id: authority.keyId,
  };
  return deepFreeze({
    ...body,
    lease_receipt_hash: hashCanonical(body),
    lease_signature: authority.sign(canonicalize(body)),
  });
}

export function admitPersistedLease(options) {
  return deepFreeze(assertLeaseReceipt(options));
}

export function assertAdmittedLease({
  lease,
  missionId,
  authorizationReceiptHash,
  workerId,
  now,
  authorityPublicKey,
}) {
  return assertLeaseReceipt({
    lease,
    missionId,
    authorizationReceiptHash,
    workerId,
    now,
    authorityPublicKey,
  });
}

export function refreshExecutionLease(lease, heartbeatAt, authority) {
  assertLeaseReceipt({
    lease,
    missionId: lease?.mission_id,
    authorizationReceiptHash: lease?.authorization_receipt_hash,
    workerId: lease?.worker_id,
    now: new Date(heartbeatAt),
    authorityPublicKey: authority?.publicKey,
  });
  const body = { ...leaseBody(lease), heartbeat_at: requireIso(heartbeatAt, 'heartbeatAt') };
  assertMission(
    new Date(body.heartbeat_at).getTime() < new Date(body.expires_at).getTime(),
    'LEASE_EXPIRED',
    'Heartbeat cannot refresh an expired lease',
  );
  assertMission(
    authority && typeof authority.sign === 'function',
    'LEASE_AUTHORITY_REQUIRED',
    'Lease refresh requires the CANA lease authority',
  );
  return deepFreeze({
    ...body,
    lease_receipt_hash: hashCanonical(body),
    lease_signature: authority.sign(canonicalize(body)),
  });
}
