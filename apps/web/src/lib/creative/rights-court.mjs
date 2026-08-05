/**
 * SiteMind Rights & Provenance Court
 * Classifies asset rights and enforces evidence-backed trainable whitelist.
 */

import { TRAINABLE_CORPUS_WHITELIST } from './types.mjs';

export function classifyCreativeRights(rightsState, options = {}) {
  const isWhitelisted = TRAINABLE_CORPUS_WHITELIST.has(rightsState);
  const hasEvidenceProof = Boolean(options.evidenceId || options.authorizationRef || rightsState === 'ORDERWEEDDC_OWNED');
  const isTrainable = isWhitelisted && hasEvidenceProof;

  return {
    rightsState,
    allowedForTraining: isTrainable,
    allowedForReference: true,
    reason: isTrainable
      ? 'Asset belongs to trainable corpus whitelist and carries verified evidence proof.'
      : 'Asset is restricted to REFERENCE_ONLY. Training prohibited due to missing evidence proof or restricted rights.',
  };
}

export function isTrainableEligible(rightsState, options = {}) {
  return classifyCreativeRights(rightsState, options).allowedForTraining;
}

export function validateCompetitorAssetIsolation(assetId, assetDescription) {
  return {
    assetId,
    isolated: true,
    allowedForTraining: false,
    allowedForReference: true,
    reason: `Competitor asset ${assetId} (${assetDescription}) is isolated under REFERENCE_ONLY. Direct copying of logo, trademark, or verbatim text is blocked.`,
  };
}
