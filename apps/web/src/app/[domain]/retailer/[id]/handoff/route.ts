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

  const { domain, id } = await context.params;
  const brand = await prisma.brand.findUnique({
    where: { domain },
    select: { id: true },
  });
  if (!brand) {
    return unavailable(404);
  }

  try {
    const handoff = await recordVerifiedHandoff(prisma, {
      brandId: brand.id,
      retailerId: id,
    });
    // GRADED EVIDENCE AT THE REAL SURFACE. This is a genuine consumer handoff: a
    // same-origin form POST from a rendered page, with a server-verified
    // destination. That is materially stronger than an anonymous API call, so it
    // earns a real interaction token — issued and consumed server-side, never
    // handed to the client.
    //
    // Until now nothing issued a token, so INTERACTION_VERIFIED and
    // MERCHANT_HANDOFF_VERIFIED were unreachable in production and every recorded
    // action was REQUEST_RECEIVED. The grading was honest but inert.
    //
    // The ledger is called DIRECTLY rather than over HTTP. My first version made the
    // server POST to its own /api/v1/attribution and it failed with ECONNRESET —
    // and would have been wrong anyway: undici ignores a manually set Host header,
    // so the request would have arrived as 127.0.0.1 and been refused 421. A server
    // round-tripping to itself to reach code it can import is fragile indirection.
    try {
      const secret = process.env.CANA_INTERACTION_SECRET ?? '';
      if (secret) {
        const [{ issueInteractionToken, verifyInteractionToken, gradeInteraction },
               { createDemandCredits }] = await Promise.all([
          import('@/lib/interaction-proof.mjs'),
          import('@/lib/demand-credits.mjs'),
        ]);
        const observedAt = new Date();
        const { token } = issueInteractionToken({
          secret, tenant: domain, merchantId: id,
          actionKind: 'HANDOFF', surface: `/retailer/${id}`, now: observedAt,
        });
        const tokenResult = verifyInteractionToken({
          secret, token, tenant: domain, merchantId: id, actionKind: 'HANDOFF', now: observedAt,
        });
        // interaction-proof.mjs has no .d.ts, so TS infers the parameter shape from
        // its destructuring defaults and demands nonceAlreadySeen. Pass it
        // explicitly: replay here is already handled by the ledger's own identity
        // constraint, so a second submit is refused as a duplicate, not regraded.
        const grade = gradeInteraction({
          tokenResult, destination: handoff.destination, nonceAlreadySeen: false,
        }) as { state: string; value_eligible: boolean; destination?: string };
        const evidenceChain = [
          { step: 'tenant_resolved', ref: `${domain}#${brand.id}` },
          { step: 'same_origin_form_post', ref: `/retailer/${id}/handoff` },
          { step: 'destination_verified', ref: String(handoff.destination).slice(0, 200) },
          { step: 'interaction_graded', ref: grade.state },
        ];
        const credits = createDemandCredits(prisma) as unknown as {
          attribute: (a: Record<string, unknown>) => Promise<{ accepted?: boolean }>;
        };
        // A duplicate is refused by the ledger, which is correct: a consumer who
        // double-submits within the window performed one handoff.
        await credits.attribute({
          merchantId: id, actionKind: 'HANDOFF', evidenceChain, observedAt,
          proofState: grade.state, valueEligible: grade.value_eligible === true,
          interactionNonce: tokenResult?.payload?.n ?? null,
          destination: grade.state === 'MERCHANT_HANDOFF_VERIFIED' ? grade.destination : null,
        });
      }
    } catch {
      // The handoff is the product; attribution is bookkeeping. A consumer must
      // never be blocked or delayed by it.
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
