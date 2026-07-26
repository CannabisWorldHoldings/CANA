import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { currentPublicRecordWhere } from '@/lib/seo-truth.mjs';
import { isPubliclyVerified } from '@/lib/data-status.mjs';

/**
 * PUBLIC API v1 — deals.
 *
 * WHY DEALS ARE THE HIGHEST-STAKES CONTRACT SO FAR. A retailer record is a
 * description; a deal is a COMMERCIAL OFFER with an expiry date. If a partner
 * republishes an expired or unverified deal, a real person travels somewhere
 * expecting a price that no longer exists. So this endpoint carries two
 * independent time boundaries, not one:
 *
 *   1. RECORD FRESHNESS — is our knowledge of the deal still current?
 *      (freshnessExpiresAt, the same boundary every other surface uses)
 *   2. OFFER VALIDITY — is the deal itself still live?
 *      (expiryDate and isActive, which are properties of the OFFER)
 *
 * A record can be freshly verified and describe an offer that ended yesterday.
 * Publishing it because "the record is current" would be technically defensible
 * and practically a lie. Both boundaries must pass.
 *
 * FURTHER COMMITMENTS, enforced below:
 *
 *  3. THE RETAILER MUST ALSO BE PUBLISHABLE. A verified deal attached to a
 *     demonstration retailer is not publishable: the offer has no real place to
 *     be redeemed. Verifying the deal alone would leak demonstration retailers
 *     through their deals — the truth boundary must hold across the JOIN, which
 *     is exactly where boundaries usually leak.
 *  4. NO DISCOUNT MATH. The stored discount string is passed through verbatim.
 *     Parsing "20% off" into a computed saving would invent a number no one
 *     verified, and a wrong saving figure is worse than none.
 *  5. TENANT SCOPED through the real menu graph.
 *  6. FAIL CLOSED. An unreadable store returns 503, never an empty 200 that a
 *     client reads as "this retailer has no deals".
 */

export const dynamic = 'force-dynamic';

const API_VERSION = 'v1';
const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 20;

function clampInt(raw: string | null, fallback: number, min: number, max: number) {
  const n = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v ?? null);

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const pageSize = clampInt(url.searchParams.get('pageSize'), DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
  const page = clampInt(url.searchParams.get('page'), 1, 1, 10_000);
  const host = (request.headers.get('host') ?? '').split(':')[0];
  const now = new Date();

  const brand = await prisma.brand.findUnique({ where: { domain: host }, select: { id: true, name: true } });
  if (!brand) {
    return NextResponse.json(
      { api_version: API_VERSION, error: 'UNKNOWN_TENANT', detail: `host "${host}" is not a configured tenant` },
      { status: 421, headers: { 'X-API-Version': API_VERSION, 'Cache-Control': 'no-store' } },
    );
  }

  // BOUNDARY 1 (record freshness) + BOUNDARY 2 (offer validity) + COMMITMENT 3
  // (the retailer must itself be publishable) + COMMITMENT 5 (tenant scope).
  const where = {
    ...currentPublicRecordWhere(now),
    isActive: true,
    expiryDate: { gt: now },
    retailer: {
      ...currentPublicRecordWhere(now),
      menus: { some: { brandMenus: { some: { brandId: brand.id } } } },
    },
  } as Record<string, unknown>;

  let rows: Array<Record<string, unknown>> = [];
  let total = 0;
  try {
    [rows, total] = await Promise.all([
      prisma.deal.findMany({
        where,
        select: {
          id: true, title: true, description: true, discount: true, code: true,
          expiryDate: true, isActive: true,
          dataStatus: true, dataSource: true, sourceUrl: true, retrievedAt: true,
          verifiedAt: true, freshnessExpiresAt: true, confidence: true, isDemonstration: true,
          retailer: {
            select: {
              id: true, name: true, city: true, state: true,
              dataStatus: true, isDemonstration: true,
              verifiedAt: true, freshnessExpiresAt: true,
            },
          },
        },
        // Truth-first, then soonest-expiring so a consumer sees what is about to
        // lapse. Sponsorship is not selected, so it cannot reach ordering.
        orderBy: [
          { isDemonstration: 'asc' }, { verifiedAt: 'desc' },
          { expiryDate: 'asc' }, { id: 'asc' },
        ],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }) as unknown as Promise<Array<Record<string, unknown>>>,
      prisma.deal.count({ where }),
    ]);
  } catch {
    return NextResponse.json(
      { api_version: API_VERSION, error: 'STORE_UNAVAILABLE', detail: 'deal store could not be read' },
      { status: 503, headers: { 'X-API-Version': API_VERSION, 'Cache-Control': 'no-store' } },
    );
  }

  const data = rows
    // Belt and braces, applied AFTER the query so a future change to the
    // where-clause cannot silently publish an expired offer, an unverified deal,
    // or a deal belonging to a record the site itself withholds.
    .filter((d) => {
      if (!isPubliclyVerified(d)) return false;
      const r = d.retailer as Record<string, unknown> | null;
      if (!r || !isPubliclyVerified(r)) return false;
      if (d.isActive !== true) return false;
      const exp = d.expiryDate instanceof Date ? d.expiryDate : new Date(String(d.expiryDate));
      if (!Number.isFinite(exp.getTime()) || exp <= now) return false;
      return true;
    })
    .map((d) => {
      const r = d.retailer as Record<string, unknown>;
      return {
        id: d.id,
        title: d.title,
        description: d.description,
        // COMMITMENT 4 — verbatim. No parsing, no computed saving.
        discount: d.discount,
        promo_code: d.code,
        offer: {
          expires_at: iso(d.expiryDate),
          is_active: d.isActive === true,
          // Stated so a consumer of the API knows the offer window was checked,
          // not merely that the record was fresh.
          offer_validity_checked: true,
        },
        retailer: {
          id: r.id, name: r.name, city: r.city, state: r.state,
          // The retailer's own boundary state travels with the offer, so an
          // integrator cannot claim they could not tell.
          data_status: r.dataStatus,
          is_demonstration: !!r.isDemonstration,
        },
        provenance: {
          data_status: d.dataStatus,
          source: d.dataSource,
          source_url: d.sourceUrl,
          retrieved_at: iso(d.retrievedAt),
          verified_at: iso(d.verifiedAt),
          freshness_expires_at: iso(d.freshnessExpiresAt),
          confidence: d.confidence,
          is_demonstration: !!d.isDemonstration,
        },
      };
    });

  return NextResponse.json(
    {
      api_version: API_VERSION,
      generated_at: now.toISOString(),
      tenant: { domain: host, name: brand.name },
      pagination: {
        page, page_size: pageSize, total_matching: total,
        max_page_size: MAX_PAGE_SIZE, returned: data.length,
      },
      ordering: {
        rule: 'truth-first: demonstration last, then most recently verified, then soonest to expire, then stable id',
        sponsorship_affects_order: false,
        note: 'Paid placement is a display attribute only. It is not selected by this endpoint and cannot influence this sequence.',
      },
      truth_contract: {
        boundaries_applied: [
          'record freshness — our knowledge of the deal is still current',
          'offer validity — the deal itself has not expired and is active',
          'retailer publishability — the deal is attached to a record the site itself publishes',
        ],
        why_two_time_boundaries:
          'A record can be freshly verified and describe an offer that ended yesterday. Publishing it because the record is current would be technically defensible and practically a lie.',
        discount_parsing: 'none — the stored discount string is passed through verbatim. A computed saving would invent a number nobody verified.',
        provenance_included: true,
        not_claimed: ['ranking position', 'traffic', 'popularity', 'endorsement', 'savings amount', 'availability at time of visit'],
      },
      data,
    },
    {
      status: 200,
      headers: {
        'X-API-Version': API_VERSION,
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json',
      },
    },
  );
}
