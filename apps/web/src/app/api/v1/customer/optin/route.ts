import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateReceiptHash, normalizeContact } from '@/lib/consent-gate';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { contact, frequency = 'DAILY', neighborhood = 'All D.C.', consentCheck = false, campaignId, userId } = body;

    if (!contact || typeof contact !== 'string') {
      return NextResponse.json({ success: false, error: 'Contact email or phone is required.' }, { status: 400 });
    }

    if (!consentCheck) {
      return NextResponse.json({ success: false, error: 'Explicit consent checkbox is required.' }, { status: 400 });
    }

    const { contactNormalized, channel, valid } = normalizeContact(contact);
    if (!valid) {
      return NextResponse.json({ success: false, error: 'Invalid email or phone number format.' }, { status: 400 });
    }

    const now = new Date();
    const receiptHash = generateReceiptHash(contactNormalized, now, 'CONSENT_GRANTED');

    // Persist Customer Consent record (supports both anonymous and optional authenticated opt-in)
    const consentRecord = await prisma.customerConsent.create({
      data: {
        userId: userId || null,
        contactNormalized,
        channel,
        consentStatus: 'CONSENT_GRANTED',
        consentVersion: 'EXP-2026-DC-01',
        source: 'DEAL_ALERTS_LANDING',
        campaignId: campaignId || null,
        frequency,
        neighborhood,
        receiptHash,
        timestamp: now,
      },
    });

    return NextResponse.json({
      success: true,
      consentReceipt: consentRecord.receiptHash,
      channel,
      status: consentRecord.consentStatus,
      timestamp: consentRecord.timestamp.toISOString(),
      message: 'Explicit consent granted and recorded in canonical ledger.',
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message || 'Internal server error.' }, { status: 500 });
  }
}
