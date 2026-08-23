import { createHash } from 'node:crypto';

const DECISIONS = new Set([
  'APPROVED_FOR_DRAFT_ONLY',
  'REJECTED',
  'RETURNED_FOR_EVIDENCE',
]);
const GENESIS_RECEIPT_HASH = '0'.repeat(64);
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const REASON_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const EVIDENCE_REFERENCE = /^sha256:[a-f0-9]{64}$/;

export class ExperienceReviewMutationError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ExperienceReviewMutationError';
    this.code = code;
  }
}

function refuse(message, code) {
  throw new ExperienceReviewMutationError(message, code);
}

function requireIdentifier(value, label) {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) {
    refuse(`${label} is invalid.`, 'REVIEW_INPUT_INVALID');
  }
  return value;
}

function requireSha256(value, label) {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    refuse(`${label} must be a lowercase SHA-256 digest.`, 'REVIEW_INPUT_INVALID');
  }
  return value;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function reviewInput(input) {
  if (!input?.actor?.authenticated) {
    refuse('An authenticated actor is required.', 'REVIEW_UNAUTHENTICATED');
  }
  if (input.actor.role !== 'ADMIN') {
    refuse('Administrator review authority is required.', 'REVIEW_FORBIDDEN');
  }

  const actorId = requireIdentifier(input.actor.userId, 'Actor user ID');
  const tenant = requireIdentifier(input.tenant, 'Tenant');
  const candidateId = requireIdentifier(input.candidateId, 'Candidate ID');
  if (!Number.isSafeInteger(input.candidateVersion) || input.candidateVersion < 1) {
    refuse('Candidate version is invalid.', 'REVIEW_INPUT_INVALID');
  }
  const payloadSha256 = requireSha256(input.payloadSha256, 'Payload SHA-256');
  if (!DECISIONS.has(input.decision)) {
    refuse('Review decision is invalid.', 'REVIEW_INPUT_INVALID');
  }
  if (typeof input.reasonCode !== 'string' || !REASON_CODE.test(input.reasonCode)) {
    refuse('Review reason code is invalid.', 'REVIEW_INPUT_INVALID');
  }
  if (
    !Array.isArray(input.evidenceRefs) ||
    input.evidenceRefs.length === 0 ||
    input.evidenceRefs.length > 64 ||
    input.evidenceRefs.some(
      (reference) =>
        typeof reference !== 'string' || !EVIDENCE_REFERENCE.test(reference),
    ) ||
    new Set(input.evidenceRefs).size !== input.evidenceRefs.length
  ) {
    refuse('Evidence references must be unique SHA-256 references.', 'REVIEW_INPUT_INVALID');
  }

  const submittedEvidenceRefs = JSON.stringify(input.evidenceRefs);
  const submittedEvidenceSha256 = requireSha256(
    input.evidenceSha256,
    'Evidence SHA-256',
  );
  if (sha256(submittedEvidenceRefs) !== submittedEvidenceSha256) {
    refuse('Evidence digest does not match its references.', 'REVIEW_INPUT_INVALID');
  }
  const evidenceRefs = JSON.stringify([...input.evidenceRefs].sort());
  const evidenceSha256 = sha256(evidenceRefs);

  return Object.freeze({
    actorId,
    tenant,
    candidateId,
    candidateVersion: input.candidateVersion,
    payloadSha256,
    decision: input.decision,
    reasonCode: input.reasonCode,
    evidenceRefs,
    evidenceSha256,
  });
}

function isExactReplay(receipt, input) {
  return Boolean(
    receipt &&
      receipt.candidateId === input.candidateId &&
      receipt.candidateVersion === input.candidateVersion &&
      receipt.actorId === input.actorId &&
      receipt.decision === input.decision &&
      receipt.reasonCode === input.reasonCode &&
      receipt.evidenceRefs === input.evidenceRefs &&
      receipt.evidenceSha256 === input.evidenceSha256 &&
      receipt.executionAuthorized === false &&
      receipt.publishAuthorized === false &&
      receipt.deploymentAuthorized === false
  );
}

function receiptBody(input, sequence, priorReceiptHash) {
  return {
    candidateId: input.candidateId,
    candidateVersion: input.candidateVersion,
    sequence,
    actorId: input.actorId,
    decision: input.decision,
    reasonCode: input.reasonCode,
    priorReceiptHash,
    evidenceRefs: input.evidenceRefs,
    evidenceSha256: input.evidenceSha256,
    executionAuthorized: false,
    publishAuthorized: false,
    deploymentAuthorized: false,
  };
}

function isRetryableConcurrency(error) {
  return Boolean(
    error &&
      (error.code === 'P2002' ||
        error.code === 'P2034' ||
        error.code === 'REVIEW_CONFLICT'),
  );
}

async function transactReview(db, input) {
  return db.$transaction(
    async (transaction) => {
      const candidate = await transaction.experienceReviewCandidate.findUnique({
        where: { id: input.candidateId },
      });
      if (!candidate) {
        refuse('Experience review candidate was not found.', 'REVIEW_NOT_FOUND');
      }
      if (candidate.tenant !== input.tenant) {
        refuse('Candidate belongs to another tenant.', 'REVIEW_FOREIGN_TENANT');
      }
      if (candidate.version !== input.candidateVersion) {
        refuse('Candidate version is stale.', 'REVIEW_STALE_VERSION');
      }
      if (candidate.payloadSha256 !== input.payloadSha256) {
        refuse('Candidate payload digest does not match.', 'REVIEW_PAYLOAD_TAMPERED');
      }

      const latestReceipt =
        await transaction.experienceReviewReceipt.findFirst({
          where: { candidateId: input.candidateId },
          orderBy: { sequence: 'desc' },
        });
      if (candidate.lifecycle !== 'PENDING_REVIEW') {
        if (candidate.lifecycle === input.decision && isExactReplay(latestReceipt, input)) {
          return { outcome: 'REPLAYED', receipt: latestReceipt };
        }
        refuse('Candidate already has a closed review decision.', 'REVIEW_ALREADY_DECIDED');
      }

      const transition = await transaction.experienceReviewCandidate.updateMany({
        where: {
          id: input.candidateId,
          tenant: input.tenant,
          version: input.candidateVersion,
          lifecycle: 'PENDING_REVIEW',
          payloadSha256: input.payloadSha256,
        },
        data: { lifecycle: input.decision },
      });
      if (transition.count !== 1) {
        refuse('Candidate changed while review was committing.', 'REVIEW_CONFLICT');
      }

      const sequence = (latestReceipt?.sequence ?? 0) + 1;
      const priorReceiptHash = latestReceipt?.receiptHash ?? GENESIS_RECEIPT_HASH;
      const body = receiptBody(input, sequence, priorReceiptHash);
      const receiptHash = sha256(JSON.stringify(body));
      const receipt = await transaction.experienceReviewReceipt.create({
        data: {
          id: `experience-review-${receiptHash}`,
          ...body,
          receiptHash,
        },
      });

      await transaction.auditLog.create({
        data: {
          userId: input.actorId,
          action: 'REVIEW_EXPERIENCE_CANDIDATE_DRAFT_ONLY',
          details: `candidateId=${input.candidateId} receiptId=${receipt.id}`,
        },
      });

      return { outcome: 'COMMITTED', receipt };
    },
    { isolationLevel: 'Serializable' },
  );
}

export async function reviewExperienceCandidate(db, request) {
  if (!db || typeof db.$transaction !== 'function') {
    refuse('A transactional database client is required.', 'REVIEW_INPUT_INVALID');
  }
  const input = reviewInput(request);

  try {
    return await transactReview(db, input);
  } catch (error) {
    if (!isRetryableConcurrency(error)) throw error;
    return transactReview(db, input);
  }
}
