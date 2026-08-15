import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateReceiptHash, normalizeContact } from '@/lib/consent-gate';
import { tenantDomainForRequestHostname } from '@/lib/tenant-host.mjs';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const host = (request.headers.get('host') ?? '').split(':')[0];
    const tenantDomain = tenantDomainForRequestHostname(host);

    // Resolve Brand strictly from server-derived host / domain architecture
    const brand =
      (await prisma.brand.findUnique({
        where: { domain: tenantDomain },
        select: { id: true, domain: true },
      })) ||
      (await prisma.brand.findFirst({
        select: { id: true, domain: true },
      }));

    if (!brand) {
      return NextResponse.json(
        { success: false, error: 'Brand tenant not configured for this host.' },
        { status: 400 }
      );
    }

    const body = (await request.json()) as Record<string, unknown>;
    const contact = typeof body.contact === 'string' ? body.contact : '';

    if (!contact) {
      return NextResponse.json(
        { success: false, error: 'Contact email or phone is required.' },
        { status: 400 }
      );
    }

    const { contactNormalized, channel, valid } = normalizeContact(contact);
    if (!valid) {
      return NextResponse.json(
        { success: false, error: 'Invalid email or phone number format.' },
        { status: 400 }
      );
    }

    const now = new Date();
    const receiptHash = generateReceiptHash(brand.id, contactNormalized, now, 'UNSUBSCRIBED');

    // Append Brand-scoped Unsubscribe entry in canonical Prisma datastore
    const consentRecord = await prisma.customerConsent.create({
      data: {
        brandId: brand.id,
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
      brandId: brand.id,
      channel: consentRecord.channel,
      status: consentRecord.consentStatus,
      timestamp: consentRecord.timestamp.toISOString(),
      message:
        'Unsubscribed successfully. Contact will receive zero future communications for this brand.',
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : 'Internal server error.';
    return NextResponse.json({ success: false, error: errorMsg }, { status: 500 });
  }
}
