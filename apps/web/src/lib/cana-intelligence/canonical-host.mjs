import { ACTIONS } from './authority.mjs';
import {
  assert,
  canonicalJson,
  deepFreeze,
  digest,
} from './core.mjs';
import {
  makeReceipt,
  validateReceiptShape,
} from './receipts.mjs';

const PRINCIPAL_ACTIONS = Object.freeze(Object.values(ACTIONS));
const RECORD_TYPES = Object.freeze({
  LESSON: 'LESSON',
  PREDICTION: 'PREDICTION',
  EXPERIMENT: 'EXPERIMENT',
});

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
  experience = {},
} = {}) {
  assert(prisma && typeof prisma === 'object', 'canonical Prisma client required', 'CANA_HOST_PRISMA_REQUIRED');
  assert(typeof assertAdmin === 'function', 'canonical assertAdmin required', 'CANA_HOST_AUTH_REQUIRED');
  assert(typeof tenant === 'string' && tenant.trim(), 'canonical tenant required', 'CANA_HOST_TENANT_REQUIRED');

  const receiptStore = requireDelegate(prisma, 'canaEvidenceReceipt');
  const recordStore = requireDelegate(prisma, 'canaIntelligenceRecord');

  async function persistReceipt(receipt) {
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

  async function loadReceipt(receiptDigest) {
    assert(receiptDigest, 'receipt digest required', 'RECEIPT_DIGEST_REQUIRED');
    return receiptFromRow(await receiptStore.findUnique({
      where: { tenant_receiptDigest: { tenant, receiptDigest } },
    }));
  }

  async function persistRecord(recordType, recordId, body) {
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
    await persistReceipt(receipt);
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

  async function persistLesson(lesson) {
    return persistRecord(RECORD_TYPES.LESSON, lesson?.lessonId, lesson);
  }

  async function loadLesson(lessonId) {
    return loadRecord(RECORD_TYPES.LESSON, lessonId);
  }

  async function persistPrediction(prediction) {
    return persistRecord(RECORD_TYPES.PREDICTION, prediction?.predictionId, prediction);
  }

  async function persistExperiment(experiment) {
    return persistRecord(RECORD_TYPES.EXPERIMENT, experiment?.experimentId, experiment);
  }

  async function loadExperimentLedger(experimentId) {
    const experiment = await loadRecord(RECORD_TYPES.EXPERIMENT, experimentId);
    assert(experiment?.preRegDigest, 'canonical experiment not found', 'CANA_EXPERIMENT_NOT_FOUND');
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

  async function persistPromotionReceipt(payload) {
    const receipt = makeReceipt({
      kind: 'PROMOTION',
      subjectDigest: payload?.candidateDigest,
      realm: 'VERIFIED_LOCAL',
      issuer: 'canonical-experience-promotion-court',
      payload,
      parentDigests: [
        payload?.principalReceiptDigest,
        payload?.previewReceiptDigest,
        payload?.browserCourtReceiptDigest,
        payload?.realityCourtReceiptDigest,
        payload?.rollbackReceiptDigest,
      ].filter(Boolean),
    });
    await persistReceipt(receipt);
    return receipt;
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
    persistLesson,
    persistPrediction,
    persistExperiment,
    loadReceipt,
    loadLesson,
    loadExperimentLedger,
    resolveVerifiedPrincipalReceipt,
    persistPromotionReceipt,
    enumerateExperienceSurfaces: (...args) => (
      typeof experience.enumerateExperienceSurfaces === 'function'
        ? experience.enumerateExperienceSurfaces(...args)
        : []
    ),
    loadExperienceManifest: (...args) => (
      typeof experience.loadExperienceManifest === 'function'
        ? experience.loadExperienceManifest(...args)
        : null
    ),
    persistExperienceCandidate: (...args) => requireExperience('persistExperienceCandidate')(...args),
    renderPrivatePreview: (...args) => requireExperience('renderPrivatePreview')(...args),
    captureRenderedEvidenceReceipt: (...args) => requireExperience('captureRenderedEvidenceReceipt')(...args),
    generateMediaCandidate: (...args) => requireExperience('generateMediaCandidate')(...args),
    executeAuthorizedExperienceCandidate: (...args) => requireExperience('executeAuthorizedExperienceCandidate')(...args),
    rollbackExperienceVersion: (...args) => requireExperience('rollbackExperienceVersion')(...args),
  });
}
