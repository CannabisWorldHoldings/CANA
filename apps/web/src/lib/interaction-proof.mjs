import crypto, { createHmac, timingSafeEqual, createHash } from 'node:crypto';

/**
 * CONSUMER INTERACTION PROOF — graded evidence, honestly labelled.
 *
 * THE PROBLEM THIS EXISTS FOR. An independent verifier asked whether the
 * attribution endpoint's evidence proved a CONSUMER acted. It did not. The four
 * server-built links referenced the tenant, the retailer, the action kind and the
 * endpoint — none referenced a person. The chain proved an HTTP REQUEST ARRIVED.
 * A curl loop and a real customer were indistinguishable.
 *
 * The wrong fix is to claim more than we can prove. The right fix is to GRADE the
 * evidence and let each grade carry only the weight it earns.
 *
 *   REQUEST_RECEIVED             an HTTP request arrived claiming an action.
 *                                Recordable. Carries NO merchant value.
 *   INTERACTION_VERIFIED         a token this server issued for a specific
 *                                rendered surface came back, unexpired, unreplayed,
 *                                bound to this tenant and merchant.
 *   MERCHANT_HANDOFF_VERIFIED    the interaction additionally names the destination
 *                                the consumer was handed off to.
 *   COMMERCIAL_OUTCOME_UNVERIFIED  we know an interaction happened; we do NOT know
 *                                whether it produced a sale. Named explicitly so
 *                                nobody quietly promotes it.
 *   VALUE_PROVEN                 reserved. Requires merchant-confirmed outcome
 *                                evidence that does not exist yet, and is NEVER
 *                                reachable from anything in this module.
 *
 * THE LAW: no merchant value may be reported from REQUEST_RECEIVED alone. That is
 * enforced here, not documented here.
 *
 * WHAT A TOKEN STILL DOES NOT PROVE. A token proves the request came from a
 * surface this server rendered, for this merchant, once. A determined actor who
 * scripts a real browser can still obtain one. Bot-resistance is a separate
 * problem and this module does not claim to solve it — it claims exactly the
 * narrower thing it does prove, which is far more than an unauthenticated POST.
 */

const text = (v) => typeof v === 'string' && v.trim() !== '';
const sha = (s) => createHash('sha256').update(s).digest('hex');
const NONCE_BYTES = 12;
const NONCE_ALPHABET = 'abcdefghijklmnop';

function encodeNonce(bytes) {
  let encoded = '';
  for (const byte of bytes) {
    encoded += NONCE_ALPHABET[byte >> 4];
    encoded += NONCE_ALPHABET[byte & 0x0f];
  }
  return encoded;
}

/** Evidence grades, weakest first. Order is meaningful and is asserted in tests. */
export const PROOF_STATES = Object.freeze([
  'REQUEST_RECEIVED',
  'INTERACTION_VERIFIED',
  'MERCHANT_HANDOFF_VERIFIED',
  'COMMERCIAL_OUTCOME_UNVERIFIED',
  'VALUE_PROVEN',
]);

/** Grades that may contribute to a merchant-facing value figure. */
export const VALUE_ELIGIBLE = Object.freeze(new Set([
  'INTERACTION_VERIFIED',
  'MERCHANT_HANDOFF_VERIFIED',
]));

/** Tokens live briefly: a page the consumer has left is not an interaction. */
export const TOKEN_TTL_MS = 10 * 60_000;

/**
 * Issue an interaction token for a surface the server is about to render.
 *
 * The token is signed server-side and binds tenant, merchant, action kind and a
 * privacy-safe surface identity. It carries NO user identifier: the point is to
 * prove an interaction occurred on a real surface, not to identify a person.
 */
export function issueInteractionToken({ secret, tenant, merchantId, actionKind, surface, now = new Date() }) {
  if (!text(secret)) throw new Error('an interaction secret is required');
  if (!text(tenant) || !text(merchantId) || !text(actionKind)) {
    throw new Error('tenant, merchantId and actionKind are required to bind a token');
  }
  const payload = {
    v: 1,
    t: tenant.trim(),
    m: merchantId.trim(),
    a: actionKind.trim(),
    // A privacy-safe surface identity: which page, not which person.
    s: text(surface) ? sha(surface.trim()).slice(0, 16) : null,
    // Nonce makes each issued token single-use-checkable without storing the token.
    n: encodeNonce(crypto.randomBytes(NONCE_BYTES)),
    iat: now.getTime(),
    exp: now.getTime() + TOKEN_TTL_MS,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return { token: `${body}.${sig}`, payload };
}

/** Constant-time compare that cannot throw on a length mismatch. */
function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Verify a token against the action being claimed.
 *
 * Returns { valid, reason, payload }. Every refusal names its reason, because
 * "invalid token" tells an operator nothing about whether they have a bug or an
 * attacker.
 */
export function verifyInteractionToken({ secret, token, tenant, merchantId, actionKind, now = new Date() }) {
  if (!text(secret)) return { valid: false, reason: 'NO_SERVER_SECRET' };
  if (!text(token)) return { valid: false, reason: 'TOKEN_MISSING' };
  const parts = String(token).split('.');
  if (parts.length !== 2) return { valid: false, reason: 'TOKEN_MALFORMED' };
  const [body, sig] = parts;

  // Signature FIRST. Parsing attacker-controlled bytes before authenticating them
  // is how a parser becomes the attack surface.
  const expect = createHmac('sha256', secret).update(body).digest('base64url');
  if (!safeEqual(sig, expect)) return { valid: false, reason: 'SIGNATURE_INVALID' };

  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return { valid: false, reason: 'TOKEN_UNPARSEABLE' };
  }
  if (!payload || typeof payload !== 'object' || payload.v !== 1) {
    return { valid: false, reason: 'TOKEN_VERSION_UNSUPPORTED' };
  }
  const t = now.getTime();
  if (!Number.isFinite(payload.exp) || t > payload.exp) return { valid: false, reason: 'TOKEN_EXPIRED' };
  // A token issued in the future is a clock problem or a forgery attempt; either
  // way it cannot be treated as evidence of something that already happened.
  if (!Number.isFinite(payload.iat) || payload.iat > t + 60_000) {
    return { valid: false, reason: 'TOKEN_NOT_YET_VALID' };
  }
  if (payload.t !== String(tenant ?? '').trim()) return { valid: false, reason: 'WRONG_TENANT' };
  if (payload.m !== String(merchantId ?? '').trim()) return { valid: false, reason: 'WRONG_MERCHANT' };
  if (payload.a !== String(actionKind ?? '').trim()) return { valid: false, reason: 'WRONG_ACTION' };
  return { valid: true, reason: null, payload };
}

/**
 * Grade the evidence for one claimed action.
 *
 * @param {object} a
 * @param {object|null} a.tokenResult  result of verifyInteractionToken, or null
 * @param {string|null} a.destination  the merchant destination handed off to
 * @param {boolean} a.nonceAlreadySeen a previously-recorded nonce (replay)
 */
export function gradeInteraction({ tokenResult = null, destination = null, nonceAlreadySeen = false }) {
  const notes = [];

  if (!tokenResult || tokenResult.valid !== true) {
    notes.push(tokenResult?.reason
      ? `no verified interaction: ${tokenResult.reason}`
      : 'no interaction token was presented');
    return {
      state: 'REQUEST_RECEIVED',
      value_eligible: false,
      proves: 'an HTTP request arrived claiming this action',
      does_not_prove: 'that any consumer interacted with a rendered surface',
      notes,
    };
  }

  // A replayed nonce is NOT a second interaction. Grading it as one would let a
  // captured token be worth unlimited attributed actions.
  if (nonceAlreadySeen) {
    notes.push('this interaction token has already been used — a replay is not a second interaction');
    return {
      state: 'REQUEST_RECEIVED',
      value_eligible: false,
      proves: 'an HTTP request arrived carrying an already-used interaction token',
      does_not_prove: 'that a second consumer interaction occurred',
      notes,
    };
  }

  if (text(destination)) {
    return {
      state: 'MERCHANT_HANDOFF_VERIFIED',
      value_eligible: true,
      proves: 'a consumer interacted with a surface this server rendered for this merchant, and was handed off to a named destination',
      does_not_prove: 'that the handoff produced a sale, booking, or any commercial outcome',
      outcome_state: 'COMMERCIAL_OUTCOME_UNVERIFIED',
      destination: destination.trim(),
      notes,
    };
  }

  return {
    state: 'INTERACTION_VERIFIED',
    value_eligible: true,
    proves: 'a consumer interacted with a surface this server rendered for this merchant',
    does_not_prove: 'that the interaction reached the merchant, nor that it produced any commercial outcome',
    outcome_state: 'COMMERCIAL_OUTCOME_UNVERIFIED',
    notes,
  };
}

/**
 * THE LAW, enforced rather than documented: may this grade contribute to a
 * merchant-facing value figure?
 *
 * VALUE_PROVEN is deliberately unreachable from this module. Nothing here can
 * establish a commercial outcome, so nothing here may award the state that claims
 * one. If a future path does earn it, it will have to say why in its own code.
 */
export function contributesToValue(state) {
  if (state === 'VALUE_PROVEN') return false;
  return VALUE_ELIGIBLE.has(state);
}

/**
 * Privacy and retention boundary, stated as data rather than prose so it can be
 * asserted in tests.
 */
export const PRIVACY_CONTRACT = Object.freeze({
  identifiers_collected: [],
  user_identifier_in_token: false,
  ip_address_stored: false,
  user_agent_stored: false,
  surface_recorded_as: 'a truncated one-way hash of the surface path — which page, never which person',
  token_ttl_minutes: TOKEN_TTL_MS / 60_000,
  retention: 'the token is not stored; only its nonce is retained, for replay refusal, for the token lifetime',
  why: 'attribution needs to prove an interaction happened, not who performed it. Collecting an identity we do not need would be a liability we cannot justify to a consumer.',
});
