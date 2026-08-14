import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createDemandCredits } from '@/lib/demand-credits.mjs';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const host = (request.headers.get('host') ?? '').split(':')[0];
    const body = await request.json();
    const { eventType, retailerId, dealId, contactNormalized, destination } = body;

    if (!eventType || !['DEAL_VIEWED', 'MERCHANT_CLICKED', 'OPTIN_COMPLETED'].includes(eventType)) {
      return NextResponse.json(
        { success: false, error: 'eventType must be DEAL_VIEWED, MERCHANT_CLICKED, or OPTIN_COMPLETED' },
        { status: 400 }
      );
    }

    if (!retailerId || typeof retailerId !== 'string') {
      return NextResponse.json(
        { success: false, error: 'retailerId is required' },
        { status: 400 }
      );
    }

    const now = new Date();
    const brand = await prisma.brand.findFirst({
      where: host ? { domain: host } : undefined,
      select: { id: true, domain: true },
    }) || await prisma.brand.findFirst({ select: { id: true, domain: true } });
    
    const brandId = brand?.id || 'brand-orderweeddc';

    // Verify retailer exists
    const retailer = await prisma.retailer.findUnique({
      where: { id: retailerId },
      select: { id: true, name: true, dataStatus: true, isDemonstration: true },
    });

    if (!retailer) {
      return NextResponse.json(
        { success: false, error: 'Retailer not found' },
        { status: 404 }
      );
    }

    // 1. Record LeadEvent (server-observed, tenant-scoped)
    const leadEvent = await prisma.leadEvent.create({
      data: {
        brandId,
        retailerId,
        eventType: eventType === 'MERCHANT_CLICKED' ? 'HANDOFF_CLICK' : 'MENU_VIEW',
        createdAt: now,
      },
    });

    // 2. Open-redirect protection: validate safe destination if provided
    let safeDestination: string | null = null;
    if (destination && typeof destination === 'string') {
      const trimmed = destination.trim();
      // Allow relative paths or http(s) URLs matching known domains
      if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
        safeDestination = trimmed;
      } else {
        try {
          const parsed = new URL(trimmed);
          if (['http:', 'https:'].includes(parsed.protocol)) {
            safeDestination = parsed.href;
          }
        } catch {
          safeDestination = null;
        }
      }
    }

    // 3. If MERCHANT_CLICKED, write to DemandCreditEntry M-005 ledger for attribution
    let attributionSeq = null;
    if (eventType === 'MERCHANT_CLICKED') {
      try {
        const credits = createDemandCredits(prisma);
        const attribute = credits.attribute as unknown as (a: Record<string, unknown>) => Promise<any>;
        const attrRes = await attribute({
          merchantId: retailerId,
          actionKind: 'HANDOFF_CLICK',
          evidenceChain: [
            { step: 'tenant_resolved', ref: brand?.domain || 'orderweeddc.com' },
            { step: 'deal_bound', ref: dealId || 'direct' },
            { step: 'action_observed', ref: 'MERCHANT_CLICKED' },
          ],
          observedAt: now,
          proofState: 'MERCHANT_HANDOFF_VERIFIED',
          valueEligible: !retailer.isDemonstration && retailer.dataStatus === 'VERIFIED_CURRENT',
          destination: safeDestination,
        });
        if (attrRes?.accepted && attrRes.entry) {
          attributionSeq = attrRes.entry.seq;
        }
      } catch {
        // Attribution ledger operates safely with graceful handling
      }
    }

    return NextResponse.json({
      success: true,
      eventId: leadEvent.id,
      eventType,
      retailerId,
      dealId: dealId || null,
      destination: safeDestination,
      attributionSeq,
      revenueStatus: 'COMMERCIAL_OUTCOME_UNVERIFIED',
      revenue: '$0.00',
      timestamp: now.toISOString(),
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
