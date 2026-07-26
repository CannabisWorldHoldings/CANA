import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { currentPublicRecordWhere } from '@/lib/seo-truth.mjs';
import { isPubliclyVerified } from '@/lib/data-status.mjs';
import { NEIGHBORHOOD_CONFIGS } from '@/lib/neighborhood-configs.mjs';
import {
  NEIGHBORHOOD_CANDIDATE_LIMIT,
  NEIGHBORHOOD_LATITUDE_WINDOW,
  NEIGHBORHOOD_LONGITUDE_WINDOW,
} from '@/lib/neighborhood-search.mjs';

/**
 * PUBLIC API v1 — neighborhoods.
 *
 * WHY AN AGGREGATE IS ITS OWN KIND OF DANGER. Every other v1 surface publishes
 * RECORDS, and a record carries its own provenance: a consumer can inspect each
 * row and decide what to trust. A neighborhood payload publishes a NUMBER —
 * "12 dispensaries in Shaw" — and a number is a claim built from many records
 * at once. If one demonstration or unverified retailer slips into the total,
 * the payload contains no row a consumer could inspect to notice: the lie is
 * baked into the arithmetic. So the boundary here is applied to the INPUTS of
 * the count, not to the output:
 *
 *   A COUNT INCLUDES ONLY RETAILERS THAT WOULD THEMSELVES BE PUBLISHED by
 *   /api/v1/retailers — currentPublicRecordWhere() in the query AND
 *   isPubliclyVerified() re-checked per record after it. Counting is
 *   publication. A record the site would withhold cannot be one-twelfth of a
 *   number the site asserts.
 *
 * WHY THIS DOES NOT REUSE neighborhoodCandidateWhere(). The UI pages use that
 * helper, and it deliberately admits demonstration records — on a rendered page
 * each demo row is individually LABELLED as a demo, so showing it is honest. A
 * bare integer in an API payload has no per-row label. Reusing the UI's
 * where-clause here would silently count demos into the total, which is exactly
 * the aggregate dishonesty this contract exists to prevent. The GEOMETRY is
 * reused (same config, same window constants, same ZIP-or-window rule), the
 * visibility boundary is not.
 *
 * ZERO VERSUS WITHHELD — the distinction this endpoint enforces hardest:
 *
 *   - retailer_count: 0  means "we measured and found none". The query
 *     succeeded and no publishable retailer sits in the window.
 *   - retailer_count ABSENT (asserted: false, withheld_reason set) means "we
 *     cannot claim this". It happens when the candidate set exceeds the
 *     verification cap: beyond NEIGHBORHOOD_CANDIDATE_LIMIT rows we will not
 *     re-verify every record individually, so we refuse to assert an exact
 *     number rather than publish one we did not check. Publishing the capped
 *     figure would understate; publishing the raw prisma count() would skip the
 *     second boundary. Withholding is the only honest option left.
 *
 * The commitments every other v1 surface makes also hold here:
 *
 *  1. TENANT SCOPED through the real menu graph (menus -> brandMenus -> brand);
 *     an unknown Host is refused with 421, never defaulted.
 *  2. FAIL CLOSED. An unreadable store returns 503, never an empty 200 that a
 *     client would read as "this tenant has no neighborhoods". A wrong zero
 *     from a broken store is the aggregate version of a leaked record.
 *  3. BOUNDED. Pagination is clamped; garbage parameters fall back.
 *  4. ORDERING is declared and sponsorship-neutral. Sponsorship is not even
 *     selected, so it cannot reach the sequence OR the arithmetic.
 *  5. DETERMINISTIC GEOGRAPHY. A retailer is in a neighborhood when its ZIP is
 *     in the curated list or its recorded coordinates fall inside a fixed
 *     latitude/longitude window. No radius tuning, no geocoding guesses.
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

type NeighborhoodConfig = {
  name: string;
  lat: number;
  lng: number;
  zips: string[];
  blurb: string;
};

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

  // Neighborhood definitions are curated configuration, not user-submitted
  // rows, so the "record set" is static. Alphabetical slug order is the whole
  // ordering rule: an aggregate listing must not imply rank, and a stable
  // sequence keeps pagination non-overlapping.
  const slugs = Object.keys(NEIGHBORHOOD_CONFIGS).sort();
  const total = slugs.length;
  const pageSlugs = slugs.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);

  // Track rows the query returned but the second boundary rejected. A non-zero
  // value means the where-clause and the publication gate have drifted apart —
  // the exact failure the double application exists to catch.
  let postQueryRejections = 0;

  type Aggregated = {
    slug: string;
    config: NeighborhoodConfig;
    countAsserted: boolean;
    retailerCount: number | null;
    verifiedBetween: { oldest: string | null; newest: string | null } | null;
  };

  let aggregated: Aggregated[] = [];
  try {
    aggregated = await Promise.all(
      pageSlugs.map(async (slug) => {
        const config = NEIGHBORHOOD_CONFIGS[slug as keyof typeof NEIGHBORHOOD_CONFIGS] as NeighborhoodConfig;

        // BOUNDARY, FIRST APPLICATION — in the query. Same gate as
        // /api/v1/retailers plus the same tenant scoping, intersected with the
        // deterministic geography the neighborhood pages use.
        const where = {
          ...currentPublicRecordWhere(now),
          menus: { some: { brandMenus: { some: { brandId: brand.id } } } },
          AND: [
            {
              OR: [
                { zip: { in: [...new Set(config.zips)] } },
                {
                  lat: {
                    gte: config.lat - NEIGHBORHOOD_LATITUDE_WINDOW,
                    lte: config.lat + NEIGHBORHOOD_LATITUDE_WINDOW,
                  },
                  lng: {
                    gte: config.lng - NEIGHBORHOOD_LONGITUDE_WINDOW,
                    lte: config.lng + NEIGHBORHOOD_LONGITUDE_WINDOW,
                  },
                },
              ],
            },
          ],
        } as Record<string, unknown>;

        // The count is NOT prisma.count(). A count() cannot be re-verified
        // record by record, and the second application of the boundary is
        // non-negotiable. Fetch the truth fields of every candidate (one row
        // past the cap, so overflow is observable) and count only the rows
        // that survive re-verification.
        const candidates = (await prisma.retailer.findMany({
          where,
          select: {
            id: true, dataStatus: true, isDemonstration: true,
            verifiedAt: true, freshnessExpiresAt: true,
          },
          orderBy: { id: 'asc' },
          take: NEIGHBORHOOD_CANDIDATE_LIMIT + 1,
        })) as Array<Record<string, unknown>>;

        if (candidates.length > NEIGHBORHOOD_CANDIDATE_LIMIT) {
          // WITHHELD, not zero and not the capped figure. We did not verify
          // every contributing record, so we do not assert the number.
          postQueryRejections += candidates.filter((c) => !isPubliclyVerified(c, now)).length;
          return { slug, config, countAsserted: false, retailerCount: null, verifiedBetween: null };
        }

        // BOUNDARY, SECOND APPLICATION — per record, after the query, so a
        // future edit to the where-clause cannot silently count a record the
        // site itself would withhold.
        const counted = candidates.filter((c) => isPubliclyVerified(c, now));
        postQueryRejections += candidates.length - counted.length;

        // Aggregate provenance: the verification-time span of the counted
        // records, so a consumer can see how fresh the inputs to the number
        // are without us re-publishing the records themselves.
        const verifiedTimes = counted
          .map((c) => (c.verifiedAt instanceof Date ? c.verifiedAt.getTime() : NaN))
          .filter((t) => Number.isFinite(t));
        const verifiedBetween = counted.length > 0 && verifiedTimes.length === counted.length
          ? {
              oldest: new Date(Math.min(...verifiedTimes)).toISOString(),
              newest: new Date(Math.max(...verifiedTimes)).toISOString(),
            }
          : null;

        return { slug, config, countAsserted: true, retailerCount: counted.length, verifiedBetween };
      }),
    );
  } catch {
    // FAIL CLOSED. A broken store must not degrade into "every neighborhood
    // has zero retailers" — for an aggregate endpoint an invented zero IS the
    // data leak, just pointed in the other direction.
    return NextResponse.json(
      { api_version: API_VERSION, error: 'STORE_UNAVAILABLE', detail: 'retailer store could not be read' },
      { status: 503, headers: { 'X-API-Version': API_VERSION, 'Cache-Control': 'no-store' } },
    );
  }

  const data = aggregated.map(({ slug, config, countAsserted, retailerCount, verifiedBetween }) => ({
    slug,
    name: config.name,
    blurb: config.blurb,
    area: {
      center: { latitude: config.lat, longitude: config.lng },
      latitude_window: NEIGHBORHOOD_LATITUDE_WINDOW,
      longitude_window: NEIGHBORHOOD_LONGITUDE_WINDOW,
      postal_codes: [...new Set(config.zips)],
      rule: 'a retailer belongs to this neighborhood when its postal code is listed above OR its recorded coordinates fall inside the fixed window around the center',
    },
    aggregate: {
      // THE COUNT BOUNDARY. The key is present only when every contributing
      // record was individually re-verified. An absent key means "we will not
      // assert this" — it never means zero, and zero never means "unknown".
      ...(countAsserted ? { retailer_count: retailerCount } : {}),
      asserted: countAsserted,
      withheld_reason: countAsserted
        ? null
        : `more than ${NEIGHBORHOOD_CANDIDATE_LIMIT} candidate records; an exact count would require asserting records we did not individually re-verify, so it is withheld rather than published`,
      basis: 'count of retailers that would individually be published by /api/v1/retailers — verified, current, non-demonstration, reachable through this tenant',
      verified_between: verifiedBetween,
    },
    provenance: {
      kind: 'computed_aggregate',
      definition_source: 'curated neighborhood configuration — static geography, not user-submitted and not derived from traffic',
      inputs: 'verified retailer records reachable through this tenant menu graph at computation time',
      boundary: 'currentPublicRecordWhere() in the query; isPubliclyVerified() re-checked on every counted record',
      computed_at: now.toISOString(),
      candidate_cap: NEIGHBORHOOD_CANDIDATE_LIMIT,
      is_demonstration: false,
    },
  }));

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
        rule: 'curated and rank-free: stable alphabetical slug. An aggregate listing implies no ranking, and truth-first ordering is enforced on the counted records themselves — only publishable records reach any total.',
        sponsorship_affects_order: false,
        note: 'Paid placement is a display attribute only. It is not selected by this endpoint and cannot influence this sequence or any count.',
      },
      truth_contract: {
        boundaries_applied: [
          'record freshness on every counted retailer — currentPublicRecordWhere() at query time',
          'per-record re-verification — isPubliclyVerified() applied again after the query, twice in total',
          'tenant scope through the real menu graph (menus -> brandMenus -> brand)',
          'deterministic geography — curated ZIP list OR fixed coordinate window, not an advertising radius',
        ],
        count_policy:
          'A neighborhood count includes ONLY retailers that would themselves be published by /api/v1/retailers. A demonstration, unverified, or stale record never contributes to a total. Where an exact count cannot be honestly computed, retailer_count is ABSENT and asserted is false: withheld never means zero, and zero always means "measured and found none".',
        post_query_rejections: postQueryRejections,
        provenance_included: true,
        not_claimed: [
          'ranking position', 'traffic', 'popularity', 'endorsement',
          'retailer density beyond the verification cap',
          'legal or administrative neighborhood boundaries',
          'delivery coverage', 'availability at time of visit',
        ],
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
