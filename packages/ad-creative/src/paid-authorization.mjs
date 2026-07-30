import { createHash, createPublicKey, verify } from 'node:crypto';

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function buildPaidRequestBinding(request) {
  const canonical = stableJson(request);
  return Object.freeze({
    request: Object.freeze({ ...request }),
    requestSha256: createHash('sha256').update(canonical).digest('hex'),
  });
}

export function verifyPaidAuthorizationReceipt({
  receipt,
  requestBinding,
  publicKey,
  requiredCostUsd,
  now = new Date(),
}) {
  if (!receipt || typeof receipt !== 'object') {
    throw new Error('CANA paid-governance receipt is required');
  }
  if (!publicKey) {
    throw new Error('CANA paid-governance public key is not configured');
  }
  const {
    signatureBase64,
    schemaVersion,
    authority,
    receiptId,
    tenantId,
    requestSha256,
    currency,
    maxCostUsd,
    notBefore,
    expiresAt,
    ownerApprovalId,
    grantEligibilityReceiptId,
    nonce,
  } = receipt;
  if (
    schemaVersion !== 1 ||
    authority !== 'CANA_PAID_GOVERNANCE' ||
    typeof receiptId !== 'string' ||
    !receiptId ||
    typeof tenantId !== 'string' ||
    !tenantId ||
    requestSha256 !== requestBinding.requestSha256 ||
    currency !== 'USD' ||
    typeof maxCostUsd !== 'number' ||
    maxCostUsd < requiredCostUsd ||
    typeof ownerApprovalId !== 'string' ||
    !ownerApprovalId ||
    typeof grantEligibilityReceiptId !== 'string' ||
    !grantEligibilityReceiptId ||
    typeof nonce !== 'string' ||
    nonce.length < 16 ||
    typeof signatureBase64 !== 'string' ||
    !signatureBase64
  ) {
    throw new Error('CANA paid-governance receipt is malformed or does not authorize this request');
  }
  const start = Date.parse(notBefore);
  const expiry = Date.parse(expiresAt);
  const current = now.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(expiry) || current < start || current >= expiry) {
    throw new Error('CANA paid-governance receipt is outside its active interval');
  }
  const signedPayload = { ...receipt };
  delete signedPayload.signatureBase64;
  const valid = verify(
    null,
    Buffer.from(stableJson(signedPayload)),
    createPublicKey(publicKey),
    Buffer.from(signatureBase64, 'base64'),
  );
  if (!valid) {
    throw new Error('CANA paid-governance receipt signature is invalid');
  }
  return Object.freeze({
    receiptId,
    tenantId,
    requestSha256,
    maxCostUsd,
    expiresAt,
  });
}

export function canonicalPaidAuthorizationPayload(receiptWithoutSignature) {
  return Buffer.from(stableJson(receiptWithoutSignature));
}
