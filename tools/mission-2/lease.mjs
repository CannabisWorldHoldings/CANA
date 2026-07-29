import {
  assertMission,
  constantTimeEqual,
  deepFreeze,
  deterministicId,
  hashCanonical,
  requireIso,
  requireSha256,
  requireText,
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
  };
}

export function assertLeaseReceipt({
  lease,
  missionId,
  authorizationReceiptHash,
  workerId,
  now,
}) {
  assertMission(
    lease && typeof lease === 'object',
    'LEASE_REQUIRED',
    'A CANA execution lease is required',
  );
  const body = leaseBody(lease);
  const expectedKeys = [...Object.keys(body), 'lease_receipt_hash'].sort();
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
}) {
  requireText(missionId, 'missionId');
  requireSha256(authorizationReceiptHash, 'authorizationReceiptHash');
  requireText(workerId, 'workerId');
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
  };
  return deepFreeze({ ...body, lease_receipt_hash: hashCanonical(body) });
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
}) {
  return assertLeaseReceipt({
    lease,
    missionId,
    authorizationReceiptHash,
    workerId,
    now,
  });
}

export function refreshExecutionLease(lease, heartbeatAt) {
  assertLeaseReceipt({
    lease,
    missionId: lease?.mission_id,
    authorizationReceiptHash: lease?.authorization_receipt_hash,
    workerId: lease?.worker_id,
    now: new Date(heartbeatAt),
  });
  const body = { ...leaseBody(lease), heartbeat_at: requireIso(heartbeatAt, 'heartbeatAt') };
  assertMission(
    new Date(body.heartbeat_at).getTime() < new Date(body.expires_at).getTime(),
    'LEASE_EXPIRED',
    'Heartbeat cannot refresh an expired lease',
  );
  return deepFreeze({ ...body, lease_receipt_hash: hashCanonical(body) });
}
