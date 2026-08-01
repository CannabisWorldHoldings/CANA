import { createPublicKey, verify } from 'node:crypto';
import { canonicalPaidAuthorizationPayload } from './paid-authorization.mjs';

function providerIdentity(provider) {
  return {
    name: provider.name,
    model: provider.model,
    providerFamily: provider.providerFamily,
    boundaryId: provider.boundaryId,
  };
}

export function verifyIndependentProviderReceipt({
  generatorProvider,
  verifierProvider,
  receipt,
  publicKey,
  tenantId,
  missionId,
  now = new Date(),
}) {
  if (!receipt || !publicKey) {
    throw new Error('signed CANA independent-verification receipt is required');
  }
  const expectedGenerator = providerIdentity(generatorProvider);
  const expectedVerifier = providerIdentity(verifierProvider);
  const {
    signatureBase64,
    schemaVersion,
    authority,
    receiptId,
    notBefore,
    expiresAt,
    nonce,
  } = receipt;
  if (
    schemaVersion !== 1 ||
    authority !== 'CANA_INDEPENDENT_VERIFICATION' ||
    receipt.tenantId !== tenantId ||
    receipt.missionId !== missionId ||
    JSON.stringify(receipt.generator) !== JSON.stringify(expectedGenerator) ||
    JSON.stringify(receipt.verifier) !== JSON.stringify(expectedVerifier) ||
    typeof receiptId !== 'string' ||
    !receiptId ||
    typeof nonce !== 'string' ||
    nonce.length < 16 ||
    typeof signatureBase64 !== 'string' ||
    !signatureBase64
  ) {
    throw new Error('independent-verification receipt does not bind the requested providers');
  }
  const start = Date.parse(notBefore);
  const expiry = Date.parse(expiresAt);
  const current = now.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(expiry) || current < start || current >= expiry) {
    throw new Error('independent-verification receipt is outside its active interval');
  }
  const payload = { ...receipt };
  delete payload.signatureBase64;
  if (
    !verify(
      null,
      canonicalPaidAuthorizationPayload(payload),
      createPublicKey(publicKey),
      Buffer.from(signatureBase64, 'base64'),
    )
  ) {
    throw new Error('independent-verification receipt signature is invalid');
  }
  return Object.freeze({ receiptId, expiresAt });
}

export function providerVerificationIdentity(provider) {
  return Object.freeze(providerIdentity(provider));
}
