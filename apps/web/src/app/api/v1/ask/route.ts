import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { compileIntent } from '@/lib/ask/intent-ir.mjs';
import { answerIntent } from '@/lib/ask/ask-service.mjs';
import { recordAskWork } from '@/lib/ask/ask-work.mjs';

/**
 * PUBLIC API v1 — ASK ORDERWEEDDC (Track A vertical slice).
 *
 * REAL USER INTENT -> USEFUL EVIDENCE-GATED ANSWER -> MERCHANT OPPORTUNITY.
 *
 * Commitments, enforced below:
 *  1. SAME TRUTH BOUNDARY AS THE UI. Candidates pass the identical double
 *     gate (currentPublicRecordWhere + isPubliclyVerified) every rendered
 *     page uses. Demonstration data cannot answer a real customer.
 *  2. UNKNOWN LOOKS LIKE UNKNOWN. The Intent IR's unknown dimensions are in
 *     the payload verbatim. A zero-candidate result is an explicit honest
 *     state, never an empty-200 shrug and never invented supply.
 *  3. REAL INTENT BECOMES BOUNDED WORK. Public observations are pseudonymously
 *     deduplicated and throttled before one atomic signal/work write.
 *  4. THE SAME EVIDENCE EXPOSES OPPORTUNITY. A located intent with zero
 *     verified candidates emits a MARKET_GAP Opportunity (verification
 *     UNKNOWN, no invented value) plus a bounded FOLLOW_UP continuation
 *     trigger (OBSERVE_ONLY, budgeted, stop-conditioned, expiring) so CANA
 *     becomes due for a registered capability consumer. The wake never claims
 *     the re-check itself happened.
 *  5. FAIL CLOSED. An unreadable store is a 503, not an empty answer.
 *     Instrumentation/continuation writes degrade honestly: the answer still
 *     returns, with recorded:false flags — never a fabricated receipt.
 */

export const dynamic = 'force-dynamic';

const API_VERSION = 'v1';
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') ?? '').slice(0, 500);
  const host = request.headers.get('host') ?? '';
  const domain = host.split(':')[0];

  if (q.trim().length === 0) {
    return NextResponse.json(
      { api_version: API_VERSION, error: 'EMPTY_QUERY', detail: 'q is required' },
      { status: 400, headers: { 'X-API-Version': API_VERSION } },
    );
  }

  let brand;
  const now = new Date();
  const intent = compileIntent(q, { now });
  try {
    brand = await prisma.brand.findUnique({ where: { domain }, select: { id: true, name: true } });
  } catch {
    return NextResponse.json(
      { api_version: API_VERSION, error: 'STORE_UNAVAILABLE', detail: 'evidence-gated store could not be read' },
      { status: 503, headers: { 'X-API-Version': API_VERSION } },
    );
  }
  if (!brand) {
    return NextResponse.json(
      { api_version: API_VERSION, error: 'UNKNOWN_TENANT', detail: `host "${domain}" is not a configured tenant` },
      { status: 421, headers: { 'X-API-Version': API_VERSION } },
    );
  }

  let answer;
  try {
    answer = await answerIntent(prisma, { intent, brandId: brand.id, tenantDomain: domain, now });
  } catch {
    return NextResponse.json(
      { api_version: API_VERSION, error: 'STORE_UNAVAILABLE', detail: 'evidence-gated store could not be read' },
      { status: 503, headers: { 'X-API-Version': API_VERSION } },
    );
  }

  const recording = await recordAskWork(prisma, {
    answer,
    domain,
    intent,
    now,
  });

  return NextResponse.json(
    {
      api_version: API_VERSION,
      generated_at: now.toISOString(),
      tenant: { domain, name: brand.name },
      intent,
      answer: {
        verified_candidate_count: answer.verified_candidate_count,
        zero_verified_result: answer.zero_verified_result,
        zero_result_reason: answer.zero_result_reason,
        unsupported_known_dimensions: answer.unsupported_known_dimensions,
        zero_result_meaning: answer.zero_verified_result
          ? answer.zero_result_reason === 'NO_VERIFIED_CURRENT_MATCH'
            ? 'No VERIFIED_CURRENT record matches this supported intent. This is an honest absence, not proof that no supply exists.'
            : 'CANA cannot make this intent decision-eligible from its current verified dimensions. No supply or eligibility conclusion was inferred.'
          : null,
        candidates: answer.candidates,
      },
      opportunity: recording.opportunity,
      instrumentation: {
        recording_state: recording.state,
        signal_recorded: recording.signalRecorded,
        opportunity_recorded: recording.opportunityRecorded,
        continuation_armed: recording.continuationArmed,
      },
      truth_contract: {
        gate: 'currentPublicRecordWhere + isPubliclyVerified — identical to rendered pages',
        unknowns: 'unknown intent dimensions are listed verbatim and never guessed',
        opportunities: 'opportunity value claims default verification UNKNOWN; acting on one requires authority',
      },
    },
    { status: 200, headers: { 'X-API-Version': API_VERSION, 'Cache-Control': 'no-store' } },
  );
}
