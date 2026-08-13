import crypto from 'crypto';
import { prisma } from '@/lib/prisma';

export function normalizeContact(contact: string): { contactNormalized: string; channel: 'EMAIL' | 'SMS'; valid: boolean } {
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

export function generateReceiptHash(contactNormalized: string, timestamp: Date, status: string): string {
  const payload = `${contactNormalized}:${timestamp.toISOString()}:${status}:EXP-2026-DC-01`;
  return `RC-${crypto.createHash('sha256').update(payload).digest('hex').slice(0, 10)}`;
}

export async function checkDispatchEligibility(contactNormalized: string, channel: 'EMAIL' | 'SMS'): Promise<{ eligible: boolean; reason: string }> {
  try {
    const latestConsent = await prisma.customerConsent.findFirst({
      where: {
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
  } catch (error) {
    return { eligible: false, reason: 'CONSENT_GATE_ERROR' };
  }
}
