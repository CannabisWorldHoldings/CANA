import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateReceiptHash, normalizeContact } from '@/lib/consent-gate';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { contact } = body;

    if (!contact || typeof contact !== 'string') {
      return NextResponse.json({ success: false, error: 'Contact email or phone is required.' }, { status: 400 });
    }

    const { contactNormalized, channel, valid } = normalizeContact(contact);
    if (!valid) {
      return NextResponse.json({ success: false, error: 'Invalid email or phone number format.' }, { status: 400 });
    }

    const now = new Date();
    const receiptHash = generateReceiptHash(contactNormalized, now, 'UNSUBSCRIBED');

    // Append Unsubscribe entry in canonical Prisma datastore
    const consentRecord = await prisma.customerConsent.create({
      data: {
        contactNormalized,
        channel,
        consentStatus: 'UNSUBSCRIBED',
        consentVersion: 'EXP-2026-DC-01',
        source: 'UNSUBSCRIBE_SURFACE',
        receiptHash,
        timestamp: now,
      },
    });

    return NextResponse.json({
      success: true,
      revocationReceipt: consentRecord.receiptHash,
      channel,
      status: consentRecord.consentStatus,
      timestamp: consentRecord.timestamp.toISOString(),
      message: 'Unsubscribed successfully. Contact will receive zero future communications.',
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message || 'Internal server error.' }, { status: 500 });
  }
}
