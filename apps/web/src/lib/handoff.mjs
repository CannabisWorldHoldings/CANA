import { isPubliclyVerified } from './data-status.mjs';
import { tenantRetailerWhere } from './tenant-retailer.mjs';

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

export class HandoffError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'HandoffError';
    this.code = code;
  }
}

function isPrivateOrLocalHostname(hostname) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    !normalized.includes('.') ||
    normalized.includes(':')
  ) {
    return true;
  }

  const octets = normalized.split('.').map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet))) {
    return false;
  }

  const [first, second] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    first >= 224 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19))
  );
}

export function safePublicWebsiteUrl(value) {
  if (
    typeof value !== 'string' ||
    value.length < 12 ||
    value.length > 2048 ||
    CONTROL_CHARACTER.test(value)
  ) {
    return null;
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    isPrivateOrLocalHostname(parsed.hostname)
  ) {
    return null;
  }

  return parsed.toString();
}

export function safePublicReferenceUrl(value) {
  const destination = safePublicWebsiteUrl(value);
  if (!destination) return null;
  const parsed = new URL(destination);
  if (parsed.search || parsed.hash) return null;
  return parsed.toString();
}

/**
 * RESOLVE THE DESTINATION — READ ONLY.
 *
 * THE DEFECT THIS SPLIT FIXES. Destination resolution used to live inside the same
 * transaction as the LeadEvent write, so a consumer's redirect depended on winning a
 * database WRITE LOCK. Measured: ten simultaneous handoffs produced ten HTTP 500s. A
 * consumer whose handoff fails because someone else clicked at the same moment is a
 * broken product, and no retry count turns that into a guarantee.
 *
 * Resolution needs no write. It reads a retailer, checks the truth boundary, and
 * derives a safe URL. Separating it means the consumer's redirect can never be
 * blocked by contention, because it never asks for a lock.
 */
export async function resolveHandoffDestination(
  db,
  { brandId, retailerId, asOf = new Date() },
) {
  const retailer = await db.retailer.findFirst({
    where: tenantRetailerWhere(brandId, retailerId, asOf),
    select: {
      id: true,
      website: true,
      dataStatus: true,
      isDemonstration: true,
      verifiedAt: true,
      freshnessExpiresAt: true,
    },
  });

  if (!retailer || !isPubliclyVerified(retailer, asOf)) {
    throw new HandoffError(
      'Retailer handoff is unavailable for this record.',
      'HANDOFF_NOT_CURRENT',
    );
  }

  const destination = safePublicWebsiteUrl(retailer.website);
  if (!destination) {
    throw new HandoffError(
      'Retailer handoff destination is unavailable.',
      'HANDOFF_DESTINATION_UNAVAILABLE',
    );
  }

  return { destination, retailerId: retailer.id };
}

/**
 * Record the LeadEvent. Bookkeeping, deliberately separate from the redirect.
 *
 * Returns a STATE rather than throwing, because the caller must be able to tell
 * "the consumer was handed off AND we recorded it" from "the consumer was handed off
 * but we could not record it". Collapsing those two is how a system quietly
 * under-reports and nobody notices.
 */
export async function recordHandoffEvent(db, { brandId, retailerId }) {
  try {
    const event = await db.leadEvent.create({
      data: { brandId, retailerId, eventType: 'HANDOFF_CLICK' },
    });
    return { state: 'EVIDENCE_WRITE_SUCCEEDED', eventId: event.id };
  } catch (error) {
    const code = String(error?.code ?? '');
    const msg = String(error?.message ?? '');
    // Contention is TRANSIENT and the work is safe to retry later; a schema or
    // constraint error is not, and must not be silently queued forever.
    const contended = /SQLITE_BUSY|database is locked|write conflict|deadlock|Socket timeout|Transaction (?:already closed|api error)|P2034|P1008|P2028/i
      .test(`${code} ${msg}`);
    return {
      state: contended ? 'EVIDENCE_WRITE_DEFERRED' : 'EVIDENCE_WRITE_FAILED',
      error: `${code} ${msg}`.trim().slice(0, 200),
    };
  }
}

/**
 * BACK-COMPATIBLE wrapper. Existing callers and tests expect one call that both
 * resolves and records. It now composes the two halves, so the read cannot be
 * blocked by the write even through this path.
 */
export async function recordVerifiedHandoff(
  db,
  { brandId, retailerId, asOf = new Date() },
) {
  const resolved = await resolveHandoffDestination(db, { brandId, retailerId, asOf });
  const recorded = await recordHandoffEvent(db, { brandId, retailerId });
  return {
    destination: resolved.destination,
    eventId: recorded.eventId ?? null,
    evidenceWriteState: recorded.state,
  };
}
