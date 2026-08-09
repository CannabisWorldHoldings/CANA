import {
  AdminValidationError,
  validateAdminIdentifier,
  validateReviewDecision,
} from './admin-validation.mjs';
import { isPasswordHash } from './auth/password.mjs';
import { isPubliclyVerified } from './data-status.mjs';

const VERIFICATION_WINDOW_DAYS = 30;
const CORRECTION_DATA_SOURCE = 'Approved correction awaiting verification';

export class AdminMutationError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'AdminMutationError';
    this.code = code;
  }
}

function mutationContext(recordId, recordLabel, actorUserId) {
  return {
    recordId: validateAdminIdentifier(recordId, recordLabel),
    actorUserId: validateAdminIdentifier(actorUserId, 'Actor user ID'),
  };
}

function mutationTime(now) {
  const value = now ?? new Date();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new AdminValidationError('Mutation time must be a valid date.');
  }
  return new Date(value);
}

function verificationExpiry(verifiedAt) {
  const expiresAt = new Date(verifiedAt);
  expiresAt.setUTCDate(expiresAt.getUTCDate() + VERIFICATION_WINDOW_DAYS);
  return expiresAt;
}

function auditData(actorUserId, action, identifiers) {
  return {
    userId: actorUserId,
    action,
    details: Object.entries(identifiers)
      .map(([key, value]) => `${key}=${value}`)
      .join(' '),
  };
}

function requireSingleUpdate(result, code, message) {
  if (result.count !== 1) {
    throw new AdminMutationError(message, code);
  }
}

function isUniqueConstraintError(error) {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'P2002',
  );
}

function correctionUpdate(dispute, timestamp) {
  const update = {
    dataStatus: dispute.retailer.isDemonstration
      ? 'DEMONSTRATION_ONLY'
      : 'AWAITING_VERIFICATION',
    dataSource: CORRECTION_DATA_SOURCE,
    sourceUrl: dispute.evidenceUrl,
    retrievedAt: timestamp,
    verifiedAt: null,
    freshnessExpiresAt: null,
    confidence: null,
    reviewedBy: null,
    lastInfoCheck: timestamp,
  };

  switch (dispute.fieldName) {
    case 'address':
      return { ...update, address: dispute.newValue };
    case 'phone':
      return { ...update, phone: dispute.newValue };
    case 'hours':
      return { ...update, hours: dispute.newValue };
    case 'licenseNumber':
      return {
        ...update,
        licenseNumber: dispute.newValue,
        licenseStatus: 'PENDING',
        lastLicenseCheck: null,
      };
    case 'name':
      return { ...update, name: dispute.newValue };
    default:
      return null;
  }
}

export async function approveLicenseEvidence(
  db,
  { evidenceId, actorUserId, now = undefined },
) {
  const context = mutationContext(evidenceId, 'Evidence ID', actorUserId);
  const verifiedAt = mutationTime(now);
  const freshnessExpiresAt = verificationExpiry(verifiedAt);

  return db.$transaction(async (transaction) => {
    const evidence = await transaction.licenseEvidence.findUnique({
      where: { id: context.recordId },
      include: {
        retailer: {
          select: { id: true, isDemonstration: true },
        },
      },
    });
    if (!evidence) {
      throw new AdminMutationError('License evidence not found.', 'EVIDENCE_NOT_FOUND');
    }

    if (evidence.isDemonstration || evidence.retailer.isDemonstration) {
      await transaction.auditLog.create({
        data: auditData(
          context.actorUserId,
          'BLOCK_DEMONSTRATION_LICENSE_APPROVAL',
          {
            evidenceId: evidence.id,
            retailerId: evidence.retailerId,
          },
        ),
      });
      return { outcome: 'BLOCKED_DEMONSTRATION' };
    }

    if (evidence.verificationStatus !== 'PENDING') {
      throw new AdminMutationError(
        'License evidence has already been reviewed.',
        'EVIDENCE_ALREADY_REVIEWED',
      );
    }

    const evidenceUpdate = await transaction.licenseEvidence.updateMany({
      where: {
        id: evidence.id,
        verificationStatus: 'PENDING',
      },
      data: {
        verificationStatus: 'APPROVED',
        dataStatus: 'VERIFIED_CURRENT',
        verifiedAt,
        freshnessExpiresAt,
        reviewedBy: context.actorUserId,
      },
    });
    requireSingleUpdate(
      evidenceUpdate,
      'EVIDENCE_REVIEW_CONFLICT',
      'License evidence changed before approval completed.',
    );

    await transaction.retailer.update({
      where: { id: evidence.retailerId },
      data: {
        licenseStatus: 'VERIFIED',
        dataStatus: 'VERIFIED_CURRENT',
        dataSource: evidence.dataSource,
        sourceUrl: evidence.sourceUrl || evidence.documentUrl,
        retrievedAt: evidence.retrievedAt ?? verifiedAt,
        verifiedAt,
        freshnessExpiresAt,
        confidence: evidence.confidence,
        reviewedBy: context.actorUserId,
        lastLicenseCheck: verifiedAt,
        lastInfoCheck: verifiedAt,
      },
    });
    await transaction.auditLog.create({
      data: auditData(context.actorUserId, 'APPROVE_RETAILER_LICENSE', {
        evidenceId: evidence.id,
        retailerId: evidence.retailerId,
      }),
    });

    return {
      outcome: 'APPROVED',
      evidenceId: evidence.id,
      retailerId: evidence.retailerId,
    };
  });
}

export async function rejectLicenseEvidence(
  db,
  { evidenceId, actorUserId, now = undefined },
) {
  const context = mutationContext(evidenceId, 'Evidence ID', actorUserId);
  const reviewedAt = mutationTime(now);

  return db.$transaction(async (transaction) => {
    const evidence = await transaction.licenseEvidence.findUnique({
      where: { id: context.recordId },
      include: {
        retailer: {
          select: { id: true, isDemonstration: true },
        },
      },
    });
    if (!evidence) {
      throw new AdminMutationError(
        'License evidence not found.',
        'EVIDENCE_NOT_FOUND',
      );
    }
    if (evidence.verificationStatus !== 'PENDING') {
      throw new AdminMutationError(
        'License evidence has already been reviewed.',
        'EVIDENCE_ALREADY_REVIEWED',
      );
    }

    const evidenceUpdate = await transaction.licenseEvidence.updateMany({
      where: {
        id: evidence.id,
        verificationStatus: 'PENDING',
      },
      data: {
        verificationStatus: 'REJECTED',
        dataStatus:
          evidence.isDemonstration || evidence.retailer.isDemonstration
            ? 'DEMONSTRATION_ONLY'
            : 'DISPUTED',
        verifiedAt: null,
        freshnessExpiresAt: null,
        reviewedBy: context.actorUserId,
      },
    });
    requireSingleUpdate(
      evidenceUpdate,
      'EVIDENCE_REVIEW_CONFLICT',
      'License evidence changed before rejection completed.',
    );

    const rejectedClaims = await transaction.claimRequest.updateMany({
      where: {
        retailerId: evidence.retailerId,
        status: 'PENDING',
      },
      data: {
        status: 'REJECTED',
        requestedPasswordHash: null,
        reviewedAt,
        reviewedBy: context.actorUserId,
      },
    });

    await transaction.auditLog.create({
      data: auditData(
        context.actorUserId,
        'REJECT_RETAILER_LICENSE_EVIDENCE',
        {
          evidenceId: evidence.id,
          retailerId: evidence.retailerId,
          claimsRejected: rejectedClaims.count,
        },
      ),
    });

    return {
      outcome: 'REJECTED',
      evidenceId: evidence.id,
      retailerId: evidence.retailerId,
      claimsRejected: rejectedClaims.count,
    };
  });
}

export async function refreshRetailerVerification(
  db,
  { retailerId, actorUserId, now = undefined },
) {
  const context = mutationContext(retailerId, 'Retailer ID', actorUserId);
  const verifiedAt = mutationTime(now);
  const freshnessExpiresAt = verificationExpiry(verifiedAt);

  return db.$transaction(async (transaction) => {
    const retailer = await transaction.retailer.findUnique({
      where: { id: context.recordId },
      include: {
        evidence: {
          where: {
            verificationStatus: 'APPROVED',
            isDemonstration: false,
          },
          orderBy: [{ verifiedAt: 'desc' }, { submittedAt: 'desc' }],
          take: 1,
        },
      },
    });

    if (!retailer || retailer.isDemonstration || retailer.evidence.length === 0) {
      await transaction.auditLog.create({
        data: auditData(
          context.actorUserId,
          'BLOCK_UNSUPPORTED_FRESHNESS_UPDATE',
          { retailerId: context.recordId },
        ),
      });
      return { outcome: 'BLOCKED_WITHOUT_EVIDENCE' };
    }

    const evidence = retailer.evidence[0];
    const evidenceUpdate = await transaction.licenseEvidence.updateMany({
      where: {
        id: evidence.id,
        retailerId: retailer.id,
        verificationStatus: 'APPROVED',
        isDemonstration: false,
      },
      data: {
        dataStatus: 'VERIFIED_CURRENT',
        verifiedAt,
        freshnessExpiresAt,
        reviewedBy: context.actorUserId,
      },
    });
    requireSingleUpdate(
      evidenceUpdate,
      'EVIDENCE_REFRESH_CONFLICT',
      'Approved evidence changed before the verification refresh completed.',
    );

    await transaction.retailer.update({
      where: { id: retailer.id },
      data: {
        licenseStatus: 'VERIFIED',
        dataStatus: 'VERIFIED_CURRENT',
        dataSource: evidence.dataSource,
        sourceUrl: evidence.sourceUrl || evidence.documentUrl,
        retrievedAt: evidence.retrievedAt ?? verifiedAt,
        verifiedAt,
        freshnessExpiresAt,
        confidence: evidence.confidence,
        reviewedBy: context.actorUserId,
        lastLicenseCheck: verifiedAt,
        lastInfoCheck: verifiedAt,
      },
    });
    await transaction.auditLog.create({
      data: auditData(context.actorUserId, 'MARK_INFO_FRESH', {
        evidenceId: evidence.id,
        retailerId: retailer.id,
      }),
    });

    return {
      outcome: 'REFRESHED',
      evidenceId: evidence.id,
      retailerId: retailer.id,
    };
  });
}

export async function resolveCorrectionDispute(
  db,
  { disputeId, actorUserId, decision, now = undefined },
) {
  const context = mutationContext(disputeId, 'Dispute ID', actorUserId);
  const validatedDecision = validateReviewDecision(decision);
  const timestamp = mutationTime(now);

  return db.$transaction(async (transaction) => {
    const dispute = await transaction.dispute.findUnique({
      where: { id: context.recordId },
      include: {
        retailer: {
          select: { id: true, isDemonstration: true },
        },
      },
    });
    if (!dispute) {
      throw new AdminMutationError('Correction dispute not found.', 'DISPUTE_NOT_FOUND');
    }
    if (dispute.status !== 'PENDING') {
      throw new AdminMutationError(
        'Correction dispute has already been reviewed.',
        'DISPUTE_ALREADY_REVIEWED',
      );
    }

    if (validatedDecision === 'REJECT') {
      const rejection = await transaction.dispute.updateMany({
        where: { id: dispute.id, status: 'PENDING' },
        data: { status: 'REJECTED' },
      });
      requireSingleUpdate(
        rejection,
        'DISPUTE_REVIEW_CONFLICT',
        'Correction dispute changed before rejection completed.',
      );
      await transaction.auditLog.create({
        data: auditData(context.actorUserId, 'RESOLVE_DISPUTE_REJECTED', {
          disputeId: dispute.id,
          retailerId: dispute.retailerId,
        }),
      });
      return { outcome: 'REJECTED' };
    }

    const retailerUpdate = correctionUpdate(dispute, timestamp);
    if (!retailerUpdate) {
      await transaction.auditLog.create({
        data: auditData(context.actorUserId, 'RESOLVE_DISPUTE_BLOCKED', {
          disputeId: dispute.id,
          retailerId: dispute.retailerId,
        }),
      });
      return { outcome: 'BLOCKED_UNSUPPORTED_FIELD' };
    }

    const resolution = await transaction.dispute.updateMany({
      where: { id: dispute.id, status: 'PENDING' },
      data: { status: 'RESOLVED' },
    });
    requireSingleUpdate(
      resolution,
      'DISPUTE_REVIEW_CONFLICT',
      'Correction dispute changed before approval completed.',
    );

    await transaction.retailer.update({
      where: { id: dispute.retailerId },
      data: retailerUpdate,
    });
    await transaction.auditLog.create({
      data: auditData(context.actorUserId, 'RESOLVE_DISPUTE_APPROVED', {
        disputeId: dispute.id,
        retailerId: dispute.retailerId,
      }),
    });

    return { outcome: 'APPROVED' };
  });
}

export async function resolveRetailerClaim(
  db,
  { claimId, actorUserId, decision, now = undefined },
) {
  const context = mutationContext(claimId, 'Claim ID', actorUserId);
  const validatedDecision = validateReviewDecision(decision);
  const timestamp = mutationTime(now);

  try {
    return await db.$transaction(async (transaction) => {
      const claim = await transaction.claimRequest.findUnique({
        where: { id: context.recordId },
        include: {
          retailer: {
            include: {
              evidence: {
                where: {
                  verificationStatus: 'APPROVED',
                  dataStatus: 'VERIFIED_CURRENT',
                  isDemonstration: false,
                  verifiedAt: { not: null },
                  freshnessExpiresAt: { gt: timestamp },
                },
                orderBy: { verifiedAt: 'desc' },
                take: 1,
              },
            },
          },
        },
      });
      if (!claim) {
        throw new AdminMutationError('Retailer claim not found.', 'CLAIM_NOT_FOUND');
      }
      if (claim.status !== 'PENDING') {
        throw new AdminMutationError(
          'Retailer claim has already been reviewed.',
          'CLAIM_ALREADY_REVIEWED',
        );
      }

      if (validatedDecision === 'REJECT') {
        const rejection = await transaction.claimRequest.updateMany({
          where: { id: claim.id, status: 'PENDING' },
          data: {
            status: 'REJECTED',
            requestedPasswordHash: null,
            reviewedAt: timestamp,
            reviewedBy: context.actorUserId,
          },
        });
        requireSingleUpdate(
          rejection,
          'CLAIM_REVIEW_CONFLICT',
          'Retailer claim changed before rejection completed.',
        );
        await transaction.auditLog.create({
          data: auditData(context.actorUserId, 'REJECT_RETAILER_CLAIM', {
            claimId: claim.id,
            retailerId: claim.retailerId,
          }),
        });
        return { outcome: 'REJECTED' };
      }

      if (
        claim.retailer.isDemonstration ||
        !isPubliclyVerified(claim.retailer, timestamp) ||
        claim.retailer.evidence.length === 0
      ) {
        await transaction.auditLog.create({
          data: auditData(
            context.actorUserId,
            'BLOCK_UNVERIFIED_RETAILER_CLAIM',
            {
              claimId: claim.id,
              retailerId: claim.retailerId,
            },
          ),
        });
        return { outcome: 'BLOCKED_UNVERIFIED_RETAILER' };
      }

      if (!isPasswordHash(claim.requestedPasswordHash)) {
        await transaction.auditLog.create({
          data: auditData(
            context.actorUserId,
            'BLOCK_INVALID_CLAIM_CREDENTIAL',
            {
              claimId: claim.id,
              retailerId: claim.retailerId,
            },
          ),
        });
        return { outcome: 'BLOCKED_INVALID_CREDENTIAL' };
      }

      // Defense in depth: the public submission validator lowercases emails,
      // but legacy rows or direct writes may not be normalized. On SQLite the
      // unique constraint was case-insensitive and masked this; PostgreSQL is
      // case-sensitive, so an un-normalized lookup could miss an existing
      // account and create a duplicate differing only in case.
      const normalizedClaimEmail = claim.email.trim().toLowerCase();
      const existingUser = await transaction.user.findUnique({
        where: { email: normalizedClaimEmail },
        select: { id: true },
      });
      if (existingUser) {
        await transaction.auditLog.create({
          data: auditData(context.actorUserId, 'BLOCK_CLAIM_ACCOUNT_CONFLICT', {
            claimId: claim.id,
            retailerId: claim.retailerId,
          }),
        });
        return { outcome: 'BLOCKED_ACCOUNT_CONFLICT' };
      }

      const approval = await transaction.claimRequest.updateMany({
        where: { id: claim.id, status: 'PENDING' },
        data: {
          status: 'APPROVED',
          requestedPasswordHash: null,
          reviewedAt: timestamp,
          reviewedBy: context.actorUserId,
        },
      });
      requireSingleUpdate(
        approval,
        'CLAIM_REVIEW_CONFLICT',
        'Retailer claim changed before approval completed.',
      );

      const manager = await transaction.user.create({
        data: {
          email: normalizedClaimEmail,
          password: claim.requestedPasswordHash,
          name: claim.retailer.name,
          role: 'RETAILER_MANAGER',
          managedRetailerId: claim.retailerId,
        },
      });
      await transaction.auditLog.create({
        data: auditData(context.actorUserId, 'APPROVE_RETAILER_CLAIM', {
          claimId: claim.id,
          retailerId: claim.retailerId,
          managerId: manager.id,
        }),
      });

      return {
        outcome: 'APPROVED',
        managerId: manager.id,
        retailerId: claim.retailerId,
      };
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new AdminMutationError(
        'A manager account already exists for this claim email.',
        'CLAIM_ACCOUNT_CONFLICT',
      );
    }
    throw error;
  }
}
