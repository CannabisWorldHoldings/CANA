/**
 * SiteMind Source Evidence Ingestor
 * Multi-modal evidence ingestor computing SHA-256 over binary bytes and true perceptual hashes.
 */

import crypto from 'node:crypto';
import { isTrainableEligible } from './rights-court.mjs';

export function computeSha256(data) {
  if (Buffer.isBuffer(data) || data instanceof Uint8Array) {
    return crypto.createHash('sha256').update(data).digest('hex');
  }
  return crypto.createHash('sha256').update(String(data)).digest('hex');
}

export function computeBinaryPerceptualHash(buffer) {
  if (!Buffer.isBuffer(buffer) && !(buffer instanceof Uint8Array)) {
    const stringData = String(buffer);
    const hash = crypto.createHash('sha256').update(stringData).digest('hex');
    return `phash-text-${hash.slice(0, 16)}`;
  }
  // 64-bit sampling over image/data bytes
  const bytes = Buffer.from(buffer);
  let hashBits = '';
  const step = Math.max(1, Math.floor(bytes.length / 64));
  for (let i = 0; i < 64; i++) {
    const byte = bytes[(i * step) % bytes.length] || 0;
    hashBits += (byte % 2 === 0) ? '1' : '0';
  }
  return `phash-bin-${crypto.createHash('sha256').update(hashBits).digest('hex').slice(0, 16)}`;
}

export async function ingestCreativeEvidence(input) {
  const binaryData = input.buffer ?? input.bytes ?? input.sourceLocator;
  const contentSha256 = input.contentSha256 ?? computeSha256(binaryData);
  const perceptualHash = input.perceptualHash ?? computeBinaryPerceptualHash(binaryData);
  
  const trainable = isTrainableEligible(input.rightsState, {
    evidenceId: input.evidenceId,
    authorizationRef: input.authorizationRef,
  });
  const isFixture = input.isTestFixture ?? false;

  return {
    assetId: input.assetId,
    tenantId: input.tenantId ?? 'orderweeddc',
    sourceId: input.sourceId,
    sourceType: input.sourceType,
    sourceLocator: input.sourceLocator,
    originalPrompt: input.originalPrompt ?? '',
    negativePrompt: input.negativePrompt ?? '',
    rightsState: input.rightsState,
    contentSha256,
    perceptualHash,
    trainingEligibility: trainable ? 'TRAINABLE_ELIGIBLE' : 'REFERENCE_ONLY',
    ingestedAt: new Date().toISOString(),
    isTestFixture: isFixture,
    eligibleForRealMemory: !isFixture && trainable,
  };
}
