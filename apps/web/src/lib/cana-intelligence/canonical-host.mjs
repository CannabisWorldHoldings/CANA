import {
  ACTIONS,
  requirePrincipalReceipt,
  requireRealityCellAuthority,
} from './authority.mjs';
import {
  assert,
  canonicalJson,
  deepFreeze,
  digest,
} from './core.mjs';
import {
  makeReceipt,
  requireExactEvidenceRealm,
  resolveCanonicalReceipt,
  validateReceiptShape,
} from './receipts.mjs';
import { assertManifest } from '../experience/manifest.mjs';
import { resolveRuntimeExperienceManifest } from '../experience/runtime-manifest.mjs';
import { validateBrowserObservationReceipt } from './site-cortex.mjs';
import { requireExperienceCandidateResult } from './experience-extensions.mjs';
import {
  issueRealityCellValueReceipt,
  issueValueReceipt,
} from './economics.mjs';
import {
  REALITY_CELL_CONTRACT_VERSION,
  settleExperiment,
  verifyExperimentPreregistration,
} from './experiment.mjs';

const PRINCIPAL_ACTIONS = Object.freeze(Object.values(ACTIONS));
const CANONICAL_ONLY_RECEIPT_KINDS = new Set([
  'PRINCIPAL',
  'MERCHANT_AUTHORIZATION',
  'PROMOTION',
  'EXPERIENCE_EXECUTION',
  'EXPERIMENT_SETTLEMENT',
  'ECONOMIC_OBSERVATION',
  'VALUE',
  'LESSON_ADMISSION',
]);
const RECORD_TYPES = Object.freeze({
  LESSON: 'LESSON',
  PREDICTION: 'PREDICTION',
  EXPERIMENT: 'EXPERIMENT',
  EXPERIENCE_CANDIDATE: 'EXPERIENCE_CANDIDATE',
});
const EXPERIENCE_JOURNEY_BY_ROUTE = Object.freeze({
  '/': 'HOME',
  '/search': 'SEARCH',
  '/delivery': 'DELIVERY',
  '/dispensaries': 'DISPENSARIES',
});
const CANONICAL_EXPERIENCE_SURFACES = Object.freeze(
  Object.entries(EXPERIENCE_JOURNEY_BY_ROUTE).map(([route, journey]) => Object.freeze({ route, journey })),
);

function validateCanonicalExperienceCandidateResult(candidate, tenant) {
  requireExperienceCandidateResult(candidate);
  assert(candidate.manifestAfter?.promotion == null, 'candidate result cannot carry prior promotion authority', 'EXPERIENCE_CANDIDATE_PROMOTION_PREBOUND');
  assertManifest(candidate.manifestAfter);
  const journey = EXPERIENCE_JOURNEY_BY_ROUTE[candidate.target];
  assert(journey, 'candidate target is not a canonical customer journey', 'EXPERIENCE_RUNTIME_JOURNEY_REQUIRED');
  assert(candidate.manifestAfter.merchant?.identity?.tenant === tenant, 'candidate result tenant mismatch', 'EXPERIENCE_RUNTIME_TENANT_MISMATCH');
  assert(
    candidate.manifestAfter.merchant?.journey === journey
      && candidate.manifestAfter.presentation?.journey === journey,
    'candidate result journey mismatch',
    'EXPERIENCE_RUNTIME_JOURNEY_MISMATCH',
  );
  return candidate;
}

function dateIso(value) {
  return value instanceof Date ? value.toISOString() : value;
}

function parseJson(value, fallback = null) {
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function receiptFromRow(row) {
  if (!row) return null;
  return deepFreeze({
    kind: row.kind,
    subjectDigest: row.subjectDigest,
    realm: row.realm,
    issuer: row.issuer,
    payload: parseJson(row.payloadJson, {}),
    issuedAt: dateIso(row.issuedAt),
    expiresAt: row.expiresAt ? dateIso(row.expiresAt) : null,
    parentDigests: parseJson(row.parentDigestsJson, []),
    receiptDigest: row.receiptDigest,
  });
}

function receiptData(tenant, receipt) {
  return {
    tenant,
    receiptDigest: receipt.receiptDigest,
    kind: receipt.kind,
    subjectDigest: receipt.subjectDigest,
    realm: receipt.realm,
    issuer: receipt.issuer,
    payloadJson: canonicalJson(receipt.payload),
    issuedAt: new Date(receipt.issuedAt),
    expiresAt: receipt.expiresAt ? new Date(receipt.expiresAt) : null,
    parentDigestsJson: canonicalJson(receipt.parentDigests),
  };
}

function assertExactReplay(existing, proposed, code) {
  assert(
    canonicalJson(existing) === canonicalJson(proposed),
    'canonical digest already exists with different content',
    code,
  );
}

function recordIdentity(tenant, recordType, recordId, body) {
  return digest({ tenant, recordType, recordId, body }, `record-${recordType.toLowerCase()}`);
}

function recordBody(row) {
  return row ? deepFreeze(parseJson(row.bodyJson, null)) : null;
}

function requireDelegate(prisma, name) {
  const delegate = prisma?.[name];
  assert(delegate && typeof delegate === 'object', `Prisma delegate ${name} is required`, 'CANA_HOST_PERSISTENCE_REQUIRED');
  return delegate;
}

export function createCanonicalWeldHost({
  prisma,
  assertAdmin,
  tenant,
  appendCanonicalObservation = null,
  admitCanonicalEconomicObservation = null,
  experience = {},
} = {}) {
  assert(prisma && typeof prisma === 'object', 'canonical Prisma client required', 'CANA_HOST_PRISMA_REQUIRED');
  assert(typeof assertAdmin === 'function', 'canonical assertAdmin required', 'CANA_HOST_AUTH_REQUIRED');
  assert(typeof tenant === 'string' && tenant.trim(), 'canonical tenant required', 'CANA_HOST_TENANT_REQUIRED');

  const receiptStore = requireDelegate(prisma, 'canaEvidenceReceipt');
  const recordStore = requireDelegate(prisma, 'canaIntelligenceRecord');

  async function persistReceiptCanonical(receipt) {
    validateReceiptShape(receipt);
    const data = receiptData(tenant, receipt);
    try {
      await receiptStore.create({ data });
    } catch (error) {
      if (error?.code !== 'P2002') throw error;
      const replay = receiptFromRow(await receiptStore.findUnique({
        where: { tenant_receiptDigest: { tenant, receiptDigest: receipt.receiptDigest } },
      }));
      assert(replay, 'receipt uniqueness conflict could not be resolved', 'CANA_RECEIPT_CONFLICT');
      assertExactReplay(replay, receipt, 'CANA_RECEIPT_DIGEST_CONFLICT');
    }
    return receipt.receiptDigest;
  }

  async function persistReceipt(receipt) {
    await resolveVerifiedPrincipal();
    assert(
      !CANONICAL_ONLY_RECEIPT_KINDS.has(receipt?.kind),
      `CANA_AUTHORITY_RECEIPT_OWNER_REQUIRED: ${receipt?.kind ?? 'authority'} receipts must be minted by their canonical authority owner`,
      'CANA_AUTHORITY_RECEIPT_OWNER_REQUIRED',
    );
    assert(
      receipt?.realm !== 'VERIFIED_REAL',
      'CANA_REAL_EVIDENCE_OWNER_REQUIRED: VERIFIED_REAL receipts must be admitted by their canonical evidence owner',
      'CANA_REAL_EVIDENCE_OWNER_REQUIRED',
    );
    return persistReceiptCanonical(receipt);
  }

  async function admitEconomicObservation(observation) {
    const principal = await resolveVerifiedPrincipal();
    assert(
      typeof admitCanonicalEconomicObservation === 'function',
      'CANONICAL_ECONOMIC_ADMISSION_REQUIRED: economic observations must enter through the existing economic evidence owner',
      'CANONICAL_ECONOMIC_ADMISSION_REQUIRED',
    );
    assert(observation?.settlementDigest, 'economic observation settlement required', 'ECONOMIC_INPUT_INVALID');
    assert(
      observation?.receiptDigest === undefined && observation?.issuer === undefined,
      'economic observation receipt identity is owned by the canonical economic evidence owner',
      'CANONICAL_ECONOMIC_ADMISSION_REQUIRED',
    );
    const settlementReceipt = await resolveCanonicalReceipt(
      { loadReceipt },
      observation.settlementDigest,
      { kind: 'EXPERIMENT_SETTLEMENT' },
    );
    const receipt = await admitCanonicalEconomicObservation({ tenant, observation, principal });
    validateReceiptShape(receipt, {
      kind: 'ECONOMIC_OBSERVATION',
      subjectDigest: observation.settlementDigest,
    });
    requireExactEvidenceRealm(receipt, settlementReceipt.realm);
    return persistReceiptCanonical(receipt);
  }

  async function settleLegacyValueReceipt(settlement, economics = {}) {
    await resolveVerifiedPrincipal();
    const value = await issueValueReceipt({
      settlement,
      economics,
      evidenceAdapter: { loadReceipt },
    });
    await persistReceiptCanonical(value.receipt);
    return value;
  }

  async function settleRealityCellValueReceipt(settlement, intervention, economicObservationReceiptDigests = []) {
    await resolveVerifiedPrincipal();
    const value = await issueRealityCellValueReceipt({
      settlement,
      intervention,
      economicObservationReceiptDigests,
      evidenceAdapter: { loadReceipt },
    });
    await persistReceiptCanonical(value.receipt);
    return value;
  }

  async function loadReceipt(receiptDigest) {
    assert(receiptDigest, 'receipt digest required', 'RECEIPT_DIGEST_REQUIRED');
    return receiptFromRow(await receiptStore.findUnique({
      where: { tenant_receiptDigest: { tenant, receiptDigest } },
    }));
  }

  async function persistRecord(recordType, recordId, body) {
    await resolveVerifiedPrincipal();
    assert(Object.values(RECORD_TYPES).includes(recordType), 'unsupported intelligence record type', 'CANA_RECORD_TYPE_INVALID');
    assert(typeof recordId === 'string' && recordId, 'intelligence record id required', 'CANA_RECORD_ID_REQUIRED');
    const recordDigest = recordIdentity(tenant, recordType, recordId, body);
    const data = {
      tenant,
      recordDigest,
      recordType,
      recordId,
      status: typeof body?.status === 'string' ? body.status : 'UNKNOWN',
      bodyJson: canonicalJson(body),
    };
    try {
      await recordStore.create({ data });
    } catch (error) {
      if (error?.code !== 'P2002') throw error;
      const replay = await recordStore.findUnique({ where: { recordDigest } });
      assert(replay, 'record uniqueness conflict could not be resolved', 'CANA_RECORD_CONFLICT');
      assertExactReplay(recordBody(replay), body, 'CANA_RECORD_DIGEST_CONFLICT');
    }
    return recordDigest;
  }

  async function loadRecord(recordType, recordId) {
    const row = await recordStore.findFirst({
      where: { tenant, recordType, recordId },
      orderBy: { sequence: 'desc' },
    });
    return recordBody(row);
  }

  async function resolveVerifiedPrincipal() {
    const session = await assertAdmin();
    assert(session?.role === 'ADMIN', 'canonical Owner session required', 'AUTH_NOT_VERIFIED');
    assert(typeof session.userId === 'string' && session.userId, 'canonical Owner subject required', 'AUTH_SUBJECT_REQUIRED');
    return deepFreeze({
      verified: true,
      subject: session.userId,
      allowedActions: [...PRINCIPAL_ACTIONS],
      verifiedBy: 'canonical-assertAdmin',
    });
  }

  async function resolveVerifiedPrincipalReceipt() {
    const principal = await resolveVerifiedPrincipal();
    const receipt = makeReceipt({
      kind: 'PRINCIPAL',
      subjectDigest: digest({ subject: principal.subject }, 'principal-subject'),
      realm: 'VERIFIED_LOCAL',
      issuer: 'canonical-owner-session',
      payload: principal,
    });
    await persistReceiptCanonical(receipt);
    return receipt.receiptDigest;
  }

  async function loadObservations() {
    const rows = await prisma.marketObservation.findMany({
      where: { claimEvidence: { some: { claim: { tenant } } } },
      include: {
        snapshot: { select: { id: true, sourceKey: true, payloadSha256: true } },
        claimEvidence: { include: { claim: true } },
      },
      orderBy: { observedAt: 'asc' },
    });
    return rows.map((row) => {
      const verified = row.claimEvidence?.some(({ claim }) => (
        claim?.decisionEligible === true && claim?.verification === 'VERIFIED'
      ));
      return deepFreeze({
        id: row.id,
        entityKey: `source-record:${row.sourceRecordId}`,
        predicate: row.fieldName,
        value: row.normalizedValue ?? row.rawValue,
        unit: null,
        sourceKind: verified ? 'CANONICAL_REALITY' : 'EXTERNAL_REPORT',
        provenance: {
          snapshotId: row.snapshotId,
          sourceKey: row.snapshot?.sourceKey ?? 'UNKNOWN',
          sourceRecordSha256: row.sourceRecordSha256,
          payloadSha256: row.snapshot?.payloadSha256 ?? null,
        },
        observedAt: dateIso(row.observedAt),
        validFrom: null,
        validTo: null,
        expiresAt: row.freshnessExpiresAt ? dateIso(row.freshnessExpiresAt) : null,
        evidenceDigest: `sha256:${row.sourceRecordSha256}`,
        confidence: row.confidence,
        epistemicState: verified ? 'KNOWN' : 'UNKNOWN',
        authority: 'ZERO',
        supersededBy: null,
        correctionOf: null,
        downgraded: false,
      });
    });
  }

  async function appendObservation(observation) {
    await assertAdmin();
    assert(
      typeof appendCanonicalObservation === 'function',
      'CANONICAL_REALITY_ADMISSION_REQUIRED: observations must enter through the existing reality owner',
      'CANONICAL_REALITY_ADMISSION_REQUIRED',
    );
    return appendCanonicalObservation({ tenant, observation });
  }

  async function loadIntentEvents() {
    const rows = await prisma.askIntentSignal.findMany({
      where: { tenant },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => {
      const answer = parseJson(row.answerSummary, {});
      return deepFreeze({
        eventId: row.id,
        kind: row.candidateCount === 0 || answer?.zeroState === true ? 'ZERO_RESULTS' : 'ASK',
        provenanceState: 'OBSERVED',
        observedAt: dateIso(row.createdAt),
        evidenceDigest: digest({ id: row.id, tenant: row.tenant, rawQuery: row.rawQuery }, 'ask-intent'),
        dimensions: { market: row.tenant, tenant: row.tenant },
      });
    });
  }

  async function loadVerifiedSupply() {
    const claims = await prisma.marketClaim.findMany({
      where: { tenant, decisionEligible: true, verification: 'VERIFIED' },
      orderBy: { observedAt: 'asc' },
    });
    return claims.map((claim) => {
      const parsed = parseJson(claim.claimValue, claim.claimValue);
      const dimensions = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
      return deepFreeze({
        ...dimensions,
        id: claim.id,
        tenant: claim.tenant,
        entityKey: claim.claimKey,
        claimType: claim.claimType,
        value: parsed,
        epistemicState: 'KNOWN',
        observedAt: dateIso(claim.observedAt),
        expiresAt: claim.freshnessExpiresAt ? dateIso(claim.freshnessExpiresAt) : null,
      });
    });
  }

  async function validateLessonAdmission(lesson) {
    const sessionPrincipal = await resolveVerifiedPrincipal();
    assert(lesson?.lessonId && lesson?.lessonDigest, 'governed lesson identity required', 'LESSON_IDENTITY_REQUIRED');
    const admission = lesson?.admissionReceipt;
    validateReceiptShape(admission, {
      kind: 'LESSON_ADMISSION',
      subjectDigest: lesson.lessonDigest,
    });
    assert(admission.receiptDigest === lesson.admissionDigest, 'lesson admission digest mismatch', 'LESSON_ADMISSION_MISMATCH');
    assert(admission.realm === lesson.evidenceRealm, 'lesson admission realm mismatch', 'LESSON_ADMISSION_REALM_MISMATCH');
    assert(admission.payload?.lessonId === lesson.lessonId, 'lesson admission identity mismatch', 'LESSON_ADMISSION_MISMATCH');
    assert(admission.payload?.valueReceiptDigest === lesson.valueReceiptDigest, 'lesson value lineage mismatch', 'LESSON_VALUE_MISMATCH');
    assert(admission.payload?.verifierReceiptDigest === lesson.verifierReceiptDigest, 'lesson verifier lineage mismatch', 'LESSON_VERIFIER_MISMATCH');
    assert(admission.parentDigests.includes(lesson.valueReceiptDigest), 'lesson value parent missing', 'LESSON_VALUE_MISMATCH');
    assert(admission.parentDigests.includes(lesson.verifierReceiptDigest), 'lesson verifier parent missing', 'LESSON_VERIFIER_MISMATCH');

    const valueReceipt = await resolveCanonicalReceipt({ loadReceipt }, lesson.valueReceiptDigest, {
      kind: 'VALUE',
      subjectDigest: lesson.settlementDigest,
    });
    const verifierReceipt = await resolveCanonicalReceipt({ loadReceipt }, lesson.verifierReceiptDigest, {
      kind: 'VERIFIER',
      subjectDigest: lesson.lessonDigest,
    });
    requireExactEvidenceRealm(valueReceipt, lesson.evidenceRealm);
    requireExactEvidenceRealm(verifierReceipt, lesson.evidenceRealm);
    assert(verifierReceipt.payload?.verifierId === lesson.verifierId, 'lesson verifier identity mismatch', 'LESSON_VERIFIER_MISMATCH');
    assert(['ADMIT', 'REJECT'].includes(verifierReceipt.payload?.verdict), 'lesson verifier verdict invalid', 'LESSON_VERDICT_INVALID');
    assert(['ADMIT', 'REJECT'].includes(admission.payload?.verdict), 'lesson admission verdict invalid', 'LESSON_VERDICT_INVALID');
    if (admission.payload.verdict === 'ADMIT') {
      assert(verifierReceipt.payload.verdict === 'ADMIT', 'lesson admission exceeds verifier verdict', 'LESSON_VERDICT_INVALID');
    }

    const admitted = admission.realm === 'VERIFIED_REAL'
      && admission.payload?.verdict === 'ADMIT'
      && admission.payload?.causalEnough === true
      && admission.payload?.realEnough === true
      && valueReceipt.payload?.settlementClassification === 'CAUSAL_SUPPORTED';
    assert(lesson.trusted === admitted, 'caller-supplied lesson trust does not match canonical admission', 'LESSON_TRUST_MISMATCH');
    assert(
      admitted ? lesson.status === 'ADMITTED' : lesson.status !== 'ADMITTED',
      'lesson status does not match canonical admission',
      'LESSON_STATUS_MISMATCH',
    );
    if (admission.realm === 'VERIFIED_REAL') {
      const principalReceiptDigest = admission.parentDigests.find((receiptDigest) => (
        receiptDigest !== lesson.valueReceiptDigest && receiptDigest !== lesson.verifierReceiptDigest
      ));
      const principal = await requirePrincipalReceipt({ loadReceipt }, principalReceiptDigest, ACTIONS.ADMIT_LESSON);
      assert(principal.subject === sessionPrincipal.subject, 'lesson admission principal mismatch', 'LESSON_PRINCIPAL_MISMATCH');
    } else {
      assert(!admitted, 'non-real lesson cannot be trusted', 'LESSON_REALITY_REQUIRED');
    }
    return admission;
  }

  async function persistLesson(lesson) {
    const admission = await validateLessonAdmission(lesson);
    await persistReceiptCanonical(admission);
    return persistRecord(RECORD_TYPES.LESSON, lesson.lessonId, lesson);
  }

  async function loadLesson(lessonId) {
    return loadRecord(RECORD_TYPES.LESSON, lessonId);
  }

  async function persistPrediction(prediction) {
    return persistRecord(RECORD_TYPES.PREDICTION, prediction?.predictionId, prediction);
  }

  async function persistExperiment(experiment) {
    assert(
      experiment?.contractVersion === REALITY_CELL_CONTRACT_VERSION || experiment?.status !== 'SETTLED',
      'legacy experiment settlement must be recomputed and persisted by the canonical settlement owner',
      'CANA_EXPERIMENT_SETTLEMENT_OWNER_REQUIRED',
    );
    await validateExperimentRecord(experiment);
    return persistRecord(RECORD_TYPES.EXPERIMENT, experiment?.experimentId, experiment);
  }

  async function validateExperimentRecord(experiment) {
    verifyExperimentPreregistration(experiment);
    if (experiment.contractVersion === REALITY_CELL_CONTRACT_VERSION) {
      assert(experiment.tenantId === tenant, 'Reality Cell experiment tenant mismatch', 'REALITY_CELL_TENANT_MISMATCH');
      assert(
        ['PREREGISTERED', 'AUTHORIZED', 'AUTHORIZED_FIXTURE_ONLY'].includes(experiment.status),
        'Reality Cell lifecycle state must remain receipt-derived',
        'REALITY_CELL_LIFECYCLE_RECEIPT_REQUIRED',
      );
      if (experiment.status === 'PREREGISTERED') {
        assert(experiment.authorityBinding === null, 'preregistered Reality Cell cannot claim authority', 'INVALID_AUTHORITY_LINEAGE');
      } else {
        const authority = await requireRealityCellAuthority({
          experiment,
          evidenceAdapter: { loadReceipt },
          authorityBinding: experiment.authorityBinding,
        });
        assert(
          experiment.status === (authority.realWorldExecutionAllowed ? 'AUTHORIZED' : 'AUTHORIZED_FIXTURE_ONLY'),
          'Reality Cell status exceeds authority lineage',
          'INVALID_AUTHORITY_LINEAGE',
        );
      }
      return experiment;
    }
    assert(experiment.evidenceRealm !== 'VERIFIED_REAL', 'legacy experiment cannot claim real evidence', 'INVALID_AUTHORITY_LINEAGE');
    if (experiment.status === 'PROPOSED') return experiment;
    const action = experiment.status === 'AUTHORIZED'
      ? ACTIONS.AUTHORIZE_EXPERIMENT
      : experiment.status === 'RUNNING'
        ? ACTIONS.EXECUTE_EXPERIMENT
        : ACTIONS.SETTLE_EXPERIMENT;
    const authority = await requirePrincipalReceipt(
      { loadReceipt },
      experiment.principalReceiptDigest,
      action,
    );
    assert(authority.subject === experiment.authorizedBy, 'experiment authority subject mismatch', 'INVALID_AUTHORITY_LINEAGE');
    if (experiment.status === 'AUTHORIZED') {
      assert(authority.authorityDigest === experiment.authorityDigest, 'experiment authority digest mismatch', 'INVALID_AUTHORITY_LINEAGE');
    }
    return experiment;
  }

  async function loadExperimentLedger(experimentId) {
    const experiment = await loadRecord(RECORD_TYPES.EXPERIMENT, experimentId);
    assert(experiment?.preRegDigest, 'canonical experiment not found', 'CANA_EXPERIMENT_NOT_FOUND');
    await validateExperimentRecord(experiment);
    const receipts = await receiptStore.findMany({
      where: {
        tenant,
        subjectDigest: experiment.preRegDigest,
        kind: { in: ['ASSIGNMENT', 'EXPOSURE', 'OUTCOME'] },
      },
      orderBy: { issuedAt: 'asc' },
    });
    const ledger = { assignments: [], exposures: [], outcomes: [] };
    for (const row of receipts) {
      if (row.kind === 'ASSIGNMENT') ledger.assignments.push(row.receiptDigest);
      if (row.kind === 'EXPOSURE') ledger.exposures.push(row.receiptDigest);
      if (row.kind === 'OUTCOME') ledger.outcomes.push(row.receiptDigest);
    }
    return deepFreeze(ledger);
  }

  async function loadExperiment(experimentId) {
    const experiment = await loadRecord(RECORD_TYPES.EXPERIMENT, experimentId);
    if (experiment) await validateExperimentRecord(experiment);
    return experiment;
  }

  async function settleLegacyExperiment(experimentId, principalReceiptDigest) {
    const experiment = await loadExperiment(experimentId);
    assert(experiment?.preRegDigest, 'canonical legacy experiment not found', 'CANA_EXPERIMENT_NOT_FOUND');
    assert(experiment.contractVersion !== REALITY_CELL_CONTRACT_VERSION, 'Reality Cell uses its dedicated settlement court', 'CANA_EXPERIMENT_SETTLEMENT_OWNER_MISMATCH');
    const sessionPrincipal = await resolveVerifiedPrincipal();
    const settlementPrincipal = await requirePrincipalReceipt(
      { loadReceipt },
      principalReceiptDigest,
      ACTIONS.SETTLE_EXPERIMENT,
    );
    assert(
      settlementPrincipal.subject === sessionPrincipal.subject,
      'settlement principal does not match the authenticated Owner session',
      'EXPERIMENT_PRINCIPAL_MISMATCH',
    );
    const settlement = await settleExperiment(experiment, {
      loadReceipt,
      loadLesson,
      loadExperimentLedger,
    }, principalReceiptDigest);
    const recordDigest = recordIdentity(tenant, RECORD_TYPES.EXPERIMENT, experimentId, settlement);
    await prisma.$transaction(async (transaction) => {
      await transaction.canaEvidenceReceipt.create({ data: receiptData(tenant, settlement.receipt) });
      await transaction.canaIntelligenceRecord.create({
        data: {
          tenant,
          recordDigest,
          recordType: RECORD_TYPES.EXPERIMENT,
          recordId: experimentId,
          status: settlement.status,
          bodyJson: canonicalJson(settlement),
        },
      });
    });
    return settlement;
  }

  async function validatePromotionLineage(payload, now = new Date()) {
    const sessionPrincipal = await resolveVerifiedPrincipal();
    assert(payload?.candidateDigest, 'promotion candidate digest required', 'PROMOTION_CANDIDATE_REQUIRED');
    assert(['VERIFIED_LOCAL', 'VERIFIED_REAL'].includes(payload?.evidenceRealm), 'canonical promotion realm invalid', 'PROMOTION_REALM_INVALID');
    assert(Array.isArray(payload?.allowedEffectSet) && payload.allowedEffectSet.length > 0, 'promotion effect set required', 'PROMOTION_EFFECT_SET_REQUIRED');
    const candidate = await loadRecord(RECORD_TYPES.EXPERIENCE_CANDIDATE, payload.candidateDigest);
    assert(candidate?.candidateDigest === payload.candidateDigest, 'canonical experience candidate not found', 'EXPERIENCE_CANDIDATE_NOT_FOUND');
    validateCanonicalExperienceCandidateResult(candidate, tenant);
    assert(payload.manifestAfterDigest === candidate.manifestAfterDigest, 'promotion exact result mismatch', 'EXPERIENCE_CANDIDATE_RESULT_MISMATCH');
    const { candidateDigest, ...candidateBody } = candidate;
    assert(digest(candidateBody, 'experience_candidate') === candidateDigest, 'canonical experience candidate digest mismatch', 'CANDIDATE_DIGEST_MISMATCH');
    assert(candidate.operations.every(({ type }) => payload.allowedEffectSet.includes(type)), 'promotion effect set does not cover candidate', 'PROMOTION_EFFECT_SET_MISMATCH');
    const principalReceipt = await resolveCanonicalReceipt({ loadReceipt }, payload.principalReceiptDigest, {
      kind: 'PRINCIPAL',
      minimumRealm: 'VERIFIED_LOCAL',
      now,
    });
    const principal = await requirePrincipalReceipt({ loadReceipt }, principalReceipt.receiptDigest, ACTIONS.EXECUTE_EXPERIENCE_CANDIDATE);
    assert(principal.subject === sessionPrincipal.subject, 'promotion principal does not match authenticated Owner', 'PROMOTION_PRINCIPAL_MISMATCH');
    assert(principalReceipt.issuer === 'canonical-owner-session', 'promotion principal issuer invalid', 'INVALID_AUTHORITY_LINEAGE');
    assert(principalReceipt.payload?.verifiedBy === 'canonical-assertAdmin', 'promotion principal lineage invalid', 'INVALID_AUTHORITY_LINEAGE');

    const receiptRequirements = [
      ['PRIVATE_PREVIEW', payload.previewReceiptDigest],
      ['BROWSER_OBSERVATION', payload.browserObservationReceiptDigest],
      ['COURT', payload.browserCourtReceiptDigest],
      ['COURT', payload.realityCourtReceiptDigest],
      ['ROLLBACK', payload.rollbackReceiptDigest],
    ];
    const [preview, browserObservation, browserCourt, realityCourt, rollback] = await Promise.all(
      receiptRequirements.map(([kind, receiptDigest]) => resolveCanonicalReceipt({ loadReceipt }, receiptDigest, {
        kind,
        subjectDigest: payload.candidateDigest,
        now,
      })),
    );
    for (const receipt of [preview, browserObservation, browserCourt, realityCourt, rollback]) {
      requireExactEvidenceRealm(receipt, payload.evidenceRealm);
    }
    validateBrowserObservationReceipt(browserObservation, {
      candidateDigest: payload.candidateDigest,
      route: candidate.target,
      evidenceRealm: payload.evidenceRealm,
    });
    assert(browserCourt.payload?.court === 'BROWSER' && browserCourt.payload?.verdict === 'PASS', 'browser court not passed', 'EXPERIENCE_BROWSER_COURT_FAILED');
    assert(browserCourt.payload?.observationReceiptDigest === browserObservation.receiptDigest, 'browser court observation mismatch', 'EXPERIENCE_BROWSER_OBSERVATION_MISMATCH');
    assert(realityCourt.payload?.court === 'REALITY' && realityCourt.payload?.verdict === 'PASS', 'reality court not passed', 'EXPERIENCE_REALITY_COURT_FAILED');
    assert(rollback.payload?.rollbackContractDigest || rollback.payload?.targetVersion, 'rollback receipt incomplete', 'EXPERIENCE_ROLLBACK_INCOMPLETE');

    if (payload.experimentId || payload.merchantAuthorizationReceiptDigest) {
      assert(payload.evidenceRealm === 'VERIFIED_REAL', 'Reality Cell promotion requires real evidence', 'REALITY_CELL_REAL_AUTHORITY_REQUIRED');
      const experiment = await loadExperiment(payload.experimentId);
      assert(experiment?.preregistrationDigest, 'canonical Reality Cell experiment not found', 'CANA_EXPERIMENT_NOT_FOUND');
      assert(experiment.tenantId === tenant && payload.tenantId === tenant, 'promotion tenant mismatch', 'REALITY_CELL_TENANT_MISMATCH');
      assert(experiment.merchantId === payload.merchantId, 'promotion merchant mismatch', 'MERCHANT_AUTHORITY_MISMATCH');
      assert(experiment.preregistrationDigest === payload.preregistrationDigest, 'promotion preregistration mismatch', 'INVALID_AUTHORITY_LINEAGE');
      assert(experiment.treatmentDefinition?.candidateDigest === payload.candidateDigest, 'promotion candidate mismatch', 'CANDIDATE_DIGEST_MISMATCH');
      assert(rollback.payload?.rollbackContractDigest === experiment.rollbackContract?.digest, 'rollback contract mismatch', 'EXPERIENCE_ROLLBACK_MISMATCH');
      await requireRealityCellAuthority({
        experiment,
        evidenceAdapter: { loadReceipt },
        authorityBinding: {
          experimentId: payload.experimentId,
          preregistrationDigest: payload.preregistrationDigest,
          candidateDigest: payload.candidateDigest,
          ownerPrincipalReceiptDigest: payload.principalReceiptDigest,
          merchantAuthorizationReceiptDigest: payload.merchantAuthorizationReceiptDigest,
          allowedEffectSet: payload.allowedEffectSet,
          rollbackContractDigest: payload.rollbackContractDigest,
          expiresAt: payload.expiresAt,
          evidenceRealm: payload.evidenceRealm,
          realWorldExecutionAllowed: true,
        },
        now,
      });
    } else {
      assert(!payload.preregistrationDigest && !payload.merchantId && !payload.tenantId, 'partial Reality Cell promotion forbidden', 'INVALID_AUTHORITY_LINEAGE');
    }
  }

  async function persistPromotionReceipt(payload) {
    await validatePromotionLineage(payload);
    const receipt = makeReceipt({
      kind: 'PROMOTION',
      subjectDigest: payload?.candidateDigest,
      realm: payload?.evidenceRealm ?? 'VERIFIED_LOCAL',
      issuer: 'canonical-experience-promotion-court',
      payload,
      parentDigests: [
        payload?.principalReceiptDigest,
        payload?.merchantAuthorizationReceiptDigest,
        payload?.previewReceiptDigest,
        payload?.browserObservationReceiptDigest,
        payload?.browserCourtReceiptDigest,
        payload?.realityCourtReceiptDigest,
        payload?.rollbackReceiptDigest,
      ].filter(Boolean),
    });
    await persistReceiptCanonical(receipt);
    return receipt;
  }

  function promotionExecutionClaim({ promotion, candidate, principal }) {
    validateReceiptShape(promotion, { kind: 'PROMOTION', subjectDigest: candidate?.candidateDigest });
    return makeReceipt({
      kind: 'EXPERIENCE_EXECUTION',
      subjectDigest: promotion.receiptDigest,
      realm: promotion.realm,
      issuer: 'canonical-experience-execution-claim',
      issuedAt: promotion.issuedAt,
      parentDigests: [promotion.receiptDigest, principal?.principalReceiptDigest].filter(Boolean),
      payload: {
        promotionReceiptDigest: promotion.receiptDigest,
        candidateDigest: candidate?.candidateDigest,
        principalReceiptDigest: principal?.principalReceiptDigest,
      },
    });
  }

  function promotedManifestRecord({ promotion, candidate, execution }) {
    const journey = EXPERIENCE_JOURNEY_BY_ROUTE[candidate?.target];
    assert(journey, 'candidate target is not a canonical customer journey', 'EXPERIENCE_RUNTIME_JOURNEY_REQUIRED');
    validateCanonicalExperienceCandidateResult(candidate, tenant);
    assert(execution?.appliedManifestDigest === candidate.manifestAfterDigest, 'executor result does not match exact candidate', 'EXPERIENCE_EXECUTION_RESULT_MISMATCH');
    if (execution?.promotedManifest !== undefined) {
      assert(canonicalJson(execution.promotedManifest) === canonicalJson(candidate.manifestAfter), 'executor manifest differs from exact candidate', 'EXPERIENCE_EXECUTION_RESULT_MISMATCH');
    }
    const manifest = structuredClone(candidate.manifestAfter);
    assertManifest(manifest);
    assert(
      manifest.merchant?.identity?.tenant === tenant,
      'promoted manifest tenant does not match canonical host',
      'EXPERIENCE_RUNTIME_TENANT_MISMATCH',
    );
    assert(
      manifest.merchant?.journey === journey && manifest.presentation?.journey === journey,
      'promoted manifest journey does not match candidate target',
      'EXPERIENCE_RUNTIME_JOURNEY_MISMATCH',
    );
    manifest.promotion = {
      receiptDigest: promotion.receiptDigest,
      candidateDigest: candidate.candidateDigest,
      manifestAfterDigest: candidate.manifestAfterDigest,
      evidenceRealm: promotion.realm,
    };
    assertManifest(manifest);
    const recordType = 'EXPERIENCE_MANIFEST';
    const recordId = `journey:${journey}`;
    const recordDigest = recordIdentity(tenant, recordType, recordId, manifest);
    return {
      recordDigest,
      data: {
        tenant,
        recordDigest,
        recordType,
        recordId,
        status: 'PROMOTED',
        bodyJson: canonicalJson(manifest),
      },
    };
  }

  async function enumerateExperienceSurfaces() {
    if (typeof experience.enumerateExperienceSurfaces === 'function') {
      return experience.enumerateExperienceSurfaces();
    }
    return CANONICAL_EXPERIENCE_SURFACES;
  }

  async function loadExperienceManifest(surface) {
    if (typeof experience.loadExperienceManifest === 'function') {
      return experience.loadExperienceManifest(surface);
    }
    const route = typeof surface === 'string' ? surface : surface?.route;
    const journey = EXPERIENCE_JOURNEY_BY_ROUTE[route];
    assert(journey, 'surface is not a canonical customer journey', 'EXPERIENCE_RUNTIME_JOURNEY_REQUIRED');
    return resolveRuntimeExperienceManifest({ receiptStore, recordStore, tenant, journey });
  }

  async function persistExperienceCandidate(candidate) {
    assert(candidate?.candidateId && candidate?.candidateDigest, 'experience candidate identity required', 'EXPERIENCE_CANDIDATE_INCOMPLETE');
    const { candidateDigest, ...body } = candidate;
    assert(digest(body, 'experience_candidate') === candidateDigest, 'experience candidate digest mismatch', 'CANDIDATE_DIGEST_MISMATCH');
    assert(candidate.status === 'CANDIDATE_ONLY' && candidate.mayExecute === false && candidate.mayPublish === false, 'experience candidate authority boundary invalid', 'EXPERIENCE_CANDIDATE_AUTHORITY_INVALID');
    if (candidate.manifestAfter !== null || candidate.manifestAfterDigest !== null) validateCanonicalExperienceCandidateResult(candidate, tenant);
    assert(EXPERIENCE_JOURNEY_BY_ROUTE[candidate.target], 'candidate target is not a canonical customer journey', 'EXPERIENCE_RUNTIME_JOURNEY_REQUIRED');
    if (candidate.tenantId) assert(candidate.tenantId === tenant, 'candidate tenant mismatch', 'REALITY_CELL_TENANT_MISMATCH');
    return persistRecord(RECORD_TYPES.EXPERIENCE_CANDIDATE, candidate.candidateDigest, candidate);
  }

  async function executeWithPromotionClaim({ promotion, candidate, principal, executionInput }) {
    const sessionPrincipal = await resolveVerifiedPrincipal();
    const canonicalCandidate = await loadRecord(RECORD_TYPES.EXPERIENCE_CANDIDATE, candidate?.candidateDigest);
    assert(canonicalCandidate, 'canonical experience candidate not found', 'EXPERIENCE_CANDIDATE_NOT_FOUND');
    assertExactReplay(canonicalCandidate, candidate, 'CANDIDATE_DIGEST_MISMATCH');
    const canonicalPromotion = await resolveCanonicalReceipt({ loadReceipt }, promotion?.receiptDigest, {
      kind: 'PROMOTION',
      subjectDigest: candidate.candidateDigest,
    });
    assertExactReplay(canonicalPromotion, promotion, 'PROMOTION_DIGEST_MISMATCH');
    const canonicalPrincipal = await requirePrincipalReceipt(
      { loadReceipt },
      principal?.principalReceiptDigest,
      ACTIONS.EXECUTE_EXPERIENCE_CANDIDATE,
    );
    assert(
      sessionPrincipal.subject === principal?.subject
        && canonicalPrincipal.subject === sessionPrincipal.subject
        && canonicalPromotion.payload?.principalReceiptDigest === principal.principalReceiptDigest,
      'promotion execution principal does not match the authenticated Owner session',
      'PROMOTION_PRINCIPAL_MISMATCH',
    );
    assert(
      candidate.operations.every(({ type }) => canonicalPromotion.payload?.allowedEffectSet?.includes(type)),
      'promotion effect set does not cover candidate',
      'PROMOTION_EFFECT_SET_MISMATCH',
    );
    assert(
      !canonicalPromotion.payload?.expiresAt
        || new Date(canonicalPromotion.payload.expiresAt).getTime() >= Date.now(),
      'promotion receipt expired',
      'PROMOTION_EXPIRED',
    );
    assert(typeof prisma.$transaction === 'function', 'canonical transactional execution required', 'PROMOTION_ATOMIC_EXECUTION_REQUIRED');
    const execute = requireExperience('executeAuthorizedExperienceCandidate');
    const claim = promotionExecutionClaim({ promotion, candidate, principal });
    await prisma.$transaction(async (transaction) => {
      try {
        await transaction.canaEvidenceReceipt.create({ data: receiptData(tenant, claim) });
      } catch (error) {
        if (error?.code === 'P2002') {
          assert(false, 'promotion receipt already consumed', 'PROMOTION_REPLAYED');
        }
        throw error;
      }
    });
    const execution = await execute(executionInput);
    assert(
      execution?.idempotencyKey === promotion.receiptDigest,
      'canonical executor must confirm the promotion-bound idempotency key',
      'EXPERIENCE_EXECUTION_IDEMPOTENCY_REQUIRED',
    );
    const record = promotedManifestRecord({ promotion, candidate, execution });
    await prisma.$transaction(async (transaction) => {
      await transaction.canaIntelligenceRecord.create({ data: record.data });
    });
    return execution;
  }

  const requireExperience = (name) => {
    const fn = experience?.[name];
    assert(typeof fn === 'function', `canonical Experience Fabric owner missing ${name}`, 'CANONICAL_EXPERIENCE_OWNER_REQUIRED');
    return fn;
  };

  return Object.freeze({
    loadObservations,
    appendObservation,
    loadIntentEvents,
    loadVerifiedSupply,
    resolveVerifiedPrincipal,
    persistReceipt,
    admitEconomicObservation,
    settleLegacyValueReceipt,
    settleRealityCellValueReceipt,
    persistLesson,
    persistPrediction,
    persistExperiment,
    loadReceipt,
    loadLesson,
    loadExperimentLedger,
    loadExperiment,
    settleLegacyExperiment,
    resolveVerifiedPrincipalReceipt,
    persistPromotionReceipt,
    executeWithPromotionClaim,
    enumerateExperienceSurfaces,
    loadExperienceManifest,
    persistExperienceCandidate,
    renderPrivatePreview: (...args) => requireExperience('renderPrivatePreview')(...args),
    captureRenderedEvidenceReceipt: (...args) => (
      typeof experience.captureRenderedEvidenceReceipt === 'function'
        ? experience.captureRenderedEvidenceReceipt(...args)
        : null
    ),
    generateMediaCandidate: (...args) => requireExperience('generateMediaCandidate')(...args),
    rollbackExperienceVersion: (...args) => requireExperience('rollbackExperienceVersion')(...args),
  });
}
