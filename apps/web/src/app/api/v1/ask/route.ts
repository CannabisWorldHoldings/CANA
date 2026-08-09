import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { compileIntent } from '@/lib/ask/intent-ir.mjs';
import { answerIntent } from '@/lib/ask/ask-service.mjs';
import { createMission, createTrigger } from '@/lib/continuation/continuation-repository.mjs';

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
 *  3. EVERY REAL INTENT IS A SIGNAL. The ask is recorded (AskIntentSignal)
 *     with full IR and answer summary — provenance-carrying instrumentation.
 *  4. THE SAME EVIDENCE EXPOSES OPPORTUNITY. A located intent with zero
 *     verified candidates emits a MARKET_GAP Opportunity (verification
 *     UNKNOWN, no invented value) plus a bounded FOLLOW_UP continuation
 *     trigger (OBSERVE_ONLY, budgeted, stop-conditioned, expiring) so CANA
 *     itself re-checks the gap — no external assistant has to remember.
 *  5. FAIL CLOSED. An unreadable store is a 503, not an empty answer.
 *     Instrumentation/continuation writes degrade honestly: the answer still
 *     returns, with recorded:false flags — never a fabricated receipt.
 */

export const dynamic = 'force-dynamic';

const API_VERSION = 'v1';
const DAY_MS = 24 * 60 * 60 * 1000;

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

  const brand = await prisma.brand.findUnique({ where: { domain }, select: { id: true, name: true } });
  if (!brand) {
    return NextResponse.json(
      { api_version: API_VERSION, error: 'UNKNOWN_TENANT', detail: `host "${domain}" is not a configured tenant` },
      { status: 421, headers: { 'X-API-Version': API_VERSION } },
    );
  }

  const now = new Date();
  const intent = compileIntent(q, { now });

  let answer;
  try {
    answer = await answerIntent(prisma, { intent, brandId: brand.id, tenantDomain: domain, now });
  } catch {
    return NextResponse.json(
      { api_version: API_VERSION, error: 'STORE_UNAVAILABLE', detail: 'evidence-gated store could not be read' },
      { status: 503, headers: { 'X-API-Version': API_VERSION } },
    );
  }

  // Opportunity emission + bounded continuation. Honest degradation: flags
  // report what was actually recorded; nothing is claimed that did not happen.
  let opportunity: { id: string; kind: string; follow_up_trigger_id: string | null } | null = null;
  let opportunityRecorded = false;
  let continuationArmed = false;
  if (answer.opportunitySpec) {
    try {
      const created = await prisma.opportunity.create({
        data: { ...answer.opportunitySpec, verification: 'UNKNOWN', status: 'OPEN' },
      });
      opportunityRecorded = true;
      let followUpTriggerId: string | null = null;
      try {
        const mission = await createMission(prisma, {
          tenant: domain,
          purpose: `Monitor MARKET_GAP opportunity ${created.id} until closed, dismissed or expired`,
          createdFrom: 'TRACK_A_ASK',
          authorityCeiling: 'OBSERVE_ONLY',
          budgetCentsMax: 500,
          stopCondition:
            'Opportunity status leaves OPEN, or verified candidates > 0 on a follow-up check, or all follow-up triggers expire',
        });
        const trigger = await createTrigger(prisma, {
          missionId: mission.id,
          tenant: domain,
          triggerType: 'FOLLOW_UP',
          reason: `Re-check market gap for intent "${intent.raw_query}" against the evidence-gated store`,
          createdFrom: `OPPORTUNITY:${created.id}`,
          authorityCeiling: 'OBSERVE_ONLY',
          budgetCentsMax: 100,
          stopCondition: 'Gap closed (verified candidates > 0) or recurrence exhausted',
          nextEligibleAt: new Date(now.getTime() + DAY_MS),
          expiresAt: new Date(now.getTime() + 7 * DAY_MS),
          continuationPolicy: JSON.stringify({ kind: 'RESCHEDULE', intervalMs: DAY_MS, remaining: 2 }),
          evidenceRequirements: JSON.stringify({ recheck: 'verified_candidate_count', opportunityId: created.id }),
        }, { now });
        followUpTriggerId = trigger.id;
        continuationArmed = true;
        await prisma.opportunity.update({ where: { id: created.id }, data: { followUpTriggerId: trigger.id } });
      } catch {
        // continuation not armed; reported honestly below.
      }
      opportunity = { id: created.id, kind: created.kind, follow_up_trigger_id: followUpTriggerId };
    } catch {
      // opportunity not recorded; reported honestly below.
    }
  }

  let signalRecorded = false;
  try {
    await prisma.askIntentSignal.create({
      data: {
        tenant: domain,
        rawQuery: intent.raw_query,
        intentIr: JSON.stringify(intent),
        answerSummary: JSON.stringify({
          verified_candidate_count: answer.verified_candidate_count,
          zero_verified_result: answer.zero_verified_result,
          zero_result_reason: answer.zero_result_reason,
          unknown_dimensions: intent.unknown_dimensions,
          opportunity_emitted: !!answer.opportunitySpec,
        }),
        candidateCount: answer.verified_candidate_count,
        opportunityId: opportunity?.id ?? null,
      },
    });
    signalRecorded = true;
  } catch {
    // signal not recorded; reported honestly below.
  }

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
      opportunity,
      instrumentation: {
        signal_recorded: signalRecorded,
        opportunity_recorded: opportunityRecorded,
        continuation_armed: continuationArmed,
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
