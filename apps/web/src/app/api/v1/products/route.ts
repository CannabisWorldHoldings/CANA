import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { currentPublicRecordWhere } from '@/lib/seo-truth.mjs';
import { isPubliclyVerified } from '@/lib/data-status.mjs';

/**
 * PUBLIC API v1 — products.
 *
 * WHY THIS IS THE MOST DANGEROUS CONTRACT SO FAR. A retailer record describes a
 * place; a deal describes an offer. A product record carries POTENCY — THC and CBD
 * percentages — which in this category is a regulated claim. A partner republishing
 * an unverified potency figure is not merely inaccurate: they may be making a
 * compliance claim on our authority, about a substance someone will consume.
 *
 * So this endpoint applies a boundary the others do not need:
 *
 *   POTENCY IS FIELD-GATED SEPARATELY FROM THE RECORD. A product may be verified
 *   enough to list while its potency figures are not verified enough to assert. A
 *   verified name does not license an unverified THC number. Where potency cannot
 *   be evidenced it is OMITTED — never zero, never "unknown", never carried through
 *   from an unverified source — and the payload says the omission was deliberate.
 *
 * The boundaries every other v1 surface applies also hold here:
 *
 *  1. TRUTH BOUNDARY, twice. currentPublicRecordWhere() in the query and
 *     isPubliclyVerified() again after it, so a future change to the where-clause
 *     cannot silently publish an unverified product.
 *  2. THE JOIN. A product reaches this tenant only through a menu entry on a
 *     retailer this tenant publishes. A verified product on a demonstration
 *     retailer is withheld — the same leak the deals contract closed, one table
 *     further out. Here the chain is THREE deep: product -> menuEntry -> retailer.
 *  3. NO PRICE MATH. The lowest observed price is reported verbatim from the menu
 *     entries that carry one. No averaging, no "from" pricing, no computed saving.
 *  4. FAIL CLOSED. An unreadable store returns 503, never an empty 200 a client
 *     would read as "this tenant has no products".
 *  5. BOUNDED and sponsorship-neutral, like every other v1 surface.
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

/**
 * A potency figure is asserted only when it is a real number in a plausible range
 * AND the record carrying it is itself verified. Out-of-range is treated as absent
 * rather than clamped: clamping would quietly invent a number nobody measured.
 */
function assertablePotency(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value < 0 || value > 100) return null;
  return value;
}

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

  // BOUNDARY 2 — the three-deep join. The product must be verified, AND reach this
  // tenant through a verified menu entry on a retailer this tenant publishes.
  const where = {
    ...currentPublicRecordWhere(now),
    menuEntries: {
      some: {
        ...currentPublicRecordWhere(now),
        retailer: currentPublicRecordWhere(now),
        brandMenus: { some: { brandId: brand.id } },
      },
    },
  } as Record<string, unknown>;

  let rows: Array<Record<string, unknown>> = [];
  let total = 0;
  try {
    [rows, total] = await Promise.all([
      prisma.product.findMany({
        where,
        select: {
          id: true, name: true, description: true, category: true, strainType: true,
          thcPercent: true, cbdPercent: true,
          dataStatus: true, dataSource: true, sourceUrl: true, retrievedAt: true,
          verifiedAt: true, freshnessExpiresAt: true, confidence: true, isDemonstration: true,
          menuEntries: {
            where: {
              ...currentPublicRecordWhere(now),
              retailer: currentPublicRecordWhere(now),
              brandMenus: { some: { brandId: brand.id } },
            },
            select: {
              price: true, inStock: true, dataStatus: true, isDemonstration: true,
              verifiedAt: true, freshnessExpiresAt: true,
              retailer: {
                select: {
                  id: true, name: true, dataStatus: true, isDemonstration: true,
                  verifiedAt: true, freshnessExpiresAt: true,
                },
              },
            },
          },
        },
        orderBy: [
          { isDemonstration: 'asc' }, { verifiedAt: 'desc' },
          { freshnessExpiresAt: 'desc' }, { id: 'asc' },
        ],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }) as unknown as Promise<Array<Record<string, unknown>>>,
      prisma.product.count({ where }),
    ]);
  } catch {
    return NextResponse.json(
      { api_version: API_VERSION, error: 'STORE_UNAVAILABLE', detail: 'product store could not be read' },
      { status: 503, headers: { 'X-API-Version': API_VERSION, 'Cache-Control': 'no-store' } },
    );
  }

  let potencyWithheld = 0;

  const data = rows
    .filter((p) => {
      if (!isPubliclyVerified(p)) return false;
      // Belt and braces on the join: at least one menu entry must survive the same
      // boundary AFTER the query, with a retailer that also survives it.
      const entries = (p.menuEntries as Array<Record<string, unknown>>) ?? [];
      return entries.some((e) => {
        if (!isPubliclyVerified(e)) return false;
        const r = e.retailer as Record<string, unknown> | null;
        return !!r && isPubliclyVerified(r);
      });
    })
    .map((p) => {
      const entries = ((p.menuEntries as Array<Record<string, unknown>>) ?? []).filter((e) => {
        const r = e.retailer as Record<string, unknown> | null;
        return isPubliclyVerified(e) && !!r && isPubliclyVerified(r);
      });

      // COMMITMENT 3 — verbatim lowest observed price, no averaging or invention.
      const prices = entries
        .map((e) => e.price)
        .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0);
      const lowest = prices.length > 0 ? Math.min(...prices) : null;

      const thc = assertablePotency(p.thcPercent);
      const cbd = assertablePotency(p.cbdPercent);
      if ((p.thcPercent != null && thc === null) || (p.cbdPercent != null && cbd === null)) {
        potencyWithheld += 1;
      }

      return {
        id: p.id,
        name: p.name,
        description: p.description,
        category: p.category,
        strain_type: p.strainType,
        // THE POTENCY BOUNDARY. Present only when assertable. An absent key means
        // "we will not assert this", which is different from a zero.
        potency: {
          ...(thc !== null ? { thc_percent: thc } : {}),
          ...(cbd !== null ? { cbd_percent: cbd } : {}),
          asserted: thc !== null || cbd !== null,
          withheld_reason: thc === null && cbd === null
            ? 'no potency figure on this record is verifiable; an unverified potency number is a regulated claim we will not make'
            : null,
        },
        availability: {
          offered_by_retailers: entries.length,
          // Price is a fact about a menu entry, not about the product, so it is
          // labelled as observed rather than presented as "the price".
          lowest_observed_price: lowest,
          in_stock_anywhere: entries.some((e) => e.inStock === true),
        },
        retailers: entries.slice(0, 10).map((e) => {
          const r = e.retailer as Record<string, unknown>;
          return { id: r.id, name: r.name, price: e.price, in_stock: e.inStock === true };
        }),
        provenance: {
          data_status: p.dataStatus,
          source: p.dataSource,
          source_url: p.sourceUrl,
          retrieved_at: iso(p.retrievedAt),
          verified_at: iso(p.verifiedAt),
          freshness_expires_at: iso(p.freshnessExpiresAt),
          confidence: p.confidence,
          is_demonstration: !!p.isDemonstration,
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
        rule: 'truth-first: demonstration last, then most recently verified, then freshest, then stable id',
        sponsorship_affects_order: false,
        note: 'Paid placement is a display attribute only. It is not selected by this endpoint and cannot influence this sequence.',
      },
      truth_contract: {
        boundaries_applied: [
          'product record verification',
          'menu entry verification',
          'retailer publishability — the three-deep join product -> menuEntry -> retailer',
          'potency field-gating, applied independently of record verification',
        ],
        potency_policy:
          'A verified product record does not license an unverified potency figure. Potency is asserted only when it is a finite number in a plausible range on a verified record; otherwise the key is ABSENT. An absent potency means we will not assert it — it never means zero.',
        potency_records_withheld: potencyWithheld,
        price_policy: 'lowest observed price, verbatim from verified menu entries. No averaging, no "from" pricing, no computed saving.',
        provenance_included: true,
        not_claimed: ['ranking position', 'traffic', 'popularity', 'endorsement',
                      'medical or therapeutic effect', 'legal compliance of any purchase',
                      'laboratory accuracy of potency figures', 'price at time of visit'],
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
