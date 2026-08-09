/**
 * ASK ORDERWEEDDC — answer + opportunity service (Track A, Slice 1).
 *
 * REAL USER INTENT -> USEFUL, EVIDENCE-GATED ANSWER -> MERCHANT OPPORTUNITY.
 *
 * Truth commitments (same gates as every rendered page and v1 endpoint):
 *  - Candidates pass currentPublicRecordWhere() AND isPubliclyVerified() —
 *    the identical double gate the UI uses. Demonstration data cannot answer
 *    a real customer.
 *  - Location matching is case-insensitive `contains` (the documented
 *    SQLite->PostgreSQL silent-failure class: "dupont" must match
 *    "Dupont Circle").
 *  - A zero-candidate answer is an HONEST answer, not a failure — and it is
 *    exactly the evidence from which a MARKET_GAP opportunity is emitted.
 *  - Opportunity value claims default verification UNKNOWN. Nothing here
 *    manufactures demand, revenue or certainty.
 *
 * The continuation kernel wiring (follow-up monitoring of an emitted
 * opportunity) lives in the route so this module stays read-only over
 * market truth.
 */

import { currentPublicRecordWhere } from '../seo-truth.mjs';
import { isPubliclyVerified } from '../data-status.mjs';

const MAX_CANDIDATES = 10;

/**
 * Build the Prisma `where` for an intent. Pure — unit-testable without a
 * database. Tenancy runs through the menu graph exactly like the UI and the
 * v1 retailers endpoint (Retailer has no brandId column).
 */
export function buildCandidateWhere(intent, { brandId, now = new Date() }) {
  const where = {
    ...currentPublicRecordWhere(now),
    menus: { some: { brandMenus: { some: { brandId } } } },
  };
  const location = intent?.dimensions?.location;
  if (location?.status === 'KNOWN' && typeof location.value === 'string') {
    // Case-insensitive by explicit mode — never rely on collation defaults.
    where.OR = [
      { address: { contains: location.value, mode: 'insensitive' } },
      { city: { contains: location.value, mode: 'insensitive' } },
    ];
  }
  return where;
}

/**
 * Answer an intent from the evidence-gated store.
 * Returns candidates (verified only, provenance attached), plus an
 * opportunity spec when the evidence itself exposes a market gap.
 */
export async function answerIntent(prisma, { intent, brandId, tenantDomain, now = new Date() }) {
  const where = buildCandidateWhere(intent, { brandId, now });

  const rows = await prisma.retailer.findMany({
    where,
    select: {
      id: true, name: true, type: true, address: true, city: true, state: true, zip: true,
      lat: true, lng: true, phone: true, website: true, hours: true, hoursSource: true,
      licenseStatus: true, dataStatus: true, dataSource: true, sourceUrl: true,
      retrievedAt: true, verifiedAt: true, freshnessExpiresAt: true, confidence: true,
      isDemonstration: true,
    },
    orderBy: [
      { isDemonstration: 'asc' }, { verifiedAt: 'desc' },
      { freshnessExpiresAt: 'desc' }, { id: 'asc' },
    ],
    take: MAX_CANDIDATES,
  });

  const iso = (v) => (v instanceof Date ? v.toISOString() : v ?? null);

  // Belt and braces: the same post-query publication gate as the UI/API.
  const candidates = rows.filter((r) => isPubliclyVerified(r, now)).map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    location: { address: r.address, city: r.city, state: r.state, postal_code: r.zip, latitude: r.lat, longitude: r.lng },
    contact: { phone: r.phone, website: r.website },
    hours: { text: r.hours, source: r.hoursSource },
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

  // MERCHANT-ACTIONABLE OPPORTUNITY from the SAME evidence.
  // Slice 1 emits exactly one class: a located intent that verified supply
  // cannot answer is a MARKET_GAP. The observed state IS the evidence.
  let opportunitySpec = null;
  const location = intent?.dimensions?.location;
  if (candidates.length === 0 && location?.status === 'KNOWN') {
    opportunitySpec = {
      tenant: tenantDomain,
      kind: 'MARKET_GAP',
      retailerId: null,
      signal: intent.raw_query,
      evidence: JSON.stringify({
        intent_ir: intent,
        query_gate: 'currentPublicRecordWhere + isPubliclyVerified',
        verified_candidates: 0,
        observed_at: now.toISOString(),
      }),
      observedState: JSON.stringify({
        location: location.value,
        category: intent.dimensions.category?.value ?? null,
        verified_candidate_count: 0,
      }),
      hypothesizedValue: null, // no invented dollar figure — UNKNOWN stays UNKNOWN
      confidence: null,
      recommendedAction:
        `Verify merchant coverage for "${location.value}": recruit or verify a merchant serving this area, ` +
        'or verify existing-but-unverified records so real supply becomes answerable.',
      requiredAuthority: 'PROPOSE_ONLY',
      risk: 'LOW — proposal only; no customer-facing or merchant-facing effect until authorized',
      rollback: 'Dismiss the opportunity; no state to roll back',
      measurementPlan:
        'Re-run this intent against the evidence-gated store on each follow-up tick; ' +
        'the gap is CLOSED when verified candidates > 0, PERSISTENT otherwise.',
    };
  }

  return {
    candidates,
    verified_candidate_count: candidates.length,
    zero_verified_result: candidates.length === 0,
    opportunitySpec,
  };
}
