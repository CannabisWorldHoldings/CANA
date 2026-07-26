import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { currentPublicRecordWhere } from '@/lib/seo-truth.mjs';
import { isPubliclyVerified } from '@/lib/data-status.mjs';

/**
 * PUBLIC API v1 — retailers.
 *
 * The backend contract map found there was NO versioned API: every surface
 * queried Prisma directly from a server component, so a mobile client or a
 * partner had nothing to consume and no stability promise.
 *
 * DESIGN COMMITMENTS, each enforced below rather than merely documented:
 *
 *  1. TRUTH BOUNDARY IS THE SAME AS THE UI. This endpoint reuses
 *     currentPublicRecordWhere() and isPubliclyVerified() — the exact gates the
 *     rendered pages use. A separate query here would let the API drift into
 *     publishing records the site itself refuses to show, which is how
 *     "demonstration data leaked to a partner" happens.
 *
 *  2. PROVENANCE TRAVELS WITH EVERY VALUE. A consumer receives source,
 *     observation time, verification time, freshness window and confidence.
 *     An integrator who wants to be careful CAN be; one who does not at least
 *     cannot claim they were not told.
 *
 *  3. SPONSORSHIP IS DISCLOSED AND ORDER-NEUTRAL. The payload states the
 *     ordering rule explicitly. Sponsorship is not even selected here, so it
 *     cannot influence the sequence a client receives.
 *
 *  4. VERSIONED AND DEPRECATION-AWARE. The version is in the path and echoed in
 *     the body; a future v2 cannot silently change this shape.
 *
 *  5. BOUNDED. Page size is clamped, so a client cannot ask for the whole table.
 */

export const dynamic = 'force-dynamic';

const API_VERSION = 'v1';
const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 20;

/** Clamp an untrusted integer query param into a safe range. */
function clampInt(raw: string | null, fallback: number, min: number, max: number) {
  const n = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const pageSize = clampInt(url.searchParams.get('pageSize'), DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
  const page = clampInt(url.searchParams.get('page'), 1, 1, 10_000);
  const host = request.headers.get('host') ?? '';

  // Tenant resolution mirrors the UI: an unknown host is refused rather than
  // defaulting to some brand's data.
  const domain = host.split(':')[0];
  const brand = await prisma.brand.findUnique({ where: { domain }, select: { id: true, name: true } });
  if (!brand) {
    return NextResponse.json(
      {
        api_version: API_VERSION,
        error: 'UNKNOWN_TENANT',
        detail: `host "${domain}" is not a configured tenant`,
      },
      { status: 421, headers: { 'X-API-Version': API_VERSION } },
    );
  }

  // Tenancy is NOT a column on Retailer — it runs through the menu graph
  // (menus -> brandMenus -> brandId), exactly as tenantRetailerWhere() does for
  // the UI. My first attempt assumed a brandId field, the query threw, and the
  // fail-closed path correctly returned 503 rather than an empty 200. Mirroring
  // the UI's real scoping keeps the API from drifting from the pages.
  const where = {
    ...currentPublicRecordWhere(new Date()),
    menus: { some: { brandMenus: { some: { brandId: brand.id } } } },
  } as Record<string, unknown>;

  let rows: Array<Record<string, unknown>> = [];
  let total = 0;
  try {
    [rows, total] = await Promise.all([
      prisma.retailer.findMany({
        where,
        select: {
          id: true, name: true, type: true, address: true, city: true, state: true, zip: true,
          lat: true, lng: true, phone: true, website: true, hours: true, hoursSource: true,
          licenseStatus: true, licenseNumber: true, lastLicenseCheck: true,
          dataStatus: true, dataSource: true, sourceUrl: true, retrievedAt: true,
          verifiedAt: true, freshnessExpiresAt: true, confidence: true, isDemonstration: true,
        },
        // Truth-first. Sponsorship is not selected, so it cannot reach ordering.
        orderBy: [
          { isDemonstration: 'asc' }, { verifiedAt: 'desc' },
          { freshnessExpiresAt: 'desc' }, { id: 'asc' },
        ],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }) as unknown as Promise<Array<Record<string, unknown>>>,
      prisma.retailer.count({ where }),
    ]);
  } catch {
    // Fail closed: an unreadable store must not return an empty 200 that a
    // client would read as "there are no retailers".
    return NextResponse.json(
      { api_version: API_VERSION, error: 'STORE_UNAVAILABLE', detail: 'retailer store could not be read' },
      { status: 503, headers: { 'X-API-Version': API_VERSION } },
    );
  }

  const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v ?? null);

  const data = rows
    // Belt and braces: the same publication gate the UI applies, applied again
    // after the query, so a change to the where-clause cannot silently publish
    // an unverified record.
    .filter((r) => isPubliclyVerified(r))
    .map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      location: {
        address: r.address, city: r.city, state: r.state, postal_code: r.zip,
        latitude: r.lat, longitude: r.lng,
      },
      contact: { phone: r.phone, website: r.website },
      hours: { text: r.hours, source: r.hoursSource },
      license: {
        status: r.licenseStatus,
        number: r.licenseNumber,
        last_checked: iso(r.lastLicenseCheck),
      },
      // COMMITMENT 2 — provenance is not optional metadata, it is the payload.
      provenance: {
        data_status: r.dataStatus,
        source: r.dataSource,
        source_url: r.sourceUrl,
        retrieved_at: iso(r.retrievedAt),
        verified_at: iso(r.verifiedAt),
        freshness_expires_at: iso(r.freshnessExpiresAt),
        confidence: r.confidence,
        is_demonstration: !!r.isDemonstration,
      },
    }));

  return NextResponse.json(
    {
      api_version: API_VERSION,
      generated_at: new Date().toISOString(),
      tenant: { domain, name: brand.name },
      pagination: {
        page, page_size: pageSize, total_matching: total,
        max_page_size: MAX_PAGE_SIZE,
        returned: data.length,
      },
      ordering: {
        rule: 'truth-first: demonstration records last, then most recently verified, then freshest, then stable id',
        sponsorship_affects_order: false,
        note: 'Paid placement is a display attribute only. It is not selected by this endpoint and cannot influence this sequence.',
      },
      truth_contract: {
        publication_gate: 'Only records passing the public verification boundary are returned. Demonstration and stale records are withheld.',
        provenance_included: true,
        not_claimed: ['ranking position', 'traffic', 'popularity', 'endorsement'],
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
