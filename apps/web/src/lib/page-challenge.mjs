import { createHmac, randomBytes, timingSafeEqual, createHash } from 'node:crypto';

/**
 * PAGE-BOUND INTERACTION CHALLENGE — evidence that a page was actually rendered.
 *
 * THE WEAKNESS THIS FIXES, stated before the design. The handoff route issues an
 * interaction token AND consumes it inside the same server request. The client
 * never holds it. So that token proves the SERVER ran its own handoff route — it
 * does not prove a page was ever rendered to anyone, and it certainly does not
 * prove a human acted. Grading that MERCHANT_HANDOFF_VERIFIED overstates it.
 *
 * A challenge fixes the causal direction. The server MINTS it while rendering a
 * verified retailer page and embeds it in the returned HTML. A later submission
 * that presents a valid, unexpired, unconsumed challenge therefore proves the
 * submitter possessed bytes that only that render produced. That is a real,
 * checkable causal link from render to submission.
 *
 * WHAT IT STILL DOES NOT PROVE, and this module must never imply otherwise:
 *   - Not personhood. A scripted browser renders pages and reads HTML.
 *   - Not intent. Possession of the challenge is not consent or interest.
 *   - Not a commercial outcome. Nothing here observes a sale.
 * It proves: THIS SUBMISSION FOLLOWED A REAL RENDER OF THIS PAGE, FOR THIS MERCHANT,
 * FOR THIS ACTION, TO THIS DESTINATION, WITHIN THIS WINDOW, EXACTLY ONCE.
 * That is the honest claim, and it is strictly more than the handoff had.
 *
 * PRIVACY. No IP, no user agent, no fingerprint, no durable user identifier. The
 * page identity is a truncated one-way hash of the path — which page, never which
 * person. Only the nonce is retained, solely to refuse a second redemption, and
 * only for the challenge lifetime.
 */

const text = (v) => typeof v === 'string' && v.trim() !== '';
const sha = (s) => createHash('sha256').update(s).digest('hex');

/** Contract version travels INSIDE the signature, so a v1 challenge can never be
 *  reinterpreted under v2 rules after a semantic change. */
export const EVIDENCE_CONTRACT_VERSION = 'cana-page-challenge/1';

/** Short enough that an abandoned tab stops being evidence. */
export const CHALLENGE_TTL_MS = 15 * 60_000;

/** Clock skew allowance for an issued-at in the near future. */
const SKEW_MS = 60_000;

/**
 * Graded states this module can justify. Deliberately NOT the same list as
 * interaction-proof.mjs: a page-bound challenge earns a state that names what it
 * actually establishes.
 */
export const PAGE_PROOF_STATES = Object.freeze([
  'REQUEST_RECEIVED',            // a request arrived
  'APPLICATION_HANDOFF_VERIFIED', // the app's own handoff route ran and verified a destination
  'PAGE_INTERACTION_VERIFIED',    // the submission followed a real render of this page
  'MERCHANT_HANDOFF_VERIFIED',    // ...and was handed off to the verified merchant destination
  'COMMERCIAL_OUTCOME_UNVERIFIED',
  'VALUE_PROVEN',                 // unreachable here, by construction
]);

/** Only these may contribute to a merchant-facing value figure. */
export const PAGE_VALUE_ELIGIBLE = Object.freeze(new Set([
  'PAGE_INTERACTION_VERIFIED',
  'MERCHANT_HANDOFF_VERIFIED',
]));

/**
 * Mint a challenge during page render.
 *
 * @param {object} a
 * @param {string} a.secret        server secret; never leaves the server
 * @param {string} a.tenant        host this page was served for
 * @param {string} a.merchantId    retailer the page is about
 * @param {string} a.pagePath      e.g. /retailer/abc — hashed, never stored raw
 * @param {string} a.actionKind    the action this challenge may authorise
 * @param {string} a.destination   the ONLY destination it may authorise
 * @param {string} [a.pageSession] privacy-safe per-render identity; generated if absent
 */
export function mintPageChallenge({
  secret, tenant, merchantId, pagePath, actionKind, destination,
  pageSession = null, now = new Date(),
}) {
  if (!text(secret)) throw new Error('a server secret is required to mint a challenge');
  for (const [k, v] of Object.entries({ tenant, merchantId, pagePath, actionKind, destination })) {
    if (!text(v)) throw new Error(`${k} is required — an unbound challenge authorises anything`);
  }
  const payload = {
    cv: EVIDENCE_CONTRACT_VERSION,
    t: tenant.trim(),
    m: merchantId.trim(),
    // WHICH PAGE, never which person.
    p: sha(pagePath.trim()).slice(0, 16),
    a: actionKind.trim(),
    // The destination is bound by HASH: the full URL is already known to both
    // sides, and hashing keeps the challenge small and opaque in page source.
    d: sha(destination.trim()).slice(0, 32),
    // Per-render identity. Not a user id, not a cookie, not durable across renders.
    ps: text(pageSession) ? sha(pageSession.trim()).slice(0, 16) : randomBytes(8).toString('hex'),
    // Single-use identity for transactional redemption.
    n: randomBytes(16).toString('hex'),
    iat: now.getTime(),
    exp: now.getTime() + CHALLENGE_TTL_MS,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret).update(`${EVIDENCE_CONTRACT_VERSION}.${body}`).digest('base64url');
  return { challenge: `${body}.${sig}`, payload };
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Verify a presented challenge against the submission being claimed.
 *
 * Returns { valid, reason, payload }. Every refusal names its reason: "invalid"
 * tells an operator nothing about whether they have a bug or an attacker.
 *
 * @param {string[]} [a.secrets] additional accepted secrets, for key rotation. The
 *   primary is tried first; an old key is accepted only while it remains listed.
 */
export function verifyPageChallenge({
  secret, secrets = [], challenge, tenant, merchantId, pagePath, actionKind, destination,
  now = new Date(),
}) {
  const keys = [secret, ...secrets].filter(text);
  if (keys.length === 0) return { valid: false, reason: 'NO_SERVER_SECRET' };
  if (!text(challenge)) return { valid: false, reason: 'CHALLENGE_MISSING' };
  const parts = String(challenge).split('.');
  if (parts.length !== 2) return { valid: false, reason: 'CHALLENGE_MALFORMED' };
  const [body, sig] = parts;

  // SIGNATURE FIRST. Parsing attacker-controlled bytes before authenticating them
  // makes the parser the attack surface. The contract version is inside the signed
  // material, so a v1 challenge cannot be replayed under different v2 semantics —
  // that is the "signature confusion" case.
  const signedOk = keys.some((k) =>
    safeEqual(sig, createHmac('sha256', k).update(`${EVIDENCE_CONTRACT_VERSION}.${body}`).digest('base64url')));
  if (!signedOk) return { valid: false, reason: 'SIGNATURE_INVALID' };

  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return { valid: false, reason: 'CHALLENGE_UNPARSEABLE' };
  }
  if (!payload || typeof payload !== 'object') return { valid: false, reason: 'CHALLENGE_UNPARSEABLE' };
  if (payload.cv !== EVIDENCE_CONTRACT_VERSION) return { valid: false, reason: 'CONTRACT_VERSION_MISMATCH' };

  const t = now.getTime();
  if (!Number.isFinite(payload.exp) || t > payload.exp) return { valid: false, reason: 'CHALLENGE_EXPIRED' };
  if (!Number.isFinite(payload.iat) || payload.iat > t + SKEW_MS) {
    return { valid: false, reason: 'CHALLENGE_NOT_YET_VALID' };
  }
  if (payload.t !== String(tenant ?? '').trim()) return { valid: false, reason: 'WRONG_TENANT' };
  if (payload.m !== String(merchantId ?? '').trim()) return { valid: false, reason: 'WRONG_MERCHANT' };
  if (payload.a !== String(actionKind ?? '').trim()) return { valid: false, reason: 'WRONG_ACTION' };
  if (payload.p !== sha(String(pagePath ?? '').trim()).slice(0, 16)) {
    return { valid: false, reason: 'WRONG_PAGE' };
  }
  // DESTINATION SUBSTITUTION. The challenge authorises exactly one destination. A
  // handoff that ends somewhere else is not the handoff that was authorised.
  if (payload.d !== sha(String(destination ?? '').trim()).slice(0, 32)) {
    return { valid: false, reason: 'DESTINATION_SUBSTITUTED' };
  }
  return { valid: true, reason: null, payload };
}

/**
 * Grade a handoff submission.
 *
 * @param {object} a
 * @param {boolean} a.sameOriginForm      the submission arrived as a same-origin form POST
 * @param {boolean} a.destinationVerified the server independently verified the destination
 * @param {object|null} a.challengeResult result of verifyPageChallenge, or null
 * @param {boolean} a.alreadyRedeemed     the nonce was already consumed
 */
export function gradeHandoff({
  sameOriginForm = false, destinationVerified = false,
  challengeResult = null, alreadyRedeemed = false,
}) {
  const notes = [];

  const base = () => {
    // The same-origin form check and the server-verified destination ARE real
    // evidence — of the APPLICATION's own behaviour. They prove this server's
    // handoff route ran and resolved a destination it trusts. They prove nothing
    // about a page being rendered to anyone, so they earn their own honest state
    // rather than being rounded up.
    if (sameOriginForm && destinationVerified) {
      return {
        state: 'APPLICATION_HANDOFF_VERIFIED',
        value_eligible: false,
        proves: "this server's handoff route ran for this merchant and resolved a destination it verified",
        does_not_prove: 'that any page was rendered to anyone, or that a consumer acted',
        notes,
      };
    }
    return {
      state: 'REQUEST_RECEIVED',
      value_eligible: false,
      proves: 'a request arrived claiming a handoff',
      does_not_prove: 'that the application verified a destination, that a page was rendered, or that a consumer acted',
      notes,
    };
  };

  if (!challengeResult || challengeResult.valid !== true) {
    notes.push(challengeResult?.reason
      ? `no page-bound evidence: ${challengeResult.reason}`
      : 'no page challenge was presented');
    return base();
  }

  if (alreadyRedeemed) {
    // A second redemption is a replay, not a second render. Back-button and
    // duplicate-tab submissions land here, which is correct: the consumer
    // performed one handoff.
    notes.push('this challenge was already redeemed — a replay is not a second interaction');
    const b = base();
    b.notes = notes;
    return b;
  }

  const state = destinationVerified ? 'MERCHANT_HANDOFF_VERIFIED' : 'PAGE_INTERACTION_VERIFIED';
  return {
    state,
    value_eligible: true,
    proves: destinationVerified
      ? 'this submission followed a real render of this page, for this merchant and action, and was handed off to the destination that render authorised'
      : 'this submission followed a real render of this page, for this merchant and action',
    does_not_prove: 'that a human performed it — a scripted browser can render a page and read its HTML — nor that it produced any commercial outcome',
    outcome_state: 'COMMERCIAL_OUTCOME_UNVERIFIED',
    notes,
  };
}

/** THE LAW, enforced: may this state contribute to a merchant-facing figure? */
export function pageStateContributesToValue(state) {
  if (state === 'VALUE_PROVEN') return false;
  return PAGE_VALUE_ELIGIBLE.has(state);
}

/** Privacy and retention, as data so tests can assert it. */
export const PAGE_PRIVACY_CONTRACT = Object.freeze({
  ip_address_used: false,
  user_agent_used: false,
  fingerprinting: 'none',
  durable_user_identifier: false,
  page_recorded_as: 'a truncated one-way hash of the path — which page, never which person',
  page_session: 'a per-render random value, not durable across renders and not linkable to a person',
  destination_recorded_as: 'a truncated one-way hash inside the challenge; the full URL is verified server-side',
  challenge_ttl_minutes: CHALLENGE_TTL_MS / 60_000,
  retention: 'the challenge is not stored; only its nonce is retained, to refuse a second redemption, for the challenge lifetime',
  why: 'attribution must prove an interaction followed a render, not who performed it. An identity we do not need is a liability we cannot justify to a consumer.',
});
