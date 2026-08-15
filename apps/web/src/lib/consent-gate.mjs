import crypto from 'node:crypto';

export const ALLOWED_CHANNELS = Object.freeze(['EMAIL', 'SMS']);
export const ALLOWED_FREQUENCIES = Object.freeze(['DAILY', 'WEEKLY', 'REALTIME', 'INSTANT']);
export const ALLOWED_CONSENT_STATUSES = Object.freeze([
  'CONSENT_GRANTED',
  'UNSUBSCRIBED',
  'CONSENT_REVOKED',
  'SUPPRESSED',
]);

export function normalizeContact(contact) {
  if (typeof contact !== 'string') {
    return { contactNormalized: '', channel: 'EMAIL', valid: false };
  }

  const trimmed = contact.trim().toLowerCase();
  if (trimmed.includes('@')) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return { contactNormalized: trimmed, channel: 'EMAIL', valid: emailRegex.test(trimmed) };
  }

  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 10) {
    return { contactNormalized: `+1${digits}`, channel: 'SMS', valid: true };
  } else if (digits.length === 11 && digits.startsWith('1')) {
    return { contactNormalized: `+${digits}`, channel: 'SMS', valid: true };
  }

  return { contactNormalized: trimmed, channel: 'SMS', valid: false };
}

export function generateReceiptHash(brandId, contactNormalized, timestamp, status) {
  const tsStr = timestamp instanceof Date ? timestamp.toISOString() : new Date(timestamp).toISOString();
  const payload = `${brandId}:${contactNormalized}:${tsStr}:${status}:EXP-2026-DC-01`;
  return `RC-${crypto.createHash('sha256').update(payload).digest('hex').slice(0, 10)}`;
}

export async function checkDispatchEligibility(prismaClient, brandId, contactNormalized, channel) {
  try {
    if (!brandId || typeof brandId !== 'string') {
      return { eligible: false, reason: 'BRAND_ID_REQUIRED' };
    }

    if (!contactNormalized || typeof contactNormalized !== 'string') {
      return { eligible: false, reason: 'CONTACT_REQUIRED' };
    }

    const latestConsent = await prismaClient.customerConsent.findFirst({
      where: {
        brandId,
        contactNormalized,
        channel: { in: [channel, 'ALL'] },
      },
      orderBy: [{ timestamp: 'desc' }, { updatedAt: 'desc' }],
    });

    if (!latestConsent) {
      return { eligible: false, reason: 'NO_CONSENT_RECORD_FOUND' };
    }

    if (latestConsent.consentStatus === 'CONSENT_GRANTED') {
      return { eligible: true, reason: 'ACTIVE_CONSENT_GRANTED' };
    }

    return { eligible: false, reason: `CONSENT_REJECTED_${latestConsent.consentStatus}` };
  } catch (_error) {
    return { eligible: false, reason: 'CONSENT_GATE_ERROR' };
  }
}
