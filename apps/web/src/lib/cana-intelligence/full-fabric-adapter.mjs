import { assert, deepFreeze, sealPlain } from './core.mjs';
import {
  ACTIONS,
  requirePrincipalReceipt,
  requireRealityCellAuthority,
} from './authority.mjs';
import {
  requireExactEvidenceRealm,
  resolveCanonicalReceipt,
} from './receipts.mjs';
import { validateBrowserObservationReceipt } from './site-cortex.mjs';

export function createFullFabricAdapter(impl) {
  const required = [
    'enumerateExperienceSurfaces',
    'loadExperienceManifest',
    'persistExperienceCandidate',
    'renderPrivatePreview',
    'captureRenderedEvidenceReceipt',
    'generateMediaCandidate',
    'loadReceipt',
    'resolveVerifiedPrincipalReceipt',
    'executeAuthorizedExperienceCandidate',
    'rollbackExperienceVersion',
  ];
  for (const key of required) assert(typeof impl?.[key] === 'function', `full fabric adapter missing ${key}`, 'FULL_FABRIC_ADAPTER_INCOMPLETE');
  return deepFreeze({
    ...impl,
    ownsAuth: false,
    ownsTruthStore: false,
    ownsRoutes: false,
    ownsMediaModel: false,
    authority: 'CANONICAL_CANA_ONLY',
  });
}

function requireCourtRealm(receipt, evidenceRealm) {
  if (evidenceRealm) return requireExactEvidenceRealm(receipt, evidenceRealm);
  return receipt;
}

export async function experiencePromotionCourt(adapter, candidate, {
  principalReceiptDigest,
  previewReceiptDigest,
  browserObservationReceiptDigest,
  browserCourtReceiptDigest,
  realityCourtReceiptDigest,
  rollbackReceiptDigest,
  experiment = null,
  authorityBinding = null,
  expiresAt = null,
  evidenceRealm = null,
  now = new Date(),
}) {
  const principal = evidenceRealm === 'FIXTURE' || evidenceRealm === 'SIMULATED'
    ? await resolveCanonicalReceipt(adapter, principalReceiptDigest, { kind: 'PRINCIPAL', now })
    : await requirePrincipalReceipt(adapter, principalReceiptDigest, ACTIONS.EXECUTE_EXPERIENCE_CANDIDATE);
  if (evidenceRealm) requireExactEvidenceRealm(principal.kind ? principal : await adapter.loadReceipt(principalReceiptDigest), evidenceRealm);
  const preview = await resolveCanonicalReceipt(adapter, previewReceiptDigest, { kind: 'PRIVATE_PREVIEW', subjectDigest: candidate.candidateDigest, now });
  const browserObservation = await resolveCanonicalReceipt(adapter, browserObservationReceiptDigest, { kind: 'BROWSER_OBSERVATION', subjectDigest: candidate.candidateDigest, now });
  const browser = await resolveCanonicalReceipt(adapter, browserCourtReceiptDigest, { kind: 'COURT', subjectDigest: candidate.candidateDigest, now });
  const reality = await resolveCanonicalReceipt(adapter, realityCourtReceiptDigest, { kind: 'COURT', subjectDigest: candidate.candidateDigest, now });
  const rollback = await resolveCanonicalReceipt(adapter, rollbackReceiptDigest, { kind: 'ROLLBACK', subjectDigest: candidate.candidateDigest, now });
  for (const receipt of [preview, browserObservation, browser, reality, rollback]) requireCourtRealm(receipt, evidenceRealm);
  validateBrowserObservationReceipt(browserObservation, {
    candidateDigest: candidate.candidateDigest,
    route: candidate.target,
    evidenceRealm,
  });
  assert(browser.payload?.court === 'BROWSER' && browser.payload?.verdict === 'PASS', 'browser court not passed', 'EXPERIENCE_BROWSER_COURT_FAILED');
  assert(browser.payload?.observationReceiptDigest === browserObservation.receiptDigest, 'browser court observation mismatch', 'EXPERIENCE_BROWSER_OBSERVATION_MISMATCH');
  assert(reality.payload?.court === 'REALITY' && reality.payload?.verdict === 'PASS', 'reality court not passed', 'EXPERIENCE_REALITY_COURT_FAILED');
  assert(rollback.payload?.rollbackContractDigest || rollback.payload?.targetVersion, 'rollback receipt incomplete', 'EXPERIENCE_ROLLBACK_INCOMPLETE');

  if (experiment) {
    assert(candidate.experimentId === experiment.experimentId, 'candidate experiment mismatch', 'REALITY_CELL_EXPERIMENT_MISMATCH');
    assert(candidate.merchantId === experiment.merchantId && candidate.tenantId === experiment.tenantId, 'candidate merchant/tenant mismatch', 'REALITY_CELL_TENANT_MISMATCH');
    assert(candidate.candidateDigest === experiment.treatmentDefinition?.candidateDigest, 'treatment candidate digest mismatch', 'CANDIDATE_DIGEST_MISMATCH');
    await requireRealityCellAuthority({ experiment, evidenceAdapter: adapter, authorityBinding, now });
    assert(rollback.payload?.rollbackContractDigest === experiment.rollbackContract?.digest, 'rollback contract mismatch', 'EXPERIENCE_ROLLBACK_MISMATCH');
  }
  const payload = {
    candidateDigest: candidate.candidateDigest,
    experimentId: experiment?.experimentId ?? candidate.experimentId ?? null,
    preregistrationDigest: experiment?.preregistrationDigest ?? null,
    merchantId: experiment?.merchantId ?? candidate.merchantId ?? null,
    tenantId: experiment?.tenantId ?? candidate.tenantId ?? null,
    principalReceiptDigest: principal.receiptDigest ?? principal.principalReceiptDigest,
    merchantAuthorizationReceiptDigest: authorityBinding?.merchantAuthorizationReceiptDigest ?? null,
    previewReceiptDigest: preview.receiptDigest,
    browserObservationReceiptDigest: browserObservation.receiptDigest,
    browserCourtReceiptDigest: browser.receiptDigest,
    realityCourtReceiptDigest: reality.receiptDigest,
    rollbackReceiptDigest: rollback.receiptDigest,
    rollbackContractDigest: experiment?.rollbackContract?.digest ?? rollback.payload?.rollbackContractDigest ?? null,
    allowedEffectSet: authorityBinding?.allowedEffectSet ?? candidate.operations.map((operation) => operation.type),
    expiresAt: expiresAt ?? authorityBinding?.expiresAt ?? null,
    evidenceRealm: evidenceRealm ?? 'VERIFIED_LOCAL',
  };
  if (experiment) assert(payload.expiresAt && new Date(payload.expiresAt).getTime() >= new Date(now).getTime(), 'promotion authority expired', 'PROMOTION_EXPIRED');
  return adapter.persistPromotionReceipt
    ? adapter.persistPromotionReceipt(payload)
    : sealPlain({ status: 'ELIGIBLE_FOR_NARROW_EXECUTION', ...payload, authorityMinted: false });
}

export async function executeExperienceThroughCanonicalAuthority(adapter, {
  candidate,
  principalReceiptDigest,
  promotionReceiptDigest,
  executionRealm = 'VERIFIED_LOCAL',
}) {
  const principal = await requirePrincipalReceipt(adapter, principalReceiptDigest, ACTIONS.EXECUTE_EXPERIENCE_CANDIDATE);
  const promotion = await resolveCanonicalReceipt(adapter, promotionReceiptDigest, { kind: 'PROMOTION', subjectDigest: candidate.candidateDigest });
  requireExactEvidenceRealm(promotion, executionRealm);
  assert(promotion.payload?.principalReceiptDigest === principal.principalReceiptDigest, 'promotion principal mismatch', 'PROMOTION_PRINCIPAL_MISMATCH');
  assert(Array.isArray(promotion.payload?.allowedEffectSet), 'promotion effect set required', 'PROMOTION_EFFECT_SET_REQUIRED');
  assert(!promotion.payload?.expiresAt || new Date(promotion.payload.expiresAt).getTime() >= Date.now(), 'promotion receipt expired', 'PROMOTION_EXPIRED');
  if (candidate.merchantId || candidate.tenantId || candidate.experimentId) {
    assert(executionRealm === 'VERIFIED_REAL', 'Reality Cell execution requires real authority evidence', 'REALITY_CELL_REAL_AUTHORITY_REQUIRED');
    assert(promotion.payload?.merchantAuthorizationReceiptDigest, 'merchant authorization missing from promotion', 'MERCHANT_AUTHORITY_REQUIRED');
    assert(typeof adapter.claimPromotionExecution === 'function', 'canonical one-time promotion claim required', 'PROMOTION_REPLAY_GUARD_REQUIRED');
  }
  if (typeof adapter.claimPromotionExecution === 'function') {
    const claimed = await adapter.claimPromotionExecution({ promotion, candidate, principal });
    assert(claimed === true, 'promotion receipt already consumed', 'PROMOTION_REPLAYED');
  }
  return adapter.executeAuthorizedExperienceCandidate({
    candidateId: candidate.candidateId,
    candidateDigest: candidate.candidateDigest,
    principal,
    promotionReceiptDigest: promotion.receiptDigest,
    allowedEffectSet: promotion.payload.allowedEffectSet,
  });
}

export async function rollbackExperienceThroughCanonicalAuthority(adapter, { versionId, principalReceiptDigest }) {
  const principal = await requirePrincipalReceipt(adapter, principalReceiptDigest, ACTIONS.ROLLBACK_EXPERIENCE_VERSION);
  return adapter.rollbackExperienceVersion({ versionId, principal });
}
