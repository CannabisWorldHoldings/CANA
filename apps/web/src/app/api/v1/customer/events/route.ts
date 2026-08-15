import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createDemandCredits, IDENTITY_WINDOW_MS } from '@/lib/demand-credits.mjs';
import { tenantDomainForRequestHostname } from '@/lib/tenant-host.mjs';

export const dynamic = 'force-dynamic';

const ALLOWED_EVENT_TYPES = ['DEAL_VIEWED', 'MERCHANT_CLICKED', 'OPTIN_COMPLETED'] as const;
type AllowedEventType = (typeof ALLOWED_EVENT_TYPES)[number];

function validateAndSanitizeDestination(
  destination: unknown,
  retailer: { id: string; website?: string | null; sourceUrl?: string | null }
): { safeDestination: string; isAttackerUrl: boolean } {
  const defaultDestination = `/retailer/${retailer.id}`;

  if (!destination || typeof destination !== 'string') {
    return { safeDestination: defaultDestination, isAttackerUrl: false };
  }

  const trimmed = destination.trim();

  // Attack signatures: javascript:, data:, vbscript:, protocol-relative //
  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith('javascript:') ||
    lower.startsWith('data:') ||
    lower.startsWith('vbscript:') ||
    lower.startsWith('//')
  ) {
    return { safeDestination: defaultDestination, isAttackerUrl: true };
  }

  // Safe relative paths
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    if (trimmed.startsWith('/retailer/') || trimmed.startsWith('/deals/')) {
      return { safeDestination: trimmed, isAttackerUrl: false };
    }
    return { safeDestination: defaultDestination, isAttackerUrl: false };
  }

  // Absolute URLs
  try {
    const parsed = new URL(trimmed);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { safeDestination: defaultDestination, isAttackerUrl: true };
    }

    // Check against retailer known domain or platform domain
    const allowedHosts = new Set<string>(['orderweeddc.com', 'orderweeddc.localhost', 'localhost']);
    if (retailer.website) {
      try {
        const retParsed = new URL(
          retailer.website.startsWith('http') ? retailer.website : `https://${retailer.website}`
        );
        allowedHosts.add(retParsed.hostname.toLowerCase());
      } catch {}
    }
    if (retailer.sourceUrl) {
      try {
        const srcParsed = new URL(retailer.sourceUrl);
        allowedHosts.add(srcParsed.hostname.toLowerCase());
      } catch {}
    }

    const targetHost = parsed.hostname.toLowerCase();
    if (allowedHosts.has(targetHost) || Array.from(allowedHosts).some((h) => targetHost.endsWith(`.${h}`))) {
      return { safeDestination: parsed.href, isAttackerUrl: false };
    }

    // Arbitrary external domain not bound to retailer -> refuse attacker destination
    return { safeDestination: defaultDestination, isAttackerUrl: true };
  } catch {
    return { safeDestination: defaultDestination, isAttackerUrl: true };
  }
}

export async function POST(request: NextRequest) {
  try {
    const host = (request.headers.get('host') ?? '').split(':')[0];
    const tenantDomain = tenantDomainForRequestHostname(host);

    // Resolve Brand server-side from host header
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
        { success: false, error: 'Brand tenant not configured for this host' },
        { status: 400 }
      );
    }

    const body = (await request.json()) as Record<string, unknown>;
    const eventType = body.eventType;
    const retailerId = body.retailerId;
    const dealId = body.dealId;
    const destination = body.destination;

    // Strict validation: Event type enum
    if (!eventType || typeof eventType !== 'string' || !ALLOWED_EVENT_TYPES.includes(eventType as AllowedEventType)) {
      return NextResponse.json(
        {
          success: false,
          error: `Invalid eventType '${String(eventType)}'. Allowed: ${ALLOWED_EVENT_TYPES.join(', ')}`,
        },
        { status: 400 }
      );
    }

    // Strict validation: Retailer ID format
    if (!retailerId || typeof retailerId !== 'string') {
      return NextResponse.json(
        { success: false, error: 'retailerId is required and must be a string' },
        { status: 400 }
      );
    }

    // Verify retailer exists
    const retailer = await prisma.retailer.findUnique({
      where: { id: retailerId },
      select: {
        id: true,
        name: true,
        dataStatus: true,
        isDemonstration: true,
        sourceUrl: true,
      },
    });

    if (!retailer) {
      return NextResponse.json({ success: false, error: 'Retailer not found' }, { status: 404 });
    }

    // If dealId provided, verify deal exists and binds to retailer
    if (dealId) {
      if (typeof dealId !== 'string') {
        return NextResponse.json(
          { success: false, error: 'dealId must be a string if provided' },
          { status: 400 }
        );
      }
      const deal = await prisma.deal.findUnique({
        where: { id: dealId },
        select: { id: true, retailerId: true },
      });
      if (!deal || deal.retailerId !== retailerId) {
        return NextResponse.json(
          { success: false, error: 'Deal not found or does not bind to this retailer' },
          { status: 400 }
        );
      }
    }

    // Safe Merchant Handoff Destination validation
    const { safeDestination, isAttackerUrl } = validateAndSanitizeDestination(
      destination,
      retailer
    );

    if (isAttackerUrl && destination) {
      return NextResponse.json(
        { success: false, error: 'Refused unsafe or unauthorized destination URL' },
        { status: 400 }
      );
    }

    const now = new Date();
    const windowStart = new Date(now.getTime() - IDENTITY_WINDOW_MS);
    const leadEventType = eventType === 'MERCHANT_CLICKED' ? 'HANDOFF_CLICK' : 'MENU_VIEW';

    // Anti-Inflation / Idempotency: Check existing LeadEvent within sliding window
    const existingLead = await prisma.leadEvent.findFirst({
      where: {
        brandId: brand.id,
        retailerId,
        eventType: leadEventType,
        createdAt: { gte: windowStart },
      },
      orderBy: { createdAt: 'desc' },
    });

    let leadEvent = existingLead;
    if (!leadEvent) {
      leadEvent = await prisma.leadEvent.create({
        data: {
          brandId: brand.id,
          retailerId,
          eventType: leadEventType,
          createdAt: now,
        },
      });
    }

    // DemandCreditEntry (M-005) Attribution for MERCHANT_CLICKED
    let attributionSeq = null;
    let attributionStatus = 'NONE';

    if (eventType === 'MERCHANT_CLICKED') {
      try {
        const credits = createDemandCredits(prisma);
        const attribute = credits.attribute as unknown as (
          a: Record<string, unknown>
        ) => Promise<{
          accepted?: boolean;
          entry?: { seq: number };
          existing?: { seq: number };
        }>;
        const attrRes = await attribute({
          merchantId: retailerId,
          actionKind: 'HANDOFF_CLICK',
          evidenceChain: [
            { step: 'tenant_resolved', ref: brand.domain },
            { step: 'deal_bound', ref: (dealId as string) || 'direct' },
            { step: 'action_observed', ref: 'MERCHANT_CLICKED' },
          ],
          observedAt: now,
          proofState: 'MERCHANT_HANDOFF_VERIFIED',
          valueEligible: !retailer.isDemonstration && retailer.dataStatus === 'VERIFIED_CURRENT',
          destination: safeDestination,
        });

        if (attrRes?.accepted && attrRes.entry) {
          attributionSeq = attrRes.entry.seq;
          attributionStatus = 'COMMITTED';
        } else if (attrRes?.existing) {
          attributionSeq = attrRes.existing.seq;
          attributionStatus = 'DEDUPLICATED';
        }
      } catch {
        attributionStatus = 'FAILED_GRACEFUL';
      }
    }

    return NextResponse.json({
      success: true,
      eventId: leadEvent.id,
      eventType,
      brandId: brand.id,
      retailerId,
      dealId: (dealId as string) || null,
      destination: safeDestination,
      attributionSeq,
      attributionStatus,
      proofState: 'MERCHANT_HANDOFF_VERIFIED',
      proofSemantic:
        'CANA recorded and validated outbound customer handoff click; does not prove merchant receipt, order placement, or commercial conversion.',
      revenueStatus: 'COMMERCIAL_OUTCOME_UNVERIFIED',
      revenue: '$0.00',
      timestamp: now.toISOString(),
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ success: false, error: errorMsg }, { status: 500 });
  }
}
