import { openExperience } from './fabric.mjs';
import { assertManifest, buildManifest } from './manifest.mjs';
import { validateReceiptShape } from '../cana-intelligence/receipts.mjs';

function parseManifest(row) {
  if (!row) return null;
  try {
    return JSON.parse(row.bodyJson);
  } catch {
    throw new Error('EXPERIENCE_RUNTIME_MANIFEST_INVALID_JSON');
  }
}

function promotionReceiptFromRow(row) {
  if (!row) return null;
  return {
    kind: row.kind,
    subjectDigest: row.subjectDigest,
    realm: row.realm,
    issuer: row.issuer,
    payload: JSON.parse(row.payloadJson),
    issuedAt: row.issuedAt instanceof Date ? row.issuedAt.toISOString() : row.issuedAt,
    expiresAt: row.expiresAt instanceof Date ? row.expiresAt.toISOString() : row.expiresAt,
    parentDigests: JSON.parse(row.parentDigestsJson),
    receiptDigest: row.receiptDigest,
  };
}

async function assertPromotionLineage({ receiptStore, tenant, promotion }) {
  if (!promotion) throw new Error('EXPERIENCE_RUNTIME_PROMOTION_REQUIRED');
  if (!receiptStore || typeof receiptStore.findUnique !== 'function') {
    throw new Error('EXPERIENCE_RUNTIME_RECEIPT_STORE_REQUIRED');
  }
  const receipt = promotionReceiptFromRow(await receiptStore.findUnique({
    where: {
      tenant_receiptDigest: {
        tenant,
        receiptDigest: promotion.receiptDigest,
      },
    },
  }));
  if (!receipt) throw new Error('EXPERIENCE_RUNTIME_PROMOTION_NOT_FOUND');
  validateReceiptShape(receipt, {
    kind: 'PROMOTION',
    subjectDigest: promotion.candidateDigest,
    minimumRealm: promotion.evidenceRealm,
  });
  if (receipt.realm !== promotion.evidenceRealm || receipt.payload?.candidateDigest !== promotion.candidateDigest) {
    throw new Error('EXPERIENCE_RUNTIME_PROMOTION_MISMATCH');
  }
}

export async function resolveRuntimeExperienceManifest({ recordStore, receiptStore, tenant, journey }) {
  if (!recordStore || typeof recordStore.findFirst !== 'function') {
    throw new Error('EXPERIENCE_RUNTIME_STORE_REQUIRED');
  }
  const row = await recordStore.findFirst({
    where: {
      tenant,
      recordType: 'EXPERIENCE_MANIFEST',
      recordId: `journey:${journey}`,
      status: 'PROMOTED',
    },
    orderBy: { sequence: 'desc' },
  });
  const manifest = parseManifest(row) ?? buildManifest({ tenant, journey });
  assertManifest(manifest);
  if (manifest.merchant?.identity?.tenant !== tenant) {
    throw new Error('EXPERIENCE_RUNTIME_TENANT_MISMATCH');
  }
  if (manifest.merchant?.journey !== journey || manifest.presentation?.journey !== journey) {
    throw new Error('EXPERIENCE_RUNTIME_JOURNEY_MISMATCH');
  }
  if (row) await assertPromotionLineage({ receiptStore, tenant, promotion: manifest.promotion });
  return openExperience(manifest).current();
}
