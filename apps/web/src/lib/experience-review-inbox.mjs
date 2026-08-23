import { createHash } from 'node:crypto';

export const EXPERIENCE_REVIEW_INBOX_PAGE_SIZE = 12;
export const EXPERIENCE_REVIEW_INBOX_MAX_PAGE = 1_000;

export const EXPERIENCE_REVIEW_CLOSED_STATES = Object.freeze([
  'APPROVED_FOR_DRAFT_ONLY',
  'REJECTED',
  'RETURNED_FOR_EVIDENCE',
]);

const INBOX_PAGE_KEYS = Object.freeze(['pendingPage', 'reviewedPage']);
const DECISION_REASON_CODES = Object.freeze({
  APPROVED_FOR_DRAFT_ONLY: 'OWNER_DRAFT_APPROVED',
  REJECTED: 'OWNER_REJECTED',
  RETURNED_FOR_EVIDENCE: 'OWNER_EVIDENCE_REQUIRED',
});
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_ARTIFACT = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*[\\?#])[A-Za-z0-9._:@+\-/]{1,512}$/;

export class ExperienceReviewInboxError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = 'ExperienceReviewInboxError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new ExperienceReviewInboxError(code, message);
}

function firstValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function pageNumber(value) {
  const first = firstValue(value);
  if (Number.isSafeInteger(first) && first >= 1) {
    return Math.min(first, EXPERIENCE_REVIEW_INBOX_MAX_PAGE);
  }
  if (typeof first !== 'string' || !/^[1-9]\d{0,3}$/.test(first)) return 1;
  return Math.min(Number(first), EXPERIENCE_REVIEW_INBOX_MAX_PAGE);
}

function requireIdentifier(value, label) {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) {
    fail('INBOX_INPUT_INVALID', `${label} is invalid.`);
  }
  return value;
}

function requireSha256(value, label) {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    fail('INBOX_INPUT_INVALID', `${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function parseEvidenceRefs(value) {
  if (typeof value !== 'string' || Buffer.byteLength(value) > 64 * 1024) {
    fail('INBOX_EVIDENCE_INVALID', 'Candidate evidence references are unavailable.');
  }

  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    fail('INBOX_EVIDENCE_INVALID', 'Candidate evidence references are unavailable.');
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 64) {
    fail('INBOX_EVIDENCE_INVALID', 'Candidate evidence references are unavailable.');
  }

  const refs = parsed.map((item) => {
    if (
      !item
      || typeof item !== 'object'
      || Array.isArray(item)
      || Object.keys(item).sort().join(',') !== 'ref,sha256'
      || typeof item.ref !== 'string'
      || !SAFE_ARTIFACT.test(item.ref)
      || !SHA256.test(item.sha256 ?? '')
    ) {
      fail('INBOX_EVIDENCE_INVALID', 'Candidate evidence references are unavailable.');
    }
    return Object.freeze({ ref: item.ref, sha256: item.sha256 });
  }).sort((left, right) => (
    left.ref.localeCompare(right.ref) || left.sha256.localeCompare(right.sha256)
  ));

  if (new Set(refs.map(({ ref }) => ref)).size !== refs.length) {
    fail('INBOX_EVIDENCE_INVALID', 'Candidate evidence references are unavailable.');
  }
  return Object.freeze(refs);
}

export function parseExperienceReviewInboxSearch(searchParams = {}) {
  return Object.fromEntries(
    INBOX_PAGE_KEYS.map((key) => [key, pageNumber(searchParams[key])]),
  );
}

export function experienceReviewPageCount(totalItems) {
  if (!Number.isSafeInteger(totalItems) || totalItems < 0) {
    throw new TypeError('Inbox item count must be a non-negative safe integer.');
  }
  return Math.max(1, Math.ceil(totalItems / EXPERIENCE_REVIEW_INBOX_PAGE_SIZE));
}

export function clampExperienceReviewPage(requestedPage, totalItems) {
  return Math.min(pageNumber(String(requestedPage)), experienceReviewPageCount(totalItems));
}

export function experienceReviewPageOffset(page) {
  return (pageNumber(String(page)) - 1) * EXPERIENCE_REVIEW_INBOX_PAGE_SIZE;
}

export function experienceReviewInboxHref(currentPages, pageKey, targetPage) {
  if (!INBOX_PAGE_KEYS.includes(pageKey)) {
    throw new TypeError('Unknown experience review queue.');
  }
  const pages = parseExperienceReviewInboxSearch({
    ...currentPages,
    [pageKey]: String(targetPage),
  });
  const params = new URLSearchParams();
  for (const key of INBOX_PAGE_KEYS) {
    if (pages[key] > 1) params.set(key, String(pages[key]));
  }
  const query = params.toString();
  return query ? `/admin/experience-review?${query}` : '/admin/experience-review';
}

export function parseExperienceReviewAction(formData) {
  if (!formData || typeof formData.get !== 'function') {
    fail('INBOX_INPUT_INVALID', 'Review form data is required.');
  }
  const candidateId = requireIdentifier(formData.get('candidateId'), 'Candidate ID');
  const versionText = formData.get('candidateVersion');
  if (typeof versionText !== 'string' || !/^[1-9]\d{0,8}$/.test(versionText)) {
    fail('INBOX_INPUT_INVALID', 'Candidate version is invalid.');
  }
  const decision = formData.get('decision');
  if (typeof decision !== 'string' || !DECISION_REASON_CODES[decision]) {
    fail('INBOX_INPUT_INVALID', 'Review decision is invalid.');
  }
  return Object.freeze({
    candidateId,
    candidateVersion: Number(versionText),
    decision,
  });
}

export function projectExperienceReviewCandidate(candidate) {
  const lifecycle = candidate?.lifecycle;
  const lifecycleKnown = lifecycle === 'PENDING_REVIEW'
    || EXPERIENCE_REVIEW_CLOSED_STATES.includes(lifecycle);
  let evidenceRefs = Object.freeze([]);
  let evidenceState = 'CAPABILITY_GAP';
  try {
    evidenceRefs = parseEvidenceRefs(candidate?.evidenceRefs);
    evidenceState = 'AVAILABLE';
  } catch (error) {
    if (!(error instanceof ExperienceReviewInboxError)) throw error;
  }

  return Object.freeze({
    id: requireIdentifier(candidate?.id, 'Candidate ID'),
    tenant: requireIdentifier(candidate?.tenant, 'Tenant'),
    siteId: candidate?.siteId ?? null,
    merchantId: candidate?.merchantId ?? null,
    sourceKind: candidate?.sourceKind ?? 'UNKNOWN',
    sourceArtifact: candidate?.sourceArtifact ?? 'UNKNOWN',
    sourceRevision: candidate?.sourceRevision ?? 'UNKNOWN',
    payloadSha256: SHA256.test(candidate?.payloadSha256 ?? '')
      ? candidate.payloadSha256
      : 'UNKNOWN',
    rightsState: candidate?.rightsState ?? 'UNKNOWN',
    accessibilityState: candidate?.accessibilityState ?? 'UNKNOWN',
    policyState: candidate?.policyState ?? 'UNKNOWN',
    uncertaintyState: candidate?.uncertaintyState ?? 'UNKNOWN',
    lifecycle: lifecycleKnown ? lifecycle : 'UNKNOWN',
    version: Number.isSafeInteger(candidate?.version) && candidate.version > 0
      ? candidate.version
      : null,
    createdAt: candidate?.createdAt,
    updatedAt: candidate?.updatedAt,
    evidenceRefs,
    evidenceState,
    decisionEligible: lifecycle === 'PENDING_REVIEW'
      && evidenceState === 'AVAILABLE'
      && Number.isSafeInteger(candidate?.version)
      && candidate.version > 0,
    latestReceipt: Array.isArray(candidate?.receipts) && candidate.receipts.length > 0
      ? Object.freeze({
          decision: candidate.receipts[0].decision ?? 'UNKNOWN',
          reasonCode: candidate.receipts[0].reasonCode ?? 'UNKNOWN',
          createdAt: candidate.receipts[0].createdAt,
        })
      : null,
  });
}

export function buildExperienceReviewMutationInput({ candidate, action, actor }) {
  if (!candidate || candidate.id !== action?.candidateId) {
    fail('INBOX_CANDIDATE_NOT_FOUND', 'Experience review candidate was not found.');
  }
  const evidence = parseEvidenceRefs(candidate.evidenceRefs);
  const evidenceRefs = [...new Set(evidence.map(({ sha256: digest }) => `sha256:${digest}`))].sort();
  const tenant = requireIdentifier(candidate.tenant, 'Tenant');
  const userId = requireIdentifier(actor?.userId, 'Actor user ID');
  if (actor?.role !== 'ADMIN') {
    fail('INBOX_AUTHORITY_REQUIRED', 'Administrator review authority is required.');
  }
  const payloadSha256 = requireSha256(candidate.payloadSha256, 'Candidate payload');

  return Object.freeze({
    actor: Object.freeze({ authenticated: true, role: actor.role, userId }),
    tenant,
    candidateId: candidate.id,
    candidateVersion: action.candidateVersion,
    payloadSha256,
    decision: action.decision,
    reasonCode: DECISION_REASON_CODES[action.decision],
    evidenceRefs: Object.freeze(evidenceRefs),
    evidenceSha256: sha256(JSON.stringify(evidenceRefs)),
  });
}
