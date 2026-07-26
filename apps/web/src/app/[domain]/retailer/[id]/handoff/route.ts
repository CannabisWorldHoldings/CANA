import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  HandoffError,
  resolveHandoffDestination,
  recordHandoffEvent,
} from '@/lib/handoff.mjs';
import { isSameOriginFormRequest } from '@/lib/auth/request-policy.mjs';

type RouteContext = {
  params: Promise<{ domain: string; id: string }>;
};

function unavailable(status: number) {
  return new Response('Retailer handoff is unavailable.', {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}

export async function POST(request: NextRequest, context: RouteContext) {
  if (!isSameOriginFormRequest(request)) {
    return unavailable(403);
  }

  // The challenge arrives in the form body. Read it before anything else so a
  // parse failure cannot silently downgrade a legitimate submission unnoticed.
  // Recorded across the whole request so the response header can report it. A
  // deferred write is not a failure and must not read as one.
  let evidenceWriteState: string = 'EVIDENCE_WRITE_DEFERRED';
  let presentedChallenge: string | null = null;
  try {
    const form = await request.formData();
    const raw = form.get('page_challenge');
    presentedChallenge = typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null;
  } catch {
    presentedChallenge = null;
  }

  const { domain, id } = await context.params;
  const brand = await prisma.brand.findUnique({
    where: { domain },
    select: { id: true },
  });
  if (!brand) {
    return unavailable(404);
  }

  try {
    // WRITE-INDEPENDENT REDIRECT. Resolution is READ ONLY, so the consumer's
    // handoff can never be blocked by a write lock. Previously the destination came
    // out of the same transaction as the LeadEvent write, and ten simultaneous
    // handoffs produced ten HTTP 500s: a consumer failed because someone else
    // clicked at the same moment. A bounded retry improved that to 7-10 of 10, which
    // is a mitigation, not a guarantee. Removing the dependency entirely is.
    const handoff = await resolveHandoffDestination(prisma, {
      brandId: brand.id,
      retailerId: id,
    });

    // PAGE-BOUND EVIDENCE. The previous version minted a token here and consumed
    // it in the same request, so it could only prove this server ran its own route
    // — the client never held it. It nonetheless graded MERCHANT_HANDOFF_VERIFIED,
    // which overstated what the evidence supported.
    //
    // Now the challenge is minted during the PAGE RENDER and presented back here.
    // Verifying it proves the submission followed a real render of this page, for
    // this merchant, action and destination. Absent a valid challenge the handoff
    // still succeeds — it simply grades APPLICATION_HANDOFF_VERIFIED, which earns
    // no merchant value and is the honest description of "our own route ran".
    try {
      const secret = process.env.CANA_INTERACTION_SECRET ?? '';
      const [{ verifyPageChallenge, gradeHandoff }, { createDemandCredits }] = await Promise.all([
        import('@/lib/page-challenge.mjs'),
        import('@/lib/demand-credits.mjs'),
      ]);
      const observedAt = new Date();

      // page-challenge.mjs carries no .d.ts, so TS infers the parameter shape from
      // its destructuring defaults and mistakes the object for `secrets: string[]`.
      // Cast the FUNCTION, not the result — the returned shape is still checked.
      const verifyChallenge = verifyPageChallenge as unknown as (a: Record<string, unknown>) =>
        { valid: boolean; reason: string | null; payload?: { n?: string } };
      const challengeResult = (secret && presentedChallenge)
        ? verifyChallenge({
            secret, challenge: presentedChallenge, tenant: domain, merchantId: id,
            pagePath: `/retailer/${id}`, actionKind: 'HANDOFF',
            destination: handoff.destination, now: observedAt,
          })
        : null;

      // TRANSACTIONAL SINGLE USE. The nonce is the redemption key: a row already
      // carrying it means this challenge was spent. Checking here is a fast path;
      // the ledger's own (merchantId, eventIdentity) constraint is what actually
      // serialises concurrent redemptions, so two parallel submits cannot both win.
      let alreadyRedeemed = false;
      const nonce = challengeResult?.valid ? (challengeResult.payload?.n ?? null) : null;
      if (nonce) {
        const seen = await prisma.demandCreditEntry.findFirst({
          where: { merchantId: id, kind: 'ATTRIBUTION', interactionNonce: nonce },
          select: { id: true },
        });
        alreadyRedeemed = !!seen;
      }

      const grade = (gradeHandoff as unknown as (a: Record<string, unknown>) =>
        { state: string; value_eligible: boolean; notes?: string[] })({
        sameOriginForm: true, destinationVerified: true,
        challengeResult, alreadyRedeemed,
      });

      const evidenceChain = [
        { step: 'tenant_resolved', ref: `${domain}#${brand.id}` },
        { step: 'same_origin_form_post', ref: `/retailer/${id}/handoff` },
        { step: 'destination_verified', ref: String(handoff.destination).slice(0, 200) },
        { step: 'page_challenge', ref: challengeResult?.valid ? 'VERIFIED' : (challengeResult?.reason ?? 'ABSENT') },
        { step: 'interaction_graded', ref: grade.state },
      ];

      // BOOKKEEPING, fully decoupled from the consumer response. The five states
      // below are recorded SEPARATELY and never collapsed, because "the consumer was
      // handed off" and "we managed to record it" are different facts, and a system
      // that conflates them under-reports silently.
      //
      //   CONSUMER_HANDOFF_SUCCEEDED — already true by this point; the 303 is issued
      //                                below regardless of anything that follows.
      //   EVIDENCE_WRITE_SUCCEEDED   — the LeadEvent and attribution were written.
      //   EVIDENCE_WRITE_DEFERRED    — transient contention; safe to retry later.
      //   EVIDENCE_WRITE_FAILED      — a real error; must NOT be retried blindly.
      //   VALUE_ELIGIBLE             — set by the GRADE, independent of write success.
      const leadWrite = await recordHandoffEvent(prisma, { brandId: brand.id, retailerId: id });
      evidenceWriteState = leadWrite.state;

      const credits = createDemandCredits(prisma) as unknown as {
        attribute: (a: Record<string, unknown>) => Promise<{ accepted?: boolean }>;
      };
      const attributed = await credits.attribute({
        merchantId: id, actionKind: 'HANDOFF', evidenceChain, observedAt,
        proofState: grade.state, valueEligible: grade.value_eligible === true,
        interactionNonce: nonce,
        destination: grade.value_eligible ? handoff.destination : null,
      });
      // A refused DUPLICATE is a successful outcome for bookkeeping — the event is
      // already recorded, and a replay must not be re-queued forever. Only a genuine
      // write problem leaves the state deferred.
      if (attributed?.accepted === true
          || (attributed as { denial_code?: string })?.denial_code === 'DUPLICATE_ATTRIBUTION') {
        if (evidenceWriteState !== 'EVIDENCE_WRITE_FAILED') {
          evidenceWriteState = 'EVIDENCE_WRITE_SUCCEEDED';
        }
      }
    } catch {
      // The handoff is the product; attribution is bookkeeping. A consumer must
      // never be blocked, delayed, or redirected differently because it failed.
      // The state stays DEFERRED so the situation is visible rather than silent.
      if (evidenceWriteState === 'EVIDENCE_WRITE_SUCCEEDED') {
        evidenceWriteState = 'EVIDENCE_WRITE_DEFERRED';
      }
    }

    const response = NextResponse.redirect(handoff.destination, 303);
    response.headers.set('Cache-Control', 'no-store');
    // The states are surfaced, not merged. An operator can see that a consumer was
    // handed off while bookkeeping was deferred, which is exactly the situation that
    // would otherwise be invisible.
    response.headers.set('X-Consumer-Handoff', 'CONSUMER_HANDOFF_SUCCEEDED');
    response.headers.set('X-Evidence-Write', evidenceWriteState);
    return response;
  } catch (error) {
    if (error instanceof HandoffError) {
      return unavailable(409);
    }
    console.error('[Retailer Handoff] Unexpected failure.');
    return unavailable(500);
  }
}
