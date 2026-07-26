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
  let evidenceDetail: string | null = null;
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
      //   EVIDENCE_WRITE_DEFERRED    — the write failed AND the record is spilled to
      //                                durable storage, so it is genuinely recoverable.
      //   EVIDENCE_WRITE_LOST        — the write failed AND the spill failed. Nothing
      //                                will recover it. This state is the truth that
      //                                DEFERRED used to hide.
      //   EVIDENCE_WRITE_FAILED      — a real error; must NOT be retried blindly.
      //   VALUE_ELIGIBLE             — set by the GRADE, independent of write success.
      //
      // VERIFIER FINDING F1 (MEDIUM), CONFIRMED AND REPAIRED HERE.
      //
      // This block previously took the BEST of two independent write outcomes instead
      // of the WORST. `evidenceWriteState` was set from the LeadEvent write and then
      // OVERWRITTEN to SUCCEEDED whenever the separate attribution call came back
      // accepted or DUPLICATE. DUPLICATE is a read-only fast path that succeeds even
      // while writes are locked — so a LeadEvent that was genuinely lost to contention
      // reported EVIDENCE_WRITE_SUCCEEDED. Measured under an induced 9s write stall:
      // 150 handoffs, header SUCCEEDED on all 150, only 148 rows persisted.
      //
      // That is precisely the collapse this comment block promises never happens, in
      // the code the promise is written on. Two writes now keep two states and the
      // header reports the WORST of them, because a report that a burst succeeded is
      // only true if every part of it did.
      const leadWrite = await recordHandoffEvent(prisma, { brandId: brand.id, retailerId: id });
      let leadState = leadWrite.state;

      const credits = createDemandCredits(prisma) as unknown as {
        attribute: (a: Record<string, unknown>) => Promise<{ accepted?: boolean; denial_code?: string }>;
      };
      const attributed = await credits.attribute({
        merchantId: id, actionKind: 'HANDOFF', evidenceChain, observedAt,
        proofState: grade.state, valueEligible: grade.value_eligible === true,
        interactionNonce: nonce,
        destination: grade.value_eligible ? handoff.destination : null,
      });

      // A refused DUPLICATE is a successful outcome for THE ATTRIBUTION — the event is
      // already in the ledger and a replay must not be re-queued forever. It says
      // nothing whatsoever about whether the LeadEvent was written, which is the
      // inference that produced F1.
      const attributionOk = attributed?.accepted === true
        || attributed?.denial_code === 'DUPLICATE_ATTRIBUTION';
      const attributionDenied = !attributionOk && typeof attributed?.denial_code === 'string';
      let attributionState = attributionOk
        ? 'EVIDENCE_WRITE_SUCCEEDED'
        : (attributionDenied ? 'EVIDENCE_WRITE_FAILED' : 'EVIDENCE_WRITE_DEFERRED');

      // SPILL what the database refused, so DEFERRED stops meaning LOST. Without a
      // drain, "safe to retry later" was aspirational — nothing retried it.
      const { spillEvidence } = await import('@/lib/evidence-spill.mjs');
      const spill = spillEvidence as unknown as (r: Record<string, unknown>) =>
        Promise<{ spilled: boolean }>;

      if (leadState === 'EVIDENCE_WRITE_DEFERRED') {
        const s = await spill({
          kind: 'LEAD_EVENT', brandId: brand.id, retailerId: id,
          eventType: 'HANDOFF_CLICK', occurredAt: observedAt.toISOString(),
        });
        if (!s.spilled) leadState = 'EVIDENCE_WRITE_LOST';
      }
      if (attributionState === 'EVIDENCE_WRITE_DEFERRED') {
        const s = await spill({
          kind: 'ATTRIBUTION', merchantId: id, actionKind: 'HANDOFF', evidenceChain,
          observedAt: observedAt.toISOString(), proofState: grade.state,
          valueEligible: grade.value_eligible === true, interactionNonce: nonce,
          destination: grade.value_eligible ? handoff.destination : null,
        });
        if (!s.spilled) attributionState = 'EVIDENCE_WRITE_LOST';
      }

      // WORST-OF, explicitly ordered. Anything other than "both wrote" is not a
      // success, and the header must not round up to one.
      const SEVERITY = ['EVIDENCE_WRITE_SUCCEEDED', 'EVIDENCE_WRITE_DEFERRED',
                        'EVIDENCE_WRITE_LOST', 'EVIDENCE_WRITE_FAILED'];
      evidenceWriteState = [leadState, attributionState]
        .reduce((worst, s) => (SEVERITY.indexOf(s) > SEVERITY.indexOf(worst) ? s : worst));
      // Both components are reported too, so an operator can see WHICH half degraded
      // rather than inferring it. The aggregate alone cannot distinguish "the click
      // log was lost" from "the ledger entry was lost", and those need different
      // responses.
      evidenceDetail = `lead=${leadState};attribution=${attributionState}`;
    } catch {
      // The handoff is the product; attribution is bookkeeping. A consumer must
      // never be blocked, delayed, or redirected differently because it failed.
      // The state stays DEFERRED so the situation is visible rather than silent.
      // An exception escaping the bookkeeping block means we do not know what was
      // written. Reporting SUCCEEDED because an earlier line happened to set it would
      // be the same over-claim as F1, reached by a different route.
      if (evidenceWriteState === 'EVIDENCE_WRITE_SUCCEEDED') {
        evidenceWriteState = 'EVIDENCE_WRITE_DEFERRED';
        evidenceDetail = 'bookkeeping threw after a partial write; state is not known';
      }
    }

    const response = NextResponse.redirect(handoff.destination, 303);
    response.headers.set('Cache-Control', 'no-store');
    // The states are surfaced, not merged. An operator can see that a consumer was
    // handed off while bookkeeping was deferred, which is exactly the situation that
    // would otherwise be invisible.
    response.headers.set('X-Consumer-Handoff', 'CONSUMER_HANDOFF_SUCCEEDED');
    response.headers.set('X-Evidence-Write', evidenceWriteState);
    if (evidenceDetail) response.headers.set('X-Evidence-Write-Detail', evidenceDetail);
    return response;
  } catch (error) {
    if (error instanceof HandoffError) {
      return unavailable(409);
    }
    console.error('[Retailer Handoff] Unexpected failure.');
    return unavailable(500);
  }
}
