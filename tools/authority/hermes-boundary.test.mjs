// tools/authority/hermes-boundary.test.mjs — the qC Hermes boundary suite, RE-RUN against the
// merged (Phase-D) law, asserting the FIVE previously-VIOLATED properties are now UPHELD.
//
// qC (out/HERMES_BOUNDARY.md, /agent/workspace/qC/hermes-boundary.test.mjs) found 5 CRITICAL/HIGH/
// MEDIUM/LOW violations against the ORIGINAL law:
//   V1  forgeable policy authority (any non-empty issuedBy accepted)
//   V2b self-authored mission provenance seals identically to a CANA one
//   V5  self-minted success receipt (no verifier identity / self-verification)
//   V6  no tenant boundary (a tenant-crossing intent seals)
//   V8  replayable grant (grant_id a pure function of public inputs)
//
// Phase D binds makeGrant to a CANA Authority authorization. This court proves each of the five is
// now UPHELD by the REAL merged code (no weakening). It also keeps the qC UPHELD properties green.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  CAPABILITIES, OWNER_ONLY, makeGrant, sealPacket, makeReceipt,
} from '../../skills-src/hermes-governed-packet.mjs';
import { authorize } from './authority.mjs';
import { makeEnv, buildM2, NOW, TENANT, EXECUTOR } from './court-fixtures.mjs';

const CAP = 'WRITE_LOCAL_BRANCH';
const RESOURCE = 'docs/status.md';
const BOUND = { action_type: CAP, resource: RESOURCE, tenant: TENANT };

// Mint a REAL authorization for a given tenant/capability/action via the seat.
function realAuthorization(env, { tenant = TENANT, capability = CAP, resource = RESOURCE, missionId } = {}) {
  const mid = missionId ?? `m_${Math.random().toString(36).slice(2, 8)}`;
  const { pkt, m } = buildM2({ missionId: mid, tenant });
  const r = authorize({
    now: NOW.toISOString(), tenant, executorIdentity: EXECUTOR,
    action: { action_type: capability, resource }, capability, budgetUnits: 5,
    mission: m, contextPacket: pkt,
    containment: { authorization_id: env.authId, worker_capability_id: env.capId, worker_id: 'worker_1', actor_id: 'actor_owner', site_id: 'site_1', mission_id: mid, budget: { calls: 1 } },
    signer: env.signer, verifier: env.verifier, ownerRootDir: env.ownerRoot,
  }, { stateDir: env.stateDir });
  return r;
}

// ── V1 (was CRITICAL VIOLATION) → now UPHELD: forgeable policy authority is closed. ──
test('[UPHELD] V1 policy authority: a forged issuedBy can no longer produce a valid grant', () => {
  const env = makeEnv();
  try {
    // The old attack: makeGrant({ ..., issuedBy: 'the executor pretending to be CANA' }).valid === true
    const forged = makeGrant({ capability: 'RUN_TESTS', budgetUnits: 5, issuedBy: 'the executor pretending to be CANA', verifier: env.verifier, boundAction: { action_type: 'RUN_TESTS', tenant: TENANT }, now: NOW });
    assert.equal(forged.valid, false); // was true in qC — now refused
    // Only a real authorization from the seat yields a valid grant.
    const r = realAuthorization(env, { missionId: 'v1' });
    const good = makeGrant({ capability: CAP, budgetUnits: 5, authorization: r.authorization, verifier: env.verifier, boundAction: BOUND, now: NOW });
    assert.equal(good.valid, true, JSON.stringify(good.errors));
    // The attribution is bound to the authorization id — not a caller string.
    assert.ok(good.issued_by.startsWith('CANA-AUTHORITY:'));
    assert.equal(good.issued_by.includes('pretending'), false);
  } finally { env.cleanup(); }
});

// ── V2b (was VIOLATION/gap) → now UPHELD: mission provenance is bound. ──
test('[UPHELD] V2b mission provenance: a self-authored objective cannot yield a valid grant', () => {
  const env = makeEnv();
  try {
    // A grant now requires an authorization whose action digest binds action_type+resource+tenant.
    // A self-authored objective (no seat authorization) cannot produce a grant at all.
    const noAuth = makeGrant({ capability: CAP, budgetUnits: 5, authorization: null, verifier: env.verifier, boundAction: BOUND, now: NOW });
    assert.equal(noAuth.valid, false);
    // And an authorization minted for one action cannot be replayed to bless a DIFFERENT (self-authored)
    // action: the digest won't match.
    const r = realAuthorization(env, { missionId: 'v2b', resource: RESOURCE });
    const wrongAction = makeGrant({ capability: CAP, budgetUnits: 5, authorization: r.authorization, verifier: env.verifier, boundAction: { action_type: CAP, resource: 'docs/SELF_AUTHORED.md', tenant: TENANT }, now: NOW });
    assert.equal(wrongAction.valid, false); // provenance bound to the exact action
  } finally { env.cleanup(); }
});

// ── V5 (was HIGH VIOLATION) → now UPHELD: the packet producer cannot self-verify authority. ──
test('[UPHELD] V5 self-verification: authority verification requires an EXTERNAL owner key', () => {
  const env = makeEnv();
  try {
    const r = realAuthorization(env, { missionId: 'v5' });
    // A producer WITHOUT the owner verifier cannot admit the authorization (makeGrant needs a verifier).
    const noVerifier = makeGrant({ capability: CAP, budgetUnits: 5, authorization: r.authorization, verifier: null, boundAction: BOUND, now: NOW });
    assert.equal(noVerifier.valid, false);
    // A producer that supplies its OWN (foreign) verifier cannot verify the real owner signature.
    const foreign = makeEnv(); // a different owner root => different key
    const selfVerify = makeGrant({ capability: CAP, budgetUnits: 5, authorization: r.authorization, verifier: foreign.verifier, boundAction: BOUND, now: NOW });
    assert.equal(selfVerify.valid, false);
    foreign.cleanup();
  } finally { env.cleanup(); }
});

// ── V6 (was MEDIUM VIOLATION) → now UPHELD: a tenant boundary exists and is enforced. ──
test('[UPHELD] V6 tenant boundary: a cross-tenant grant is refused', () => {
  const env = makeEnv();
  try {
    // authorization minted for tenant TENANT; try to use it under a different tenant.
    const r = realAuthorization(env, { tenant: TENANT, missionId: 'v6' });
    const crossTenant = makeGrant({ capability: CAP, budgetUnits: 5, authorization: r.authorization, verifier: env.verifier, boundAction: { action_type: CAP, resource: RESOURCE, tenant: 'tenant_B' }, now: NOW });
    assert.equal(crossTenant.valid, false); // tenant is bound into the authorization + digest
    // The valid grant carries the tenant via the authorization; a tenant field is now expressible.
    const same = makeGrant({ capability: CAP, budgetUnits: 5, authorization: r.authorization, verifier: env.verifier, boundAction: BOUND, now: NOW });
    assert.equal(same.valid, true);
    assert.equal(r.authorization.tenant, TENANT);
  } finally { env.cleanup(); }
});

// ── V8 (was LOW VIOLATION) → now UPHELD: a grant is no longer replayable by any party. ──
test('[UPHELD] V8 replay: grant_id binds a seat-minted nonce, not caller-reproducible public inputs', () => {
  const env = makeEnv();
  try {
    // Two authorizations for the same action get DIFFERENT nonces (seat-minted), so their grant_ids differ.
    const r1 = realAuthorization(env, { missionId: 'v8a' });
    const r2 = realAuthorization(env, { missionId: 'v8b' });
    assert.notEqual(r1.authorization.nonce, r2.authorization.nonce);
    const g1 = makeGrant({ capability: CAP, budgetUnits: 5, authorization: r1.authorization, verifier: env.verifier, boundAction: BOUND, now: NOW });
    const g2 = makeGrant({ capability: CAP, budgetUnits: 5, authorization: r2.authorization, verifier: env.verifier, boundAction: BOUND, now: NOW });
    assert.equal(g1.valid, true); assert.equal(g2.valid, true);
    assert.notEqual(g1.grant_id, g2.grant_id); // no longer a pure function of public inputs
    // A party cannot reproduce a grant without a seat-minted authorization (there is no issuedBy path).
    const forgedReplay = makeGrant({ capability: CAP, budgetUnits: 5, issuedBy: 'CANA', verifier: env.verifier, boundAction: BOUND, now: NOW });
    assert.equal(forgedReplay.valid, false);
  } finally { env.cleanup(); }
});

// ── qC UPHELD properties must STILL hold (no regression). ──
test('[UPHELD] qC P1: capability containment — no external capability is grantable', () => {
  const env = makeEnv();
  try {
    for (const cap of ['DO_ANYTHING', 'EXFILTRATE', 'ROOT_SHELL', ...OWNER_ONLY]) {
      const r = (() => { try { return realAuthorization(env, { capability: cap, missionId: `p1_${cap}` }); } catch { return { authorization: null }; } })();
      const g = makeGrant({ capability: cap, budgetUnits: 1, authorization: r.authorization, verifier: env.verifier, boundAction: { action_type: cap, resource: RESOURCE, tenant: TENANT }, now: NOW });
      assert.equal(g.valid, false, `capability ${cap} must be refused`);
    }
    assert.ok(Object.isFrozen(CAPABILITIES) && Object.isFrozen(OWNER_ONLY));
  } finally { env.cleanup(); }
});

test('[UPHELD] qC P2: refuse-never-downgrade — an owner-only intent is refused at seal', () => {
  const env = makeEnv();
  try {
    const r = realAuthorization(env, { missionId: 'p2' });
    // Build a valid grant, then attempt an owner-only intent at seal — sealPacket refuses outright.
    const ctxBody = { objective: 'o', actionable_facts: [{ id: 'f1', claim: 'c' }], contradictions: [] };
    const sha = (s) => createHash('sha256').update(s).digest('hex');
    const ctx = { ...ctxBody, packet_digest: sha(JSON.stringify(ctxBody)) };
    const g = makeGrant({ capability: CAP, budgetUnits: 5, authorization: r.authorization, verifier: env.verifier, boundAction: BOUND, now: NOW });
    const sealed = sealPacket({ contextPacket: ctx, grant: g, intent: { description: 'd', capability: 'ACTIVATE_PAYMENT', successTest: 't', rollback: 'r' }, now: NOW });
    assert.equal(sealed.valid, false);
    assert.equal(sealed.packet, null);
    assert.ok(sealed.errors.some((e) => /owner-only/.test(e)));
  } finally { env.cleanup(); }
});
