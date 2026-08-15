import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  generateReceiptHash,
  normalizeContact,
  ALLOWED_FREQUENCIES,
  AllowedFrequency,
} from '@/lib/consent-gate';
import { tenantDomainForRequestHostname } from '@/lib/tenant-host.mjs';
import { getSession } from '@/lib/auth/session';

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
    const frequency = typeof body.frequency === 'string' ? body.frequency : 'DAILY';
    const neighborhood = typeof body.neighborhood === 'string' ? body.neighborhood : 'All D.C.';
    const consentCheck = body.consentCheck === true;

    // Strict validation: Explicit consent required
    if (!consentCheck) {
      return NextResponse.json(
        { success: false, error: 'Explicit consent checkbox is required.' },
        { status: 400 }
      );
    }

    // Strict validation: Contact format
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

    // Strict validation: Frequency enum
    if (frequency && !ALLOWED_FREQUENCIES.includes(frequency as AllowedFrequency)) {
      return NextResponse.json(
        {
          success: false,
          error: `Invalid frequency '${frequency}'. Allowed: ${ALLOWED_FREQUENCIES.join(', ')}`,
        },
        { status: 400 }
      );
    }

    // Client Identity Trust: Server-derived user identity ONLY (never trust client userId)
    const session = await getSession();
    const userId = session?.userId ?? null;

    const now = new Date();
    const receiptHash = generateReceiptHash(brand.id, contactNormalized, now, 'CONSENT_GRANTED');

    // Persist Brand-scoped Customer Consent record
    const consentRecord = await prisma.customerConsent.create({
      data: {
        brandId: brand.id,
        userId,
        contactNormalized,
        channel,
        consentStatus: 'CONSENT_GRANTED',
        consentVersion: 'EXP-2026-DC-01',
        source: 'DEAL_ALERTS_LANDING',
        campaignId: typeof body.campaignId === 'string' ? body.campaignId : null,
        frequency: (frequency as AllowedFrequency) || 'DAILY',
        neighborhood,
        receiptHash,
        timestamp: now,
      },
    });

    return NextResponse.json({
      success: true,
      consentReceipt: consentRecord.receiptHash,
      brandId: brand.id,
      channel: consentRecord.channel,
      status: consentRecord.consentStatus,
      timestamp: consentRecord.timestamp.toISOString(),
      message: 'Explicit consent granted and recorded in canonical ledger.',
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : 'Internal server error.';
    return NextResponse.json({ success: false, error: errorMsg }, { status: 500 });
  }
}
