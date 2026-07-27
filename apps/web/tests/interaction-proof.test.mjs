import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  issueInteractionToken, verifyInteractionToken, gradeInteraction,
  contributesToValue, PROOF_STATES, VALUE_ELIGIBLE, TOKEN_TTL_MS, PRIVACY_CONTRACT,
} from '../src/lib/interaction-proof.mjs';

/**
 * CONSUMER INTERACTION PROOF — attacks on graded evidence.
 *
 * The point of this module is to stop calling an accepted HTTP request a consumer
 * action. So these tests attack in BOTH directions: they try to promote weak
 * evidence to a value-eligible grade, and they check that legitimate evidence is
 * not silently demoted (a false demotion loses a real merchant's action, which is
 * the inverse harm and matters just as much).
 */

const SECRET = 'test-secret-not-a-real-key';
const TENANT = 'orderweeddc.localhost';
const MERCHANT = 'm1';
const ACTION = 'PHONE_CLICK';
const now = new Date('2026-07-26T12:00:00Z');

const issue = (o = {}) => issueInteractionToken({
  secret: SECRET, tenant: TENANT, merchantId: MERCHANT, actionKind: ACTION,
  surface: '/retailer/m1', now, ...o,
});
const verify = (token, o = {}) => verifyInteractionToken({
  secret: SECRET, token, tenant: TENANT, merchantId: MERCHANT, actionKind: ACTION, now, ...o,
});

// ------------------------------------------------------------- grade ordering
test('the proof states are ordered weakest to strongest', () => {
  assert.deepEqual(PROOF_STATES, [
    'REQUEST_RECEIVED', 'INTERACTION_VERIFIED', 'MERCHANT_HANDOFF_VERIFIED',
    'COMMERCIAL_OUTCOME_UNVERIFIED', 'VALUE_PROVEN',
  ]);
});

test('THE LAW: REQUEST_RECEIVED alone carries no merchant value', () => {
  assert.equal(contributesToValue('REQUEST_RECEIVED'), false);
  const g = gradeInteraction({ tokenResult: null });
  assert.equal(g.state, 'REQUEST_RECEIVED');
  assert.equal(g.value_eligible, false);
  assert.match(g.does_not_prove, /any consumer interacted/i);
});

test('VALUE_PROVEN is unreachable from this module', () => {
  // Nothing here can establish a commercial outcome, so nothing here may award the
  // state that claims one.
  assert.equal(contributesToValue('VALUE_PROVEN'), false);
  const strongest = gradeInteraction({
    tokenResult: verify(issue().token), destination: 'tel:+12025550100',
  });
  assert.notEqual(strongest.state, 'VALUE_PROVEN');
  assert.equal(strongest.outcome_state, 'COMMERCIAL_OUTCOME_UNVERIFIED');
});

test('COMMERCIAL_OUTCOME_UNVERIFIED is never value-eligible', () => {
  assert.equal(contributesToValue('COMMERCIAL_OUTCOME_UNVERIFIED'), false);
  assert.ok(!VALUE_ELIGIBLE.has('COMMERCIAL_OUTCOME_UNVERIFIED'));
});

// ----------------------------------------------------------------- happy path
test('a genuine token grades INTERACTION_VERIFIED', () => {
  const g = gradeInteraction({ tokenResult: verify(issue().token) });
  assert.equal(g.state, 'INTERACTION_VERIFIED');
  assert.equal(g.value_eligible, true);
  assert.match(g.does_not_prove, /commercial outcome/i);
});

test('a token plus a destination grades MERCHANT_HANDOFF_VERIFIED', () => {
  const g = gradeInteraction({ tokenResult: verify(issue().token), destination: 'https://merchant.example/menu' });
  assert.equal(g.state, 'MERCHANT_HANDOFF_VERIFIED');
  assert.equal(g.value_eligible, true);
  assert.equal(g.destination, 'https://merchant.example/menu');
});

test('a MISSING destination does not fabricate a handoff', () => {
  for (const d of [null, undefined, '', '   ']) {
    const g = gradeInteraction({ tokenResult: verify(issue().token), destination: d });
    assert.equal(g.state, 'INTERACTION_VERIFIED', `destination ${JSON.stringify(d)} must not claim a handoff`);
  }
});

// --------------------------------------------------------------- token attacks
test('a FORGED token is refused', () => {
  const { token } = issue();
  const [body] = token.split('.');
  const forged = `${body}.${createHmac('sha256', 'wrong-secret').update(body).digest('base64url')}`;
  const r = verify(forged);
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'SIGNATURE_INVALID');
  assert.equal(gradeInteraction({ tokenResult: r }).value_eligible, false);
});

test('a TAMPERED payload is refused — signature is checked before parsing', () => {
  const { token } = issue();
  const [, sig] = token.split('.');
  const evil = Buffer.from(JSON.stringify({ v: 1, t: TENANT, m: 'OTHER', a: ACTION, exp: 9e15 })).toString('base64url');
  const r = verify(`${evil}.${sig}`);
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'SIGNATURE_INVALID', 'the signature must fail before the payload is trusted');
});

test('an EXPIRED token is refused', () => {
  const { token } = issue();
  const later = new Date(now.getTime() + TOKEN_TTL_MS + 1000);
  const r = verify(token, { now: later });
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'TOKEN_EXPIRED');
});

test('a token valid at the boundary is still accepted, one ms later is not', () => {
  const { token } = issue();
  assert.equal(verify(token, { now: new Date(now.getTime() + TOKEN_TTL_MS) }).valid, true);
  assert.equal(verify(token, { now: new Date(now.getTime() + TOKEN_TTL_MS + 1) }).valid, false);
});

test('a FUTURE-dated token is refused', () => {
  const { token } = issue({ now: new Date(now.getTime() + 10 * 60_000) });
  const r = verify(token);
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'TOKEN_NOT_YET_VALID');
});

test('WRONG TENANT is refused', () => {
  const r = verify(issue().token, { tenant: 'evil.localhost' });
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'WRONG_TENANT');
});

test('WRONG MERCHANT is refused — a token for one merchant cannot credit another', () => {
  const r = verify(issue().token, { merchantId: 'm2' });
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'WRONG_MERCHANT');
});

test('WRONG ACTION is refused — a PROFILE_VIEW token cannot claim a PHONE_CLICK', () => {
  const r = verify(issue({ actionKind: 'PROFILE_VIEW' }).token);
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'WRONG_ACTION');
});

test('malformed and missing tokens are refused by NAMED reason', () => {
  const cases = [
    [undefined, 'TOKEN_MISSING'], ['', 'TOKEN_MISSING'], ['   ', 'TOKEN_MISSING'],
    ['no-dot', 'TOKEN_MALFORMED'], ['a.b.c', 'TOKEN_MALFORMED'],
  ];
  for (const [tok, reason] of cases) {
    const r = verify(tok);
    assert.equal(r.valid, false);
    assert.equal(r.reason, reason, `${JSON.stringify(tok)} should be ${reason}`);
  }
  // "invalid token" would tell an operator nothing about bug vs attacker.
  assert.ok(verify('no-dot').reason !== 'INVALID');
});

test('a signature of the right SHAPE but wrong bytes is refused without throwing', () => {
  const { token } = issue();
  const [body, sig] = token.split('.');
  const flipped = sig.slice(0, -1) + (sig.endsWith('A') ? 'B' : 'A');
  const r = verify(`${body}.${flipped}`);
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'SIGNATURE_INVALID');
});

// ----------------------------------------------------------------- replay
test('a REPLAYED token is not a second interaction', () => {
  // A captured token would otherwise be worth unlimited attributed actions.
  const r = verify(issue().token);
  const first = gradeInteraction({ tokenResult: r, nonceAlreadySeen: false });
  const replay = gradeInteraction({ tokenResult: r, nonceAlreadySeen: true });
  assert.equal(first.value_eligible, true);
  assert.equal(replay.state, 'REQUEST_RECEIVED');
  assert.equal(replay.value_eligible, false);
  assert.match(replay.notes.join(' '), /already been used/i);
});

test('each issued token carries a distinct nonce', () => {
  const seen = new Set();
  for (let i = 0; i < 50; i++) seen.add(issue().payload.n);
  assert.equal(seen.size, 50, 'nonces must not repeat, or replay detection is meaningless');
});

// ------------------------------------------------- direct API / bot behaviour
test('a DIRECT API call with no rendered interaction cannot be value-eligible', () => {
  // This is the exact gap the verifier found: an unauthenticated POST looked
  // identical to a real consumer.
  const g = gradeInteraction({ tokenResult: null, destination: 'https://merchant.example' });
  assert.equal(g.state, 'REQUEST_RECEIVED');
  assert.equal(g.value_eligible, false,
    'supplying a destination must not upgrade a request that carries no interaction');
});

test('the module states plainly what a token does NOT prove about bots', () => {
  const src = PRIVACY_CONTRACT.why + ' ' + gradeInteraction({ tokenResult: verify(issue().token) }).does_not_prove;
  assert.match(src, /commercial outcome/i);
  // And a verified interaction never claims to identify a person.
  assert.equal(PRIVACY_CONTRACT.user_identifier_in_token, false);
});

// ----------------------------------------------------- privacy and retention
test('the token binds NO user identifier', () => {
  const { payload } = issue();
  // Check the KEYS and the identifying-looking VALUES, not raw substrings: my first
  // version matched "PHONE" inside the action kind PHONE_CLICK and failed on a
  // token that leaked nothing. A privacy test that fires on a legitimate enum would
  // be noise, and noise is how a real privacy guard ends up disabled.
  const identifierKeys = Object.keys(payload).filter((k) =>
    /^(ip|ua|user_?agent|email|phone|uid|user_?id|session_?id|device_?id|fingerprint)$/i.test(k));
  assert.deepEqual(identifierKeys, [], `token payload carries identifier keys: ${identifierKeys.join(',')}`);
  // No value may look like an address, an email, or a raw phone number.
  // Cryptographic nonce and surface-digest fields are constrained separately:
  // an opaque hexadecimal value can contain a long digit run by chance.
  const opaqueHexFields = new Set(['n', 's']);
  for (const [k, v] of Object.entries(payload)) {
    if (typeof v !== 'string') continue;
    assert.ok(!/\b\d{1,3}(\.\d{1,3}){3}\b/.test(v), `${k} looks like an IP: ${v}`);
    assert.ok(!/@/.test(v), `${k} looks like an email: ${v}`);
    assert.ok(
      opaqueHexFields.has(k) || !/\+?\d[\d\s().-]{8,}/.test(v),
      `${k} looks like a phone number: ${v}`,
    );
    assert.ok(!/Mozilla|Chrome|Safari|AppleWebKit/i.test(v), `${k} looks like a user agent: ${v}`);
  }
  // Only the expected fields exist at all.
  assert.deepEqual(Object.keys(payload).sort(), ['a', 'exp', 'iat', 'm', 'n', 's', 't', 'v']);
  assert.match(payload.n, /^[0-9a-f]{24}$/);
  assert.match(payload.s, /^[0-9a-f]{16}$/);
  assert.equal(PRIVACY_CONTRACT.ip_address_stored, false);
  assert.equal(PRIVACY_CONTRACT.user_agent_stored, false);
  assert.deepEqual(PRIVACY_CONTRACT.identifiers_collected, []);
});

test('the surface is recorded as a truncated hash, not a path', () => {
  const { payload } = issue({ surface: '/retailer/very-identifying-slug' });
  assert.ok(!/very-identifying-slug/.test(JSON.stringify(payload)), 'the raw surface must not be stored');
  assert.match(payload.s, /^[0-9a-f]{16}$/);
  // Two different surfaces must still be distinguishable.
  assert.notEqual(issue({ surface: '/a' }).payload.s, issue({ surface: '/b' }).payload.s);
});

test('retention is bounded and stated', () => {
  assert.equal(PRIVACY_CONTRACT.token_ttl_minutes, 10);
  assert.match(PRIVACY_CONTRACT.retention, /not stored/i);
  assert.match(PRIVACY_CONTRACT.retention, /nonce/i);
});

// ------------------------------------------------------------ issuing guards
test('a token cannot be issued without a secret or a binding', () => {
  assert.throws(() => issueInteractionToken({ secret: '', tenant: TENANT, merchantId: MERCHANT, actionKind: ACTION }));
  for (const missing of [{ tenant: '' }, { merchantId: '' }, { actionKind: '' }]) {
    assert.throws(() => issue(missing), `issuing must refuse when ${JSON.stringify(missing)}`);
  }
});

test('verification with NO server secret fails closed', () => {
  const r = verifyInteractionToken({ secret: '', token: issue().token, tenant: TENANT, merchantId: MERCHANT, actionKind: ACTION, now });
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'NO_SERVER_SECRET', 'a missing secret must never verify as valid');
});
