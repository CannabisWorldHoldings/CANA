import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, createHash } from 'node:crypto';
import {
  mintPageChallenge, verifyPageChallenge, gradeHandoff, pageStateContributesToValue,
  PAGE_PROOF_STATES, PAGE_VALUE_ELIGIBLE, CHALLENGE_TTL_MS,
  EVIDENCE_CONTRACT_VERSION, PAGE_PRIVACY_CONTRACT,
} from '../src/lib/page-challenge.mjs';

/**
 * PAGE-BOUND CHALLENGE — attacks on render-to-submission evidence.
 *
 * These attack in BOTH directions. Promoting weak evidence to a value-eligible
 * grade fabricates merchant value. Demoting legitimate evidence silently loses a
 * real merchant's action. Both are failures; the suite tries to cause each.
 */

const SECRET = 'test-secret-not-a-real-key';
const OLD_SECRET = 'previous-rotation-key-also-not-real';
const TENANT = 'orderweeddc.localhost';
const MERCHANT = 'r1';
const PAGE = '/retailer/r1';
const ACTION = 'HANDOFF';
const DEST = 'https://merchant.example/menu';
const now = new Date('2026-07-26T12:00:00Z');
const sha = (s) => createHash('sha256').update(s).digest('hex');

const mint = (o = {}) => mintPageChallenge({
  secret: SECRET, tenant: TENANT, merchantId: MERCHANT, pagePath: PAGE,
  actionKind: ACTION, destination: DEST, now, ...o,
});
const verify = (challenge, o = {}) => verifyPageChallenge({
  secret: SECRET, challenge, tenant: TENANT, merchantId: MERCHANT, pagePath: PAGE,
  actionKind: ACTION, destination: DEST, now, ...o,
});

// --------------------------------------------------------------- grade honesty
test('the states are ordered weakest to strongest and name what they mean', () => {
  assert.deepEqual(PAGE_PROOF_STATES, [
    'REQUEST_RECEIVED', 'APPLICATION_HANDOFF_VERIFIED', 'PAGE_INTERACTION_VERIFIED',
    'MERCHANT_HANDOFF_VERIFIED', 'COMMERCIAL_OUTCOME_UNVERIFIED', 'VALUE_PROVEN',
  ]);
});

test('THE CORE HONESTY FIX: same-origin + verified destination is only APPLICATION_HANDOFF_VERIFIED', () => {
  // The old handoff issued and consumed its own token inside one server request,
  // then graded MERCHANT_HANDOFF_VERIFIED. That proved the server ran its own
  // route — not that a page reached anyone. Without a page challenge, that is the
  // strongest honest grade, and it earns NO merchant value.
  const g = gradeHandoff({ sameOriginForm: true, destinationVerified: true, challengeResult: null });
  assert.equal(g.state, 'APPLICATION_HANDOFF_VERIFIED');
  assert.equal(g.value_eligible, false, 'the application vouching for itself is not merchant value');
  assert.match(g.does_not_prove, /rendered to anyone/i);
  assert.equal(pageStateContributesToValue('APPLICATION_HANDOFF_VERIFIED'), false);
});

test('a bare request without same-origin or destination is only REQUEST_RECEIVED', () => {
  const g = gradeHandoff({ sameOriginForm: false, destinationVerified: false, challengeResult: null });
  assert.equal(g.state, 'REQUEST_RECEIVED');
  assert.equal(g.value_eligible, false);
});

test('a valid challenge earns PAGE_INTERACTION_VERIFIED', () => {
  const g = gradeHandoff({
    sameOriginForm: true, destinationVerified: false, challengeResult: verify(mint().challenge),
  });
  assert.equal(g.state, 'PAGE_INTERACTION_VERIFIED');
  assert.equal(g.value_eligible, true);
  assert.match(g.proves, /followed a real render/i);
});

test('a valid challenge PLUS a verified destination earns MERCHANT_HANDOFF_VERIFIED', () => {
  const g = gradeHandoff({
    sameOriginForm: true, destinationVerified: true, challengeResult: verify(mint().challenge),
  });
  assert.equal(g.state, 'MERCHANT_HANDOFF_VERIFIED');
  assert.equal(g.value_eligible, true);
  assert.equal(g.outcome_state, 'COMMERCIAL_OUTCOME_UNVERIFIED');
});

test('NO state ever claims personhood, intent, or a commercial outcome', () => {
  const strongest = gradeHandoff({
    sameOriginForm: true, destinationVerified: true, challengeResult: verify(mint().challenge),
  });
  assert.match(strongest.does_not_prove, /human/i);
  assert.match(strongest.does_not_prove, /scripted browser/i);
  assert.notEqual(strongest.state, 'VALUE_PROVEN');
  assert.equal(pageStateContributesToValue('VALUE_PROVEN'), false, 'VALUE_PROVEN is unreachable here');
  assert.equal(pageStateContributesToValue('COMMERCIAL_OUTCOME_UNVERIFIED'), false);
});

// ------------------------------------------------------------- token integrity
test('THEFT/FORGERY: a challenge signed with the wrong key is refused', () => {
  const { challenge } = mint();
  const [body] = challenge.split('.');
  const forged = `${body}.${createHmac('sha256', 'attacker-key').update(`${EVIDENCE_CONTRACT_VERSION}.${body}`).digest('base64url')}`;
  const r = verify(forged);
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'SIGNATURE_INVALID');
  assert.equal(gradeHandoff({ sameOriginForm: true, destinationVerified: true, challengeResult: r }).value_eligible, false);
});

test('a TAMPERED payload is refused before it is parsed', () => {
  const { challenge } = mint();
  const [, sig] = challenge.split('.');
  const evil = Buffer.from(JSON.stringify({ cv: EVIDENCE_CONTRACT_VERSION, t: TENANT, m: 'OTHER', exp: 9e15 })).toString('base64url');
  const r = verify(`${evil}.${sig}`);
  assert.equal(r.reason, 'SIGNATURE_INVALID', 'the signature must fail before the payload is trusted');
});

test('SIGNATURE CONFUSION: the contract version is inside the signed material', () => {
  // A v1 challenge must not be reinterpretable under different v2 semantics.
  const { challenge } = mint();
  const [body] = challenge.split('.');
  const otherVersionSig = createHmac('sha256', SECRET).update(`cana-page-challenge/2.${body}`).digest('base64url');
  assert.equal(verify(`${body}.${otherVersionSig}`).reason, 'SIGNATURE_INVALID');
  // And a payload declaring another version is refused even if correctly signed.
  const p2 = Buffer.from(JSON.stringify({ ...mint().payload, cv: 'cana-page-challenge/2' })).toString('base64url');
  const s2 = createHmac('sha256', SECRET).update(`${EVIDENCE_CONTRACT_VERSION}.${p2}`).digest('base64url');
  assert.equal(verify(`${p2}.${s2}`).reason, 'CONTRACT_VERSION_MISMATCH');
});

test('KEY ROTATION: an old key is accepted only while it is still listed', () => {
  const old = mintPageChallenge({
    secret: OLD_SECRET, tenant: TENANT, merchantId: MERCHANT, pagePath: PAGE,
    actionKind: ACTION, destination: DEST, now,
  });
  // During rotation the previous key is still honoured.
  assert.equal(verify(old.challenge, { secrets: [OLD_SECRET] }).valid, true);
  // Once retired, challenges signed with it stop verifying.
  assert.equal(verify(old.challenge).valid, false);
  // And the new key still works throughout.
  assert.equal(verify(mint().challenge, { secrets: [OLD_SECRET] }).valid, true);
});

test('malformed and missing challenges are refused by NAMED reason', () => {
  for (const [c, reason] of [[undefined, 'CHALLENGE_MISSING'], ['', 'CHALLENGE_MISSING'],
                             ['   ', 'CHALLENGE_MISSING'], ['nodot', 'CHALLENGE_MALFORMED'],
                             ['a.b.c', 'CHALLENGE_MALFORMED']]) {
    assert.equal(verify(c).reason, reason, `${JSON.stringify(c)} should be ${reason}`);
  }
});

test('verification with NO secret fails closed', () => {
  const r = verifyPageChallenge({
    secret: '', secrets: [], challenge: mint().challenge, tenant: TENANT,
    merchantId: MERCHANT, pagePath: PAGE, actionKind: ACTION, destination: DEST, now,
  });
  assert.equal(r.reason, 'NO_SERVER_SECRET');
});

// ------------------------------------------------------------------ substitution
test('DESTINATION SUBSTITUTION is refused', () => {
  // The challenge authorises exactly one destination. A handoff that ends
  // somewhere else is not the handoff that was authorised.
  const r = verify(mint().challenge, { destination: 'https://attacker.example/steal' });
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'DESTINATION_SUBSTITUTED');
});

test('MERCHANT, TENANT, ACTION and PAGE substitution are each refused by name', () => {
  assert.equal(verify(mint().challenge, { merchantId: 'other' }).reason, 'WRONG_MERCHANT');
  assert.equal(verify(mint().challenge, { tenant: 'evil.localhost' }).reason, 'WRONG_TENANT');
  assert.equal(verify(mint().challenge, { actionKind: 'PHONE_CLICK' }).reason, 'WRONG_ACTION');
  assert.equal(verify(mint().challenge, { pagePath: '/retailer/someone-else' }).reason, 'WRONG_PAGE');
});

test('a challenge minted for one page cannot authorise another page', () => {
  const other = mint({ pagePath: '/retailer/different' });
  assert.equal(verify(other.challenge).reason, 'WRONG_PAGE');
});

// ------------------------------------------------------------------- freshness
test('an EXPIRED challenge is refused, and the boundary is exact', () => {
  const { challenge } = mint();
  assert.equal(verify(challenge, { now: new Date(now.getTime() + CHALLENGE_TTL_MS) }).valid, true);
  const r = verify(challenge, { now: new Date(now.getTime() + CHALLENGE_TTL_MS + 1) });
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'CHALLENGE_EXPIRED');
});

test('a FUTURE-DATED challenge beyond clock skew is refused', () => {
  const future = mint({ now: new Date(now.getTime() + 10 * 60_000) });
  assert.equal(verify(future.challenge).reason, 'CHALLENGE_NOT_YET_VALID');
  // A small skew is tolerated — a clock a few seconds ahead is not an attack.
  const slight = mint({ now: new Date(now.getTime() + 30_000) });
  assert.equal(verify(slight.challenge).valid, true);
});

// ---------------------------------------------------------------------- replay
test('REPLAY after redemption falls back to the application grade, not silence', () => {
  // Back-button, duplicate tab and double-submit all land here. The consumer
  // performed ONE handoff; the second submission must not be a second action, but
  // it also must not be reported as if nothing verifiable happened.
  const r = verify(mint().challenge);
  const first = gradeHandoff({ sameOriginForm: true, destinationVerified: true, challengeResult: r });
  const replay = gradeHandoff({ sameOriginForm: true, destinationVerified: true, challengeResult: r, alreadyRedeemed: true });
  assert.equal(first.value_eligible, true);
  assert.equal(replay.state, 'APPLICATION_HANDOFF_VERIFIED');
  assert.equal(replay.value_eligible, false, 'a replay must never earn merchant value');
  assert.match(replay.notes.join(' '), /already redeemed/i);
});

test('PARALLEL REDEMPTION: only the first of N concurrent redemptions is value-eligible', () => {
  // The module cannot serialise on its own — the caller must redeem the nonce
  // transactionally. What it MUST do is grade every loser as non-eligible.
  const r = verify(mint().challenge);
  const outcomes = [false, true, true, true, true].map((seen) =>
    gradeHandoff({ sameOriginForm: true, destinationVerified: true, challengeResult: r, alreadyRedeemed: seen }));
  assert.equal(outcomes.filter((o) => o.value_eligible).length, 1);
});

test('each mint produces a distinct nonce and page-session', () => {
  const nonces = new Set(), sessions = new Set();
  for (let i = 0; i < 50; i++) { const { payload } = mint(); nonces.add(payload.n); sessions.add(payload.ps); }
  assert.equal(nonces.size, 50, 'nonce collisions would make replay refusal meaningless');
  assert.equal(sessions.size, 50, 'a per-render session must not repeat across renders');
});

// ------------------------------------------------- direct POST / copied HTML / bots
test('a DIRECT POST with no page render cannot be value-eligible', () => {
  const g = gradeHandoff({ sameOriginForm: true, destinationVerified: true, challengeResult: null });
  assert.equal(g.value_eligible, false);
  assert.match(g.notes.join(' '), /no page challenge/i);
});

test('COPIED HTML is honestly reported as what it is', () => {
  // A challenge lifted from page source and replayed elsewhere still proves a real
  // render happened — that IS what the mechanism claims. It never claimed the
  // submitter is the person who saw the page, and the docs must say so.
  const g = gradeHandoff({ sameOriginForm: true, destinationVerified: true, challengeResult: verify(mint().challenge) });
  assert.match(g.does_not_prove, /human/i);
  assert.ok(!/proves a human|verified human|real person/i.test(g.proves),
    'the proves-string must never imply personhood');
});

test('a BOT that renders and submits reaches the same grade — and that is disclosed', () => {
  // Deliberate: the mechanism is about causal linkage, not personhood. Pretending
  // otherwise would be the exact overclaim this module exists to prevent.
  const g = gradeHandoff({ sameOriginForm: true, destinationVerified: true, challengeResult: verify(mint().challenge) });
  assert.equal(g.state, 'MERCHANT_HANDOFF_VERIFIED');
  assert.match(g.does_not_prove, /scripted browser can render/i);
});

// ------------------------------------------------------------ minting guards
test('an UNBOUND challenge cannot be minted', () => {
  // A challenge missing any binding would authorise more than it should.
  for (const missing of [{ tenant: '' }, { merchantId: '' }, { pagePath: '' },
                         { actionKind: '' }, { destination: '' }]) {
    assert.throws(() => mint(missing), `minting must refuse when ${JSON.stringify(missing)}`);
  }
  assert.throws(() => mintPageChallenge({ secret: '', tenant: TENANT, merchantId: MERCHANT,
    pagePath: PAGE, actionKind: ACTION, destination: DEST }));
});

// ------------------------------------------------------ privacy and retention
test('the challenge carries NO durable user identity', () => {
  const { payload } = mint();
  const identifierKeys = Object.keys(payload).filter((k) =>
    /^(ip|ua|user_?agent|email|phone|uid|user_?id|session_?id|device_?id|fingerprint|cookie)$/i.test(k));
  assert.deepEqual(identifierKeys, []);
  assert.deepEqual(Object.keys(payload).sort(), ['a', 'cv', 'd', 'exp', 'iat', 'm', 'n', 'p', 'ps', 't']);
  assert.equal(PAGE_PRIVACY_CONTRACT.ip_address_used, false);
  assert.equal(PAGE_PRIVACY_CONTRACT.user_agent_used, false);
  assert.equal(PAGE_PRIVACY_CONTRACT.durable_user_identifier, false);
  assert.equal(PAGE_PRIVACY_CONTRACT.fingerprinting, 'none');
});

test('the raw page path and raw destination never appear in the challenge', () => {
  const { payload } = mint({ pagePath: '/retailer/very-identifying-slug', destination: 'https://secret.example/private-path' });
  const raw = JSON.stringify(payload);
  assert.ok(!/very-identifying-slug/.test(raw), 'the raw page path must not be embedded');
  assert.ok(!/private-path/.test(raw), 'the raw destination must not be embedded');
  assert.match(payload.p, /^[0-9a-f]{16}$/);
  assert.match(payload.d, /^[0-9a-f]{32}$/);
});

test('the server secret never appears in a minted challenge', () => {
  const { challenge, payload } = mint();
  assert.ok(!challenge.includes(SECRET));
  assert.ok(!JSON.stringify(payload).includes(SECRET));
  assert.ok(!Buffer.from(challenge.split('.')[0], 'base64url').toString('utf8').includes(SECRET));
});

test('retention is bounded and stated', () => {
  assert.equal(PAGE_PRIVACY_CONTRACT.challenge_ttl_minutes, 15);
  assert.match(PAGE_PRIVACY_CONTRACT.retention, /not stored/i);
  assert.match(PAGE_PRIVACY_CONTRACT.retention, /nonce/i);
});
