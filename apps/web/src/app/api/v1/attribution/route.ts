import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createDemandCredits, ACTION_KINDS } from '@/lib/demand-credits.mjs';
import { isPubliclyVerified } from '@/lib/data-status.mjs';
import { verifyInteractionToken, gradeInteraction, contributesToValue } from '@/lib/interaction-proof.mjs';

/**
 * PUBLIC API v1 — attribution.
 *
 * THE GAP THIS CLOSES. The demand-credit ledger has had a rigorous
 * attribute() since it was built, and the merchant pilot READS
 * ATTRIBUTION rows to compute proof of value. But nothing ever WROTE one from a
 * real consumer action: there was no HTTP surface at all, only /api/health and
 * /api/v1/retailers. So the revenue chain had a hole in the middle — a merchant
 * could be shown "attributed actions" only if rows were inserted by hand.
 *
 * A hand-inserted attribution row is exactly the fabricated metric this system
 * exists to refuse. This endpoint is the only honest way to close it: real
 * consumer actions, observed server-side, written through the ledger's own
 * guards.
 *
 * DESIGN COMMITMENTS, each enforced below rather than documented:
 *
 *  1. THE LEDGER REMAINS THE ONLY WRITER. This route does not INSERT. It calls
 *     the ledger's attribute(), so every ledger guard (evidence-chain validation,
 *     64-link cap, own-property link checks, idempotency, hash chaining) applies
 *     without being reimplemented — and cannot drift from it.
 *
 *  2. THE SERVER BUILDS THE EVIDENCE, NOT THE CLIENT. A caller supplies only
 *     what it legitimately knows (which retailer, which action). Every evidence
 *     link is constructed here from server-observed facts. If the client could
 *     supply the chain, it could supply the proof — which is the forgery the
 *     merchant pilot's own CRITICAL fix was about.
 *
 *  3. TRUTH BOUNDARY. An action against a DEMONSTRATION retailer is REFUSED, not
 *     recorded. Demonstration traffic must never become commercial evidence.
 *
 *  4. TENANT SCOPED. The retailer must belong to the calling host's brand, so
 *     one tenant cannot manufacture attribution for another's merchant.
 *
 *  5. NO CLAIM IS RETURNED. The response reports that an action was recorded and
 *     nothing more — no ranking, no lift, no lead, no value.
 */

export const dynamic = 'force-dynamic';

const API_VERSION = 'v1';

/** Actions a consumer surface may legitimately report. */
const REPORTABLE = new Set(ACTION_KINDS as readonly string[]);

function fail(error: string, detail: string, status: number) {
  return NextResponse.json(
    { api_version: API_VERSION, recorded: false, error, detail },
    { status, headers: { 'X-API-Version': API_VERSION, 'Cache-Control': 'no-store' } },
  );
}

export async function POST(request: NextRequest) {
  const host = (request.headers.get('host') ?? '').split(':')[0];

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return fail('MALFORMED_BODY', 'a JSON object body is required', 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return fail('MALFORMED_BODY', 'a JSON object body is required', 400);
  }

  const retailerId = typeof body.retailer_id === 'string' ? body.retailer_id.trim() : '';
  const actionKind = typeof body.action_kind === 'string' ? body.action_kind.trim() : '';
  // VERIFIER FINDING A6 (HIGH). This comment previously claimed the ledger's
  // digest-dedupe made an idempotency key unnecessary — "a caller cannot
  // double-count by simply omitting or varying the key". That was FALSE, and
  // falsified by the server's own behaviour: the evidence chain embedded
  // observedAt.toISOString(), so every request produced a DIFFERENT digest and the
  // ledger's dedupe could never fire. Five identical POSTs produced five counted
  // actions with five distinct digests.
  //
  // A comment asserting a guard that does not exist is worse than no comment: it
  // is the reason nobody looked. The fix has two parts —
  //   (a) the evidence digest is no longer varied by a per-request timestamp, so
  //       the ledger's dedupe can actually fire on a genuine replay, and
  //   (b) an explicit dedupe window, because two DISTINCT consumer actions of the
  //       same kind minutes apart are legitimately different events while five in
  //       one second are not.
  const idempotencyKey =
    typeof body.idempotency_key === 'string' && body.idempotency_key.trim() !== ''
      ? body.idempotency_key.trim().slice(0, 200)
      : null;

  if (!retailerId) return fail('RETAILER_REQUIRED', 'retailer_id must be a non-blank string', 400);
  if (!REPORTABLE.has(actionKind)) {
    return fail('UNKNOWN_ACTION', `action_kind must be one of ${[...REPORTABLE].join('|')}`, 400);
  }

  // Reject anything the client tried to smuggle in. Silently ignoring an
  // evidence_chain field would mean a caller could believe it was supplying
  // proof, and a future edit might start honouring it.
  for (const forbidden of ['evidence_chain', 'evidenceChain', 'evidence_chain_sha256',
                           'evidenceChainSha256', 'observed_at', 'observedAt', 'amount',
                           'relationship_owner', 'relationshipOwner', 'seq', 'entry_hash']) {
    if (forbidden in body) {
      return fail('CLIENT_SUPPLIED_EVIDENCE_REFUSED',
        `${forbidden} is server-observed and may not be supplied by a caller — a client that could supply the evidence could supply the proof`, 400);
    }
  }

  const brand = await prisma.brand.findUnique({ where: { domain: host }, select: { id: true, name: true } });
  if (!brand) return fail('UNKNOWN_TENANT', `host "${host}" is not a configured tenant`, 421);

  // COMMITMENT 4 — the retailer must be reachable from THIS tenant's menu graph.
  let retailer: Record<string, unknown> | null = null;
  try {
    retailer = (await prisma.retailer.findFirst({
      where: {
        id: retailerId,
        menus: { some: { brandMenus: { some: { brandId: brand.id } } } },
      },
      select: {
        id: true, name: true, dataStatus: true, isDemonstration: true,
        verifiedAt: true, freshnessExpiresAt: true,
      },
    })) as unknown as Record<string, unknown> | null;
  } catch {
    // Fail closed. An unreadable store must not silently drop a real action, and
    // must certainly not record one it could not validate.
    return fail('STORE_UNAVAILABLE', 'retailer store could not be read', 503);
  }
  if (!retailer) {
    return fail('RETAILER_NOT_IN_TENANT',
      'no such retailer on this tenant — attribution may not be recorded across tenants', 404);
  }

  // COMMITMENT 3 — demonstration traffic can never become commercial evidence.
  if (retailer.isDemonstration === true || !isPubliclyVerified(retailer)) {
    return fail('DEMONSTRATION_OR_UNVERIFIED_RETAILER',
      'this retailer is demonstration or unverified data; recording an attributed action against it would manufacture a commercial result', 409);
  }

  // COMMITMENT 2 — the server builds every evidence link from what IT observed.
  const observedAt = new Date();
  // DEDUPE WINDOW. The digest is bucketed to a coarse interval instead of an exact
  // millisecond, so identical actions inside one window collapse to one digest and
  // the ledger refuses the replay — while the SAME action in a later window is a
  // genuinely distinct event and is correctly counted. A millisecond timestamp made
  // every request unique, which is precisely what defeated the dedupe.
  const DEDUPE_WINDOW_MS = 5 * 60_000;
  const bucket = Math.floor(observedAt.getTime() / DEDUPE_WINDOW_MS);
  const evidenceChain = [
    { step: 'tenant_resolved', ref: `${host}#${brand.id}` },
    { step: 'retailer_verified_in_tenant', ref: `${retailer.id}#${String(retailer.dataStatus)}` },
    // The window, not the millisecond. The exact observation time is still recorded
    // on the ledger row itself (observedAt), so no precision is lost from the
    // record — only from the DEDUPE KEY, which is the whole point.
    { step: 'action_observed', ref: `${actionKind}@window:${bucket}` },
    { step: 'server_receipt', ref: `api/v1/attribution#${API_VERSION}` },
  ];

  // GRADED EVIDENCE. An independent verifier asked whether the four server-built
  // links proved a CONSUMER acted. They did not — they proved a request arrived. A
  // curl loop and a real customer were indistinguishable.
  //
  // The answer is not to claim more, it is to GRADE. An interaction token this
  // server issued for a rendered surface, bound to this tenant/merchant/action and
  // unexpired, raises the grade. Its absence does not block recording — a
  // REQUEST_RECEIVED row is still a true record of a request — but it carries NO
  // merchant value, and that is enforced below rather than described.
  const secret = process.env.CANA_INTERACTION_SECRET ?? '';
  const presentedToken = typeof body.interaction_token === 'string' ? body.interaction_token : null;
  const destination = typeof body.destination === 'string' && body.destination.trim() !== ''
    ? body.destination.trim().slice(0, 500) : null;

  const tokenResult = presentedToken
    ? verifyInteractionToken({
        secret, token: presentedToken, tenant: host,
        merchantId: String(retailer.id), actionKind, now: observedAt,
      })
    : null;

  // Replay: a nonce already recorded for this merchant is not a second interaction.
  let nonceAlreadySeen = false;
  if (tokenResult?.valid && tokenResult.payload?.n) {
    try {
      const seen = await prisma.demandCreditEntry.findFirst({
        where: { merchantId: String(retailer.id), kind: 'ATTRIBUTION',
                 interactionNonce: tokenResult.payload.n },
        select: { id: true },
      });
      nonceAlreadySeen = !!seen;
    } catch { nonceAlreadySeen = false; }
  }

  const grade = gradeInteraction({ tokenResult, destination, nonceAlreadySeen });

  const credits = createDemandCredits(prisma);
  // The ledger's real contract is { accepted, denial_code, denial_detail } / { accepted, entry }.
  // My first draft assumed { ok, error } and would have treated EVERY successful
  // write as a refusal — and, worse, every refusal as a success on the fallback
  // path. Bound to the actual shape.
  let result: {
    accepted?: boolean; denial_code?: string; denial_detail?: string;
    entry?: Record<string, unknown>;
  };
  try {
    // demand-credits.mjs carries no .d.ts, so TS infers idempotencyKey's type
    // from its `= null` parameter default and rejects a string. The runtime
    // contract accepts a string; the cast is on the ARGUMENT SHAPE only and
    // widens nothing about the guards themselves.
    const attribute = credits.attribute as unknown as (a: Record<string, unknown>) => Promise<typeof result>;
    result = await attribute({
      merchantId: String(retailer.id),
      actionKind,
      evidenceChain,
      observedAt,
      idempotencyKey,
      proofState: grade.state,
      valueEligible: grade.value_eligible === true,
      interactionNonce: tokenResult?.valid ? (tokenResult.payload?.n ?? null) : null,
      destination: grade.state === 'MERCHANT_HANDOFF_VERIFIED' ? grade.destination : null,
    });
  } catch {
    return fail('LEDGER_UNAVAILABLE', 'the attribution ledger could not be written', 503);
  }

  if (!result?.accepted) {
    const code = result?.denial_code ?? 'ATTRIBUTION_REFUSED';
    // A duplicate refused by the DATABASE constraint (not by the pre-insert lookup)
    // is the concurrency case. Return the row that WON so a retrying caller learns
    // what actually happened instead of guessing, and state which layer decided.
    if (code === 'DUPLICATE_ATTRIBUTION') {
      const existing = (result as { existing?: Record<string, unknown> }).existing ?? null;
      return NextResponse.json(
        {
          api_version: API_VERSION, recorded: false, error: code,
          detail: result?.denial_detail ?? 'this event is already recorded',
          decided_by: (result as { decided_by?: string }).decided_by ?? 'application check',
          existing_attribution: existing
            ? { ledger_seq: existing.seq, observed_at: existing.observedAt, evidence_digest: existing.evidenceChainSha256 }
            : null,
        },
        { status: 409, headers: { 'X-API-Version': API_VERSION, 'Cache-Control': 'no-store' } },
      );
    }
    if (code === 'CHAIN_POSITION_CONTENDED') {
      // Honest: this is retryable and NOT a duplicate. Saying 409 would tell the
      // caller the action was already counted, which is false.
      return NextResponse.json(
        { api_version: API_VERSION, recorded: false, error: code,
          detail: result?.denial_detail ?? 'chain position contended; retry' },
        { status: 503, headers: { 'X-API-Version': API_VERSION, 'Cache-Control': 'no-store', 'Retry-After': '1' } },
      );
    }
    // A duplicate is a successful REFUSAL, not a server fault: the ledger
    // correctly declined to inflate proof of value. 409 says so honestly.
    const status = code === 'DUPLICATE_ATTRIBUTION' ? 409 : 400;
    return fail(code, result?.denial_detail ?? 'the ledger refused this action', status);
  }

  const entry = result.entry ?? {};
  return NextResponse.json(
    {
      api_version: API_VERSION,
      recorded: true,
      // What was recorded — deliberately thin. No value, no ranking, no lift.
      attribution: {
        retailer_id: retailer.id,
        action_kind: actionKind,
        observed_at: observedAt.toISOString(),
        ledger_seq: entry.seq ?? null,
        evidence_links: evidenceChain.length,
        evidence_digest: entry.evidenceChainSha256 ?? null,
      },
      truth_contract: {
        evidence_built_by: 'server',
        client_supplied_evidence_accepted: false,
        demonstration_data_recorded: false,
        // VERIFIER FINDING A8 (MEDIUM). Asked whether the four evidence links prove
        // a CONSUMER acted, the verifier answered no, and it was right: the links
        // reference the tenant, the retailer, the action kind and this endpoint —
        // none references a person. No IP, session, user-agent or interaction
        // token. The chain proves an HTTP REQUEST ARRIVED claiming an action
        // against a valid, verified, tenant-scoped retailer. That is a real and
        // useful thing to prove, and it is NOT proof of a human being.
        //
        // The honest response is to say so in the receipt itself rather than let
        // "server-observed evidence" be read as more than it is. Overstating this
        // is exactly the fabricated-metric failure the whole system refuses.
        proof_state: grade.state,
        value_eligible: contributesToValue(grade.state),
        proves: grade.proves,
        does_not_prove: grade.does_not_prove,
        outcome_state: grade.outcome_state ?? 'COMMERCIAL_OUTCOME_UNVERIFIED',
        grading_notes: grade.notes,
        consumer_identity_bound: false,
        replay_protection: 'identical actions within a 5-minute window collapse to one evidence digest and are refused by the ledger',
        not_claimed: ['ranking position', 'traffic', 'popularity', 'lead', 'conversion lift', 'revenue',
                      'that a human consumer performed this action'],
        note: 'This receipt states only that an action was observed and recorded with server-built evidence. It asserts no commercial outcome and no proof of human interaction.',
      },
    },
    { status: 201, headers: { 'X-API-Version': API_VERSION, 'Cache-Control': 'no-store' } },
  );
}

/** A GET here is a common integration mistake; answer it clearly. */
export async function GET() {
  return fail('METHOD_NOT_ALLOWED', 'attribution is recorded with POST', 405);
}
