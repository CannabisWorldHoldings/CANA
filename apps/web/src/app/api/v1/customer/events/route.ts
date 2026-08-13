import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createDemandCredits } from '@/lib/demand-credits.mjs';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { eventType, retailerId, dealId, contactNormalized, campaignId } = body;

    if (!eventType || !['DEAL_VIEWED', 'MERCHANT_CLICKED', 'OPTIN_COMPLETED'].includes(eventType)) {
      return NextResponse.json({ success: false, error: 'eventType must be DEAL_VIEWED, MERCHANT_CLICKED, or OPTIN_COMPLETED' }, { status: 400 });
    }

    if (!retailerId || typeof retailerId !== 'string') {
      return NextResponse.json({ success: false, error: 'retailerId is required' }, { status: 400 });
    }

    const now = new Date();
    const brand = await prisma.brand.findFirst({ select: { id: true } });
    const brandId = brand?.id || 'brand-orderweeddc';

    // 1. Record LeadEvent
    const leadEvent = await prisma.leadEvent.create({
      data: {
        brandId,
        retailerId,
        eventType: eventType === 'MERCHANT_CLICKED' ? 'HANDOFF_CLICK' : 'MENU_VIEW',
        createdAt: now,
      },
    });

    // 2. If MERCHANT_CLICKED, write to DemandCreditEntry M-005 ledger for attribution
    let attributionSeq = null;
    if (eventType === 'MERCHANT_CLICKED') {
      try {
        const credits = createDemandCredits(prisma);
        const attribute = credits.attribute as unknown as (a: Record<string, unknown>) => Promise<any>;
        const attrRes = await attribute({
          merchantId: retailerId,
          actionKind: 'HANDOFF_CLICK',
          evidenceChain: [
            { step: 'tenant_resolved', ref: 'orderweeddc' },
            { step: 'deal_bound', ref: dealId || 'direct' },
            { step: 'action_observed', ref: 'MERCHANT_CLICKED' },
          ],
          observedAt: now,
          proofState: 'MERCHANT_HANDOFF_VERIFIED',
          valueEligible: true,
        });
        if (attrRes?.accepted && attrRes.entry) {
          attributionSeq = attrRes.entry.seq;
        }
      } catch (err) {
        // Fallback gracefully without breaking event record
      }
    }

    return NextResponse.json({
      success: true,
      eventId: leadEvent.id,
      eventType,
      retailerId,
      dealId: dealId || null,
      attributionSeq,
      revenueStatus: 'COMMERCIAL_OUTCOME_UNVERIFIED',
      revenue: '$0.00',
      timestamp: now.toISOString(),
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message || 'Internal server error' }, { status: 500 });
  }
}
