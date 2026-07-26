import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  HandoffError,
  recordVerifiedHandoff,
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
    // CONCURRENCY. recordVerifiedHandoff writes a LeadEvent inside a transaction,
    // and concurrent submissions lose the SQLite write lock. My new integration
    // test exposed this: TEN simultaneous handoffs all returned 500. The defect
    // predates the evidence work — the route simply had never been exercised
    // concurrently — but a consumer whose handoff fails because someone else
    // clicked at the same moment is a broken product, not a bookkeeping problem.
    //
    // A lost lock race is TRANSIENT and the operation is idempotent from the
    // consumer's side, so a bounded retry is correct. It is bounded deliberately:
    // an unbounded retry converts contention into a queue that never drains.
    let handoff;
    for (let attempt = 0; ; attempt++) {
      try {
        handoff = await recordVerifiedHandoff(prisma, { brandId: brand.id, retailerId: id });
        break;
      } catch (e) {
        // A HandoffError is a REFUSAL (demonstration data, no safe destination) and
        // must never be retried — retrying a refusal just delays the same answer.
        // Measured, not guessed: 4 attempts absorbed only half of a 10-way burst,
        // so the ceiling is 8. Still bounded — an unbounded retry turns contention
        // into a queue that never drains — but high enough that a realistic
        // simultaneous-click burst completes.
        if (e instanceof HandoffError || attempt >= 8) throw e;
        const msg = String((e as { message?: string })?.message ?? '');
        const code = String((e as { code?: string })?.code ?? '');
        // The real codes under SQLite contention, measured rather than guessed: my
        // first list had SQLITE_BUSY and P2034 and caught NEITHER. Concurrent
        // handoffs actually surface P1008 (socket timeout waiting for the write
        // lock) and P2028 (transaction API error when the transaction is aborted).
        const contended = /SQLITE_BUSY|database is locked|write conflict|deadlock|Socket timeout|Transaction (?:already closed|api error)|P2034|P1008|P2028/i
          .test(`${code} ${msg}`);
        if (!contended) throw e;
        // Exponential backoff with jitter, so retries do not resynchronise into a
        // second thundering herd.
        await new Promise((r) => setTimeout(r, Math.min(800, 60 * 2 ** attempt) + Math.floor(Math.random() * 80)));
      }
    }
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

      const credits = createDemandCredits(prisma) as unknown as {
        attribute: (a: Record<string, unknown>) => Promise<{ accepted?: boolean }>;
      };
      await credits.attribute({
        merchantId: id, actionKind: 'HANDOFF', evidenceChain, observedAt,
        proofState: grade.state, valueEligible: grade.value_eligible === true,
        interactionNonce: nonce,
        destination: grade.value_eligible ? handoff.destination : null,
      });
    } catch {
      // The handoff is the product; attribution is bookkeeping. A consumer must
      // never be blocked, delayed, or redirected differently because it failed.
    }

    const response = NextResponse.redirect(handoff.destination, 303);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error) {
    if (error instanceof HandoffError) {
      return unavailable(409);
    }
    console.error('[Retailer Handoff] Unexpected failure.');
    return unavailable(500);
  }
}
