import { createHash } from 'node:crypto';

import { PROTECTED_PATHS } from '../../../../tools/experience-fabric/kernel.mjs';

export const EXPERIENCE_REVIEW_SOURCE_KINDS = Object.freeze([
  'SITEMIND',
  'MERCHANT_MEDIA',
  'EXPERIENCE_FABRIC',
]);

const RIGHTS_STATES = new Set(['VERIFIED', 'NOT_APPLICABLE', 'MISSING', 'UNKNOWN']);
const ACCESSIBILITY_STATES = new Set(['PASS', 'NOT_TESTED', 'FAIL']);
const POLICY_STATES = new Set(['PASS', 'FAIL']);
const UNCERTAINTY_STATES = new Set(['BOUNDED', 'UNKNOWN', 'CLAIMED_OUTCOME']);
const SHA256 = /^[a-f0-9]{64}$/;
const COMMIT_SHA = /^[a-f0-9]{40}$/;
const SCOPE = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/;
const REVISION = /^[a-zA-Z0-9][a-zA-Z0-9._:@/+\-]{0,199}$/;
const MAX_SOURCE_PROOF_BYTES = 256 * 1024;

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]),
    );
  }
  return value;
}

function canonical(value) {
  return JSON.stringify(sortKeys(value));
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export class CandidateCompileError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = 'CandidateCompileError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new CandidateCompileError(code, message);
}

function requireText(value, code, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(code, `${label} is required.`);
  }
  return value;
}

function requireSha256(value, label) {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    fail('SHA256_INVALID', `${label} must be a lowercase 64-character SHA-256 digest.`);
  }
  return value;
}

function requireCommitSha(value, label) {
  if (typeof value !== 'string' || !COMMIT_SHA.test(value)) {
    fail('COMMIT_SHA_INVALID', `${label} must be a lowercase 40-character Git object ID.`);
  }
  return value;
}

function normalizeArtifact(value) {
  requireText(value, 'SOURCE_ARTIFACT_INVALID', 'sourceArtifact');
  if (
    value !== value.trim()
    || value.startsWith('/')
    || value.includes('\\')
    || value.includes('?')
    || value.includes('#')
    || value.split('/').some((part) => part === '..' || part === '')
  ) {
    fail('SOURCE_ARTIFACT_INVALID', 'sourceArtifact must be an exact repository-relative artifact path.');
  }
  return value;
}

function normalizeScope(value, label) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !SCOPE.test(value)) {
    fail('SCOPE_INVALID', `${label} must be a bounded canonical identifier.`);
  }
  return value;
}

function normalizeRevision(value) {
  if (typeof value !== 'string' || !REVISION.test(value)) {
    fail('SOURCE_REVISION_INVALID', 'sourceRevision must be a bounded canonical revision identifier.');
  }
  return value;
}

function boundedSourceObject(value, label, { optional = false } = {}) {
  if ((value === undefined || value === null) && optional) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('SOURCE_OUTPUT_INVALID', `${label} must be a source-owned object.`);
  }
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    fail('SOURCE_OUTPUT_INVALID', `${label} must be JSON serializable.`);
  }
  if (typeof serialized !== 'string' || Buffer.byteLength(serialized) > MAX_SOURCE_PROOF_BYTES) {
    fail('SOURCE_OUTPUT_TOO_LARGE', `${label} exceeds the 256 KiB compiler boundary.`);
  }
  return value;
}

function normalizeEvidenceRefs(refs) {
  if (!Array.isArray(refs) || refs.length === 0) {
    fail('EVIDENCE_REFS_INVALID', 'At least one digest-addressed evidence reference is required.');
  }
  const normalized = refs.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      fail('EVIDENCE_REFS_INVALID', 'Each evidence reference must be an object.');
    }
    const keys = Object.keys(item).sort();
    if (keys.length !== 2 || keys[0] !== 'ref' || keys[1] !== 'sha256') {
      fail('EVIDENCE_REFS_INVALID', 'Evidence references may contain only ref and sha256.');
    }
    const ref = normalizeArtifact(item.ref);
    return Object.freeze({ ref, sha256: requireSha256(item.sha256, `evidenceRefs[${ref}].sha256`) });
  });
  normalized.sort((left, right) => (
    left.ref.localeCompare(right.ref) || left.sha256.localeCompare(right.sha256)
  ));
  const identities = normalized.map(({ ref }) => ref);
  if (new Set(identities).size !== identities.length) {
    fail('EVIDENCE_REFS_INVALID', 'Evidence reference paths must be unique.');
  }
  return normalized;
}

export function evidenceRefsSha256(refs) {
  return sha256(canonical(normalizeEvidenceRefs(refs)));
}

export function sourceProofSha256(proof) {
  return sha256(canonical(boundedSourceObject(proof, 'sourceProof')));
}

function normalizeEnvelope(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('ENVELOPE_REQUIRED', 'A source envelope is required.');
  }
  if (!EXPERIENCE_REVIEW_SOURCE_KINDS.includes(input.sourceKind)) {
    fail('SOURCE_KIND_INVALID', `sourceKind must be ${EXPERIENCE_REVIEW_SOURCE_KINDS.join('|')}.`);
  }
  if (input.externalEffects !== 0) {
    fail('EXTERNAL_EFFECTS_FORBIDDEN', 'externalEffects must be exactly numeric zero.');
  }
  if (typeof input.tenant !== 'string' || !SCOPE.test(input.tenant)) {
    fail('TENANT_REQUIRED', 'tenant must be a canonical identifier.');
  }
  const evidenceRefs = normalizeEvidenceRefs(input.evidenceRefs);
  const evidenceSha = requireSha256(input.evidenceSha256, 'evidenceSha256');
  if (evidenceSha !== sha256(canonical(evidenceRefs))) {
    fail('EVIDENCE_DIGEST_MISMATCH', 'evidenceSha256 does not match the canonical evidence references.');
  }
  if (!RIGHTS_STATES.has(input.rightsState)) fail('RIGHTS_STATE_INVALID', 'rightsState is invalid.');
  if (!ACCESSIBILITY_STATES.has(input.accessibilityState)) fail('ACCESSIBILITY_STATE_INVALID', 'accessibilityState is invalid.');
  if (!POLICY_STATES.has(input.policyState)) fail('POLICY_STATE_INVALID', 'policyState is invalid.');
  if (!UNCERTAINTY_STATES.has(input.uncertaintyState)) fail('UNCERTAINTY_STATE_INVALID', 'uncertaintyState is invalid.');

  return Object.freeze({
    sourceKind: input.sourceKind,
    sourceArtifact: normalizeArtifact(input.sourceArtifact),
    sourceArtifactSha256: requireSha256(input.sourceArtifactSha256, 'sourceArtifactSha256'),
    sourceRevision: normalizeRevision(input.sourceRevision),
    sourceTreeSha: requireCommitSha(input.sourceTreeSha, 'sourceTreeSha'),
    repositoryCommitSha: requireCommitSha(input.repositoryCommitSha, 'repositoryCommitSha'),
    tenant: input.tenant,
    siteId: normalizeScope(input.siteId, 'siteId'),
    merchantId: normalizeScope(input.merchantId, 'merchantId'),
    payloadSha256: requireSha256(input.payloadSha256, 'payloadSha256'),
    evidenceRefs,
    evidenceSha256: evidenceSha,
    rightsState: input.rightsState,
    accessibilityState: input.accessibilityState,
    policyState: input.policyState,
    uncertaintyState: input.uncertaintyState,
    sourceOutput: boundedSourceObject(input.sourceOutput, 'sourceOutput'),
    sourceEvidence: boundedSourceObject(input.sourceEvidence, 'sourceEvidence', { optional: true }),
    sourceReceipt: boundedSourceObject(input.sourceReceipt, 'sourceReceipt', { optional: true }),
  });
}

function stableIdentity(envelope) {
  return {
    sourceKind: envelope.sourceKind,
    sourceArtifact: envelope.sourceArtifact,
    sourceArtifactSha256: envelope.sourceArtifactSha256,
    sourceRevision: envelope.sourceRevision,
    sourceTreeSha: envelope.sourceTreeSha,
    repositoryCommitSha: envelope.repositoryCommitSha,
    tenant: envelope.tenant,
    siteId: envelope.siteId,
    merchantId: envelope.merchantId,
  };
}

export function experienceReviewIdempotencyKey(input) {
  const envelope = normalizeEnvelope(input);
  return `erc_${sha256(canonical(stableIdentity(envelope)))}`;
}

function returned(...reasonCodes) {
  return Object.freeze({
    outcome: 'RETURNED_FOR_EVIDENCE',
    decisionEligible: false,
    reasonCodes: Object.freeze([...new Set(reasonCodes)]),
  });
}

function sourceCourt(envelope) {
  const output = envelope.sourceOutput;

  if (envelope.rightsState === 'MISSING' || envelope.rightsState === 'UNKNOWN') {
    return returned('RIGHTS_EVIDENCE_REQUIRED');
  }
  if (envelope.policyState !== 'PASS') return returned('POLICY_COURT_FAILED');
  if (envelope.accessibilityState === 'FAIL') return returned('ACCESSIBILITY_COURT_FAILED');
  if (envelope.uncertaintyState === 'CLAIMED_OUTCOME') return returned('ECONOMIC_OUTCOME_UNVERIFIED');

  if (envelope.sourceKind === 'SITEMIND') {
    const actionPlane = output.planes?.find(({ name }) => name === 'Action');
    if (
      !Number.isSafeInteger(output.schemaVersion)
      || output.schemaVersion < 1
      || !SHA256.test(output.fingerprint ?? '')
      || output.fingerprint !== envelope.payloadSha256
      || output.localEvidenceStatus !== 'AVAILABLE'
      || actionPlane?.status !== 'GUARDED'
      || !Array.isArray(output.observations)
      || output.observationCount !== output.observations.length
    ) {
      return returned('SITEMIND_SNAPSHOT_UNVERIFIED');
    }
    return null;
  }

  if (envelope.sourceKind === 'MERCHANT_MEDIA') {
    const evidence = envelope.sourceEvidence;
    const approvedTextVerdicts = new Set(['CLEAN', 'TEXT_PRESENT_NON_OFFER']);
    if (!evidence) return returned('MEDIA_COURT_UNVERIFIED');
    const rights = evidence.rightsAttestation;
    const imageTextCourt = evidence.imageTextCourt;
    const evidenceDigest = sha256(canonical(evidence));
    if (!envelope.evidenceRefs.some(({ sha256: digest }) => digest === evidenceDigest)) {
      return returned('MEDIA_EVIDENCE_UNBOUND');
    }
    if (
      envelope.rightsState !== 'VERIFIED'
      || typeof rights?.holder !== 'string'
      || rights.holder.trim() === ''
      || typeof rights?.scope !== 'string'
      || rights.scope.trim() === ''
      || Number.isNaN(Date.parse(rights?.granted_at))
    ) return returned('RIGHTS_EVIDENCE_REQUIRED');
    if (output.state !== 'APPROVED') return returned('MEDIA_COURT_NOT_APPROVED');
    if (!Array.isArray(output.reasons) || output.reasons.length !== 0) return returned('MEDIA_COURT_NOT_APPROVED');
    if (
      !approvedTextVerdicts.has(imageTextCourt?.verdict)
      || Number.isNaN(Date.parse(imageTextCourt?.decided_at))
    ) return returned('IMAGE_TEXT_COURT_UNVERIFIED');
    return null;
  }

  const receipt = envelope.sourceReceipt;
  const oracleResults = output.court?.results;
  if (!receipt || receipt.kind !== 'PRIVATE_MUTATION') return returned('FABRIC_COURT_UNVERIFIED');
  if (!/^xs_[a-f0-9]{20}$/.test(output.candidate ?? '')) return returned('FABRIC_CANDIDATE_UNVERIFIED');
  if (output.court?.verdict !== 'PASS') return returned('FABRIC_ORACLE_FAILURE');
  if (!Array.isArray(oracleResults) || oracleResults.length === 0 || oracleResults.some(({ status }) => status !== 'PASS')) {
    return returned('FABRIC_ORACLE_FAILURE');
  }
  const requiredOracles = ['ACCESSIBILITY', 'POLICY', 'ECONOMIC-TRUTH'];
  if (!requiredOracles.every((oracle) => oracleResults.some((result) => result.oracle === oracle && result.status === 'PASS'))) {
    return returned('FABRIC_ORACLE_FAILURE');
  }
  const economicOracle = oracleResults.find(({ oracle }) => oracle === 'ECONOMIC-TRUTH');
  if (!/UNKNOWN/.test(economicOracle?.detail ?? '')) return returned('ECONOMIC_OUTCOME_UNVERIFIED');
  const changedPaths = receipt.changed_paths;
  if (!Array.isArray(changedPaths) || changedPaths.some((path) => (
    PROTECTED_PATHS.some((guard) => path === guard || path.startsWith(`${guard}.`))
  ))) return returned('PROTECTED_PATH_MUTATION');
  if (
    receipt.candidate !== output.candidate
    || receipt.hash !== output.receipt_hash
    || canonical(receipt.court) !== canonical(output.court)
  ) return returned('FABRIC_RECEIPT_MISMATCH');
  if (receipt.promoted !== false) return returned('FABRIC_PROMOTION_FORBIDDEN');
  const { hash, ...receiptBody } = receipt;
  if (sha256(canonical({ ...receiptBody, hash: undefined })) !== hash) {
    return returned('FABRIC_RECEIPT_INVALID');
  }
  if (!envelope.evidenceRefs.some(({ sha256: digest }) => digest === receipt.hash)) {
    return returned('FABRIC_EVIDENCE_UNBOUND');
  }
  if (envelope.payloadSha256 !== output.receipt_hash) return returned('FABRIC_PAYLOAD_UNBOUND');
  return null;
}

function persistenceData(envelope, idempotencyKey) {
  return {
    tenant: envelope.tenant,
    siteId: envelope.siteId,
    merchantId: envelope.merchantId,
    sourceKind: envelope.sourceKind,
    sourceArtifact: envelope.sourceArtifact,
    sourceArtifactSha256: envelope.sourceArtifactSha256,
    sourceRevision: envelope.sourceRevision,
    sourceTreeSha: envelope.sourceTreeSha,
    repositoryCommitSha: envelope.repositoryCommitSha,
    payloadSha256: envelope.payloadSha256,
    evidenceRefs: canonical(envelope.evidenceRefs),
    rightsState: envelope.rightsState,
    accessibilityState: envelope.accessibilityState,
    policyState: envelope.policyState,
    uncertaintyState: envelope.uncertaintyState,
    idempotencyKey,
    version: 1,
    lifecycle: 'PENDING_REVIEW',
  };
}

function candidateMatches(candidate, data) {
  return Object.entries(data).every(([key, value]) => (
    key === 'lifecycle' || candidate[key] === value
  ));
}

async function resolveReplay(model, data) {
  const existing = await model.findUnique({ where: { idempotencyKey: data.idempotencyKey } });
  if (!existing) return null;
  if (!candidateMatches(existing, data)) {
    fail('IDEMPOTENCY_CONFLICT', 'The stable source identity already exists with a different envelope or payload.');
  }
  return existing;
}

export async function compileExperienceReviewCandidate(
  { experienceReviewCandidate, isKnownTenant },
  input,
) {
  if (
    !experienceReviewCandidate
    || typeof experienceReviewCandidate.findUnique !== 'function'
    || typeof experienceReviewCandidate.create !== 'function'
  ) {
    fail('PERSISTENCE_REQUIRED', 'An injected Prisma experienceReviewCandidate model is required.');
  }
  if (typeof isKnownTenant !== 'function') {
    fail('TENANT_RESOLVER_REQUIRED', 'An injected tenant resolver is required.');
  }

  const envelope = normalizeEnvelope(input);
  if (await isKnownTenant(envelope.tenant) !== true) {
    return Object.freeze({ outcome: 'REFUSED', decisionEligible: false, reasonCodes: Object.freeze(['UNKNOWN_TENANT']) });
  }
  const courtResult = sourceCourt(envelope);
  if (courtResult) return courtResult;

  const idempotencyKey = `erc_${sha256(canonical(stableIdentity(envelope)))}`;
  const data = persistenceData(envelope, idempotencyKey);
  const replay = await resolveReplay(experienceReviewCandidate, data);
  if (replay) {
    return Object.freeze({ outcome: 'IDEMPOTENT_REPLAY', decisionEligible: replay.lifecycle === 'PENDING_REVIEW', candidate: replay });
  }

  let candidate;
  try {
    candidate = await experienceReviewCandidate.create({ data });
  } catch (error) {
    if (error?.code !== 'P2002') throw error;
    candidate = await resolveReplay(experienceReviewCandidate, data);
    if (!candidate) throw error;
    return Object.freeze({ outcome: 'IDEMPOTENT_REPLAY', decisionEligible: candidate.lifecycle === 'PENDING_REVIEW', candidate });
  }
  return Object.freeze({ outcome: 'QUEUED_FOR_OWNER_REVIEW', decisionEligible: true, candidate });
}
