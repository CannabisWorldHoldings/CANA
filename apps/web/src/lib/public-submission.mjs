import { createHash } from 'node:crypto';
import { SubmissionValidationError } from './submission-validation.mjs';

export const PUBLIC_SUBMISSION_POLICY = Object.freeze({
  windowMs: 60 * 60 * 1000,
  retentionMs: 24 * 60 * 60 * 1000,
  clientLimit: 5,
  surfaceLimit: 100,
});

export const PUBLIC_SUBMISSION_SURFACES = Object.freeze({
  ASK: 'ASK',
  CLAIM: 'CLAIM',
  CORRECTION: 'CORRECTION',
});

const PUBLIC_ERROR_MESSAGES = Object.freeze({
  duplicate: 'A matching submission is already pending or was recently received.',
  failed: 'The submission could not be completed. Please try again.',
  invalid: 'Please review the submitted fields and try again.',
  rate: 'Too many submissions were received. Please try again later.',
});

export class PublicSubmissionDuplicateError extends Error {
  constructor() {
    super('A matching public submission already exists.');
    this.name = 'PublicSubmissionDuplicateError';
    this.code = 'PUBLIC_SUBMISSION_DUPLICATE';
  }
}

export class PublicSubmissionThrottleError extends Error {
  constructor() {
    super('The public submission rate limit was reached.');
    this.name = 'PublicSubmissionThrottleError';
    this.code = 'PUBLIC_SUBMISSION_RATE_LIMITED';
  }
}

function validNow(now) {
  const value = now ?? new Date();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError('Public submission time must be a valid date.');
  }
  return new Date(value);
}

function validSurface(surface) {
  if (!Object.values(PUBLIC_SUBMISSION_SURFACES).includes(surface)) {
    throw new TypeError('Public submission surface is invalid.');
  }
  return surface;
}

function normalizedValue(value, fallback, maximumLength) {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  return normalized ? normalized.slice(0, maximumLength) : fallback;
}

function digest(namespace, value) {
  return createHash('sha256')
    .update(`cana-public-submission-v1:${namespace}:${value}`, 'utf8')
    .digest('hex');
}

function submissionKeys({ clientIdentity, subject }) {
  return {
    clientDigest: digest(
      'client',
      normalizedValue(clientIdentity, 'unresolved', 128),
    ),
    subjectDigest: digest(
      'subject',
      normalizedValue(subject, 'unspecified', 4096),
    ),
  };
}

function isUniqueConstraintError(error) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002'
  );
}

async function currentCounts(
  publicSubmissionEvent,
  { clientDigest, surface, timestamp },
) {
  const cutoff = new Date(
    timestamp.getTime() - PUBLIC_SUBMISSION_POLICY.windowMs,
  );
  const [clientCount, surfaceCount] = await Promise.all([
    publicSubmissionEvent.count({
      where: {
        surface,
        clientDigest,
        occurredAt: { gte: cutoff },
      },
    }),
    publicSubmissionEvent.count({
      where: {
        surface,
        occurredAt: { gte: cutoff },
      },
    }),
  ]);
  return { clientCount, surfaceCount };
}

export async function checkPublicSubmissionThrottle(
  db,
  { clientIdentity, surface, now = undefined },
) {
  const timestamp = validNow(now);
  const validSubmissionSurface = validSurface(surface);
  const { clientDigest } = submissionKeys({
    clientIdentity,
    subject: 'preflight-only',
  });
  const counts = await currentCounts(db.publicSubmissionEvent, {
    clientDigest,
    surface: validSubmissionSurface,
    timestamp,
  });

  return {
    allowed:
      counts.clientCount < PUBLIC_SUBMISSION_POLICY.clientLimit &&
      counts.surfaceCount < PUBLIC_SUBMISSION_POLICY.surfaceLimit,
    ...counts,
    retryAfterSeconds: Math.ceil(PUBLIC_SUBMISSION_POLICY.windowMs / 1000),
  };
}

export async function reservePublicSubmission(
  transaction,
  { clientIdentity, subject, surface, now = undefined },
) {
  const timestamp = validNow(now);
  const validSubmissionSurface = validSurface(surface);
  if (typeof subject !== 'string' || !subject.trim()) {
    throw new TypeError('Public submission subject is required.');
  }

  const keys = submissionKeys({ clientIdentity, subject });
  const expiresAt = new Date(
    timestamp.getTime() + PUBLIC_SUBMISSION_POLICY.retentionMs,
  );

  await transaction.publicSubmissionEvent.deleteMany({
    where: { expiresAt: { lte: timestamp } },
  });

  let event;
  try {
    event = await transaction.publicSubmissionEvent.create({
      data: {
        ...keys,
        surface: validSubmissionSurface,
        occurredAt: timestamp,
        expiresAt,
      },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new PublicSubmissionDuplicateError();
    }
    throw error;
  }

  const counts = await currentCounts(transaction.publicSubmissionEvent, {
    clientDigest: keys.clientDigest,
    surface: validSubmissionSurface,
    timestamp,
  });
  if (
    counts.clientCount > PUBLIC_SUBMISSION_POLICY.clientLimit ||
    counts.surfaceCount > PUBLIC_SUBMISSION_POLICY.surfaceLimit
  ) {
    throw new PublicSubmissionThrottleError();
  }

  return {
    ...counts,
    eventId: event.id,
    expiresAt,
  };
}

export function publicSubmissionErrorCode(error) {
  if (error instanceof PublicSubmissionThrottleError) return 'rate';
  if (
    error instanceof PublicSubmissionDuplicateError ||
    isUniqueConstraintError(error)
  ) {
    return 'duplicate';
  }
  if (error instanceof SubmissionValidationError) return 'invalid';
  return 'failed';
}

export function publicSubmissionErrorMessage(value) {
  if (typeof value !== 'string') return null;
  return PUBLIC_ERROR_MESSAGES[value] ?? null;
}
