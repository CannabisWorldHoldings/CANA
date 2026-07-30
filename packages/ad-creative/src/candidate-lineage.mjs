import { createHash } from 'node:crypto';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

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

export function buildCandidateLineage({
  missionId,
  candidateId,
  parentCandidateId = null,
  brief,
  providerReceipt,
  imageBase64,
  approval = null,
}) {
  if (!missionId || !candidateId || !brief || !providerReceipt || !imageBase64) {
    throw new TypeError('lineage requires missionId, candidateId, brief, providerReceipt, and image');
  }
  const requestSha256 = sha256(
    stableJson({
      brief,
      provider: providerReceipt.provider,
      model: providerReceipt.model,
    }),
  );
  const imageSha256 = sha256(Buffer.from(imageBase64, 'base64'));
  return Object.freeze({
    schemaVersion: 1,
    missionId,
    candidateId,
    parentCandidateId,
    requestSha256,
    imageSha256,
    provider: providerReceipt.provider,
    model: providerReceipt.model,
    cost: providerReceipt.cost ?? null,
    approval,
    learningPromotion: 'BLOCKED_UNTIL_VERIFIED_OUTCOME_AND_ATTRIBUTION',
  });
}

export function buildRollbackPreparation({ route, currentAsset, candidateLineage }) {
  if (!route || !currentAsset?.sha256 || !currentAsset?.path || !candidateLineage?.imageSha256) {
    throw new TypeError('rollback preparation requires route, current asset identity, and candidate lineage');
  }
  return Object.freeze({
    mode: 'DRAFT_ONLY',
    route,
    restorePath: currentAsset.path,
    restoreSha256: currentAsset.sha256,
    candidateSha256: candidateLineage.imageSha256,
    automaticPublish: false,
  });
}
