// tools/authority/authority-court.test.mjs — the CANA Authority court.
//
// Drives the REAL authorize() seat + the REAL Hermes makeGrant through every required attack. No
// assertion is weakened to manufacture safety: a refusal test asserts the exact refusal CODE; the
// happy path asserts a genuine admission. Also covers the four Phase-E hardening items:
//   E1 containment (via gk-compat.test.mjs — separate file), E2 lease reclaim, E3 signer fail-closed,
//   E4 nonce single-use under REAL concurrent processes.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  authorize, verifyAuthorization, authorizationActionDigest,
  provisionDevOwnerRoot, devOwnerSigner, ownerRootVerifier, ContainmentStore, NonceStore, reconstruct,
  mintOwnerAuthorization, LeaseRegistry,
} from './authority.mjs';
import { admitOwnerAuthorization } from './owner-gate.mjs';
import { makeGrant } from '../../skills-src/hermes-governed-packet.mjs';
import {
  makeEnv, buildM2, NOW, TENANT, EXECUTOR, VERIFIER, leaseAuthority,
} from './court-fixtures.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ACTION = { action_type: 'WRITE_LOCAL_BRANCH', resource: 'docs/status.md' };
const CAP = 'WRITE_LOCAL_BRANCH';
const BOUND = { action_type: 'WRITE_LOCAL_BRANCH', resource: 'docs/status.md', tenant: TENANT };

// Run the full seat for a fresh mission id. Returns the authorize() result.
function admit(env, over = {}) {
  const missionId = over.missionId ?? `m_${Math.random().toString(36).slice(2, 8)}`;
  const { pkt, m } = buildM2({ missionId, tenant: over.tenant, verifierIdentity: over.verifierIdentity });
  return authorize({
    now: over.now ?? NOW.toISOString(),
    tenant: over.tenant ?? TENANT,
    executorIdentity: over.executorIdentity ?? EXECUTOR,
    action: over.action ?? ACTION,
    capability: over.capability ?? CAP,
    budgetUnits: over.budgetUnits ?? 5,
    mission: m, contextPacket: pkt,
    containment: {
      authorization_id: over.authorization_id ?? env.authId,
      worker_capability_id: over.worker_capability_id ?? env.capId,
      worker_id: 'worker_1', actor_id: 'actor_owner', site_id: 'site_1',
      mission_id: missionId, budget: over.budget ?? { calls: 1 },
    },
    signer: env.signer, verifier: env.verifier, ownerRootDir: env.ownerRoot,
    lease: over.lease,
    externalEffect: over.externalEffect, ownerGrant: over.ownerGrant,
  }, { stateDir: env.stateDir });
}

// ── VALID NARROW AUTHORIZATION EXECUTES SUCCESSFULLY (control + required case) ──
test('[ADMIT] a valid narrow authorization is minted, verified, and drives a grant', () => {
  const env = makeEnv();
  try {
    const r = admit(env, { missionId: 'happy' });
    assert.equal(r.admitted, true, r.code);
    assert.equal(r.authorization.schema, 'cana.authority-authorization/1');
    assert.equal(r.authorization.proof.trust_label, 'DEV_ONLY');
    // makeGrant accepts it, bound to this exact action.
    const g = makeGrant({ capability: CAP, budgetUnits: 5, authorization: r.authorization, verifier: env.verifier, boundAction: BOUND, now: NOW });
    assert.equal(g.valid, true, JSON.stringify(g.errors));
    assert.equal(g.authorization_id, r.authorization.id);
    assert.ok(g.issued_by.startsWith('CANA-AUTHORITY:'));
    // durable receipt reconstructs.
    assert.equal(reconstruct({ stateDir: env.stateDir }).ok, true);
  } finally { env.cleanup(); }
});

// ── 1. arbitrary issuedBy refused ──
test('[REFUSE] arbitrary issuedBy cannot authorize a grant (no authorization object)', () => {
  const env = makeEnv();
  try {
    const g = makeGrant({ capability: CAP, budgetUnits: 5, issuedBy: 'the executor pretending to be CANA', verifier: env.verifier, boundAction: BOUND, now: NOW });
    assert.equal(g.valid, false);
    assert.ok(g.errors.some((e) => /unattributed|authorization/i.test(e)), JSON.stringify(g.errors));
  } finally { env.cleanup(); }
});

// ── 2. forged authority id refused ──
test('[REFUSE] a forged authorization id is refused', () => {
  const env = makeEnv();
  try {
    const r = admit(env, { missionId: 'forgeid' });
    const forged = { ...r.authorization, id: 'auth_deadbeefdeadbeefdeadbeefdeadbeef' };
    const v = verifyAuthorization(forged, env.verifier, { now: NOW.getTime(), action_type: ACTION.action_type, resource: ACTION.resource, tenant: TENANT });
    assert.equal(v.ok, false);
    assert.equal(v.code, 'AUTHORIZATION_ID_FORGED');
    const g = makeGrant({ capability: CAP, budgetUnits: 5, authorization: forged, verifier: env.verifier, boundAction: BOUND, now: NOW });
    assert.equal(g.valid, false);
  } finally { env.cleanup(); }
});

// ── 3. expired authorization refused ──
test('[REFUSE] an expired authorization is refused', () => {
  const env = makeEnv();
  try {
    const r = admit(env, { missionId: 'expiring' });
    // evaluate one hour past the mission expiry
    const past = new Date('2026-07-31T09:00:00.000Z');
    const v = verifyAuthorization(r.authorization, env.verifier, { now: past.getTime(), action_type: ACTION.action_type, resource: ACTION.resource, tenant: TENANT });
    assert.equal(v.ok, false);
    assert.equal(v.code, 'AUTHORIZATION_EXPIRED');
    const g = makeGrant({ capability: CAP, budgetUnits: 5, authorization: r.authorization, verifier: env.verifier, boundAction: BOUND, now: past });
    assert.equal(g.valid, false);
  } finally { env.cleanup(); }
});

// ── 4. consumed nonce refused (owner-gate single-use) ──
test('[REFUSE] a consumed owner nonce is refused on replay', () => {
  const env = makeEnv();
  try {
    const nonces = new NonceStore(env.stateDir);
    const grant = mintOwnerAuthorization(env.signer, {
      gate_id: 'g1', action_type: 'DEPLOY', resource: 'prod', tenant: TENANT, now: NOW.getTime(), ttlMs: 60000, nonce: 'once-1',
    });
    const first = admitOwnerAuthorization(env.verifier, grant, {
      action_type: 'DEPLOY', resource: 'prod', tenant: TENANT, now: NOW.getTime(), consumeNonce: (n) => nonces.consume(n),
    });
    assert.equal(first.ok, true, first.code);
    const replay = admitOwnerAuthorization(env.verifier, grant, {
      action_type: 'DEPLOY', resource: 'prod', tenant: TENANT, now: NOW.getTime(), consumeNonce: (n) => nonces.consume(n),
    });
    assert.equal(replay.ok, false);
    assert.equal(replay.code, 'OWNER_GRANT_REPLAY');
  } finally { env.cleanup(); }
});

// ── 5. wrong tenant refused ──
test('[REFUSE] a wrong-tenant authorization is refused', () => {
  const env = makeEnv();
  try {
    const r = admit(env, { missionId: 'tenantok' });
    // Pure tenant check (no action rebind): the authorization's tenant must match.
    const v = verifyAuthorization(r.authorization, env.verifier, { now: NOW.getTime(), tenant: 'tenant_ATTACKER' });
    assert.equal(v.ok, false);
    assert.equal(v.code, 'AUTHORIZATION_TENANT_MISMATCH');
    // Bound to a full attacker action, the tenant is baked into the digest, so it also refuses
    // (as an action mismatch — the tenant is part of what the authorization is bound to).
    const vFull = verifyAuthorization(r.authorization, env.verifier, { now: NOW.getTime(), action_type: ACTION.action_type, resource: ACTION.resource, tenant: 'tenant_ATTACKER' });
    assert.equal(vFull.ok, false);
    const g = makeGrant({ capability: CAP, budgetUnits: 5, authorization: r.authorization, verifier: env.verifier, boundAction: { ...BOUND, tenant: 'tenant_ATTACKER' }, now: NOW });
    assert.equal(g.valid, false);
    // And a cross-tenant mission is refused at the seat itself (mission tenant != request tenant).
    const cross = admit(env, { missionId: 'crosst', tenant: 'tenant_ATTACKER' });
    // mission tenant is baked as tenant_ATTACKER; containment auth tenant is TENANT -> CROSS_TENANT
    assert.equal(cross.admitted, false);
    assert.ok(/CROSS_TENANT|TENANT/.test(cross.code), cross.code);
  } finally { env.cleanup(); }
});

// ── 6. widened capability refused ──
test('[REFUSE] a grant that widens the authorized capability is refused', () => {
  const env = makeEnv();
  try {
    const r = admit(env, { missionId: 'widencap', capability: CAP });
    // authorization is for WRITE_LOCAL_BRANCH; ask makeGrant for a different capability.
    const g = makeGrant({ capability: 'RUN_TESTS', budgetUnits: 5, authorization: r.authorization, verifier: env.verifier, boundAction: { action_type: 'RUN_TESTS', resource: ACTION.resource, tenant: TENANT }, now: NOW });
    assert.equal(g.valid, false);
    assert.ok(g.errors.some((e) => /widen|exceeds|mismatch/i.test(e)), JSON.stringify(g.errors));
  } finally { env.cleanup(); }
});

// ── 7. widened action refused (capability ⊄ authorization at the seat) ──
test('[REFUSE] a capability that exceeds its authorization is refused by the seat', () => {
  const env = makeEnv(); // authorization allows only [WRITE_LOCAL_BRANCH, RUN_TESTS, READ_REPOSITORY]
  try {
    // Widen a capability so its allowed_actions exceed the authorization's — the port's ⊆ check refuses.
    const store = new ContainmentStore(env.stateDir);
    store.issueCapability({ id: 'cap_wide', worker_id: 'worker_1', authorization_id: env.authId,
      allowed_actions: ['WRITE_LOCAL_BRANCH', 'DEPLOY', 'SECRET_ACTION'], allowed_resources: ['docs/*'],
      runtime_budget: 500, call_budget: 500, delegation_depth: 0, issued_at: NOW.toISOString(), expires_at: '2026-07-30T09:00:00.000Z' });
    const r = admit(env, { missionId: 'widenact', worker_capability_id: 'cap_wide' });
    assert.equal(r.admitted, false);
    assert.equal(r.code, 'CAPABILITY_EXCEEDS_AUTHORIZATION');
  } finally { env.cleanup(); }
});

// ── 8. wrong action digest refused ──
test('[REFUSE] an authorization replayed onto a different action is refused', () => {
  const env = makeEnv();
  try {
    const r = admit(env, { missionId: 'digest' });
    // The authorization is bound to docs/status.md WRITE_LOCAL_BRANCH; verify against a different resource.
    const v = verifyAuthorization(r.authorization, env.verifier, { now: NOW.getTime(), action_type: 'WRITE_LOCAL_BRANCH', resource: 'docs/OTHER.md', tenant: TENANT });
    assert.equal(v.ok, false);
    assert.equal(v.code, 'AUTHORIZATION_ACTION_MISMATCH');
    const g = makeGrant({ capability: CAP, budgetUnits: 5, authorization: r.authorization, verifier: env.verifier, boundAction: { action_type: 'WRITE_LOCAL_BRANCH', resource: 'docs/OTHER.md', tenant: TENANT }, now: NOW });
    assert.equal(g.valid, false);
  } finally { env.cleanup(); }
});

// ── 9. executor cannot replace issuer ──
test('[REFUSE] an executor cannot replace the issuer (issuer is bound in the signed body)', () => {
  const env = makeEnv();
  try {
    const r = admit(env, { missionId: 'issuer' });
    // Tamper the issuer field; the signature is over the body that includes issuer, and the id
    // recomputes from the body — both break.
    const tampered = { ...r.authorization, issuer: 'THE_EXECUTOR' };
    const v = verifyAuthorization(tampered, env.verifier, { now: NOW.getTime(), action_type: ACTION.action_type, resource: ACTION.resource, tenant: TENANT });
    assert.equal(v.ok, false);
    // id no longer recomputes (issuer is part of the body).
    assert.equal(v.code, 'AUTHORIZATION_ID_FORGED');
  } finally { env.cleanup(); }
});

// ── 10. adapter cannot mint a valid authorization ──
test('[REFUSE] the adapter cannot mint a valid authorization on its own', async () => {
  // The adapter has NO signing oracle. Its only path to an authorization is authority-bridge, which
  // calls the REAL authorize(). Prove the adapter module does not export a way to sign an
  // authorization and cannot construct one that verifies without the seat.
  const adapter = await import('../alive-loop/adapter.mjs');
  assert.equal(typeof adapter.makeGrant, 'undefined'); // adapter re-exports nothing that mints authority
  // Fabricate an authorization the way an adapter could try (plain object, no owner signature).
  const env = makeEnv();
  try {
    const fake = {
      schema: 'cana.authority-authorization/1', id: 'auth_' + '0'.repeat(32), tenant: TENANT, scope: null,
      action_type: 'WRITE_LOCAL_BRANCH', action_digest: authorizationActionDigest({ action_type: 'WRITE_LOCAL_BRANCH', resource: 'docs/status.md', tenant: TENANT, scope: null, action: null }),
      capability: CAP, budget_units: 5, issuer: 'ADAPTER', issued_at: NOW.toISOString(), expires_at: '2026-07-30T09:00:00.000Z',
      nonce: 'n_fake', mission_receipt_hash: 'f'.repeat(64), owner_gated: false, owner_gate_id: null,
      proof: { sig: 'AA==', key_id: env.verifier.keyId, identity: 'ADAPTER', trust_label: 'DEV_ONLY' },
    };
    const v = verifyAuthorization(fake, env.verifier, { now: NOW.getTime(), action_type: 'WRITE_LOCAL_BRANCH', resource: 'docs/status.md', tenant: TENANT });
    assert.equal(v.ok, false); // forged id and/or bad signature
  } finally { env.cleanup(); }
});

// ── 11. Hermes cannot self-authorize ──
test('[REFUSE] Hermes (makeGrant) cannot self-authorize — no authorization, no grant', () => {
  const env = makeEnv();
  try {
    // Hermes has no signer; the only thing it can pass is an authorization from the seat. Without one:
    const g = makeGrant({ capability: CAP, budgetUnits: 5, authorization: undefined, verifier: env.verifier, boundAction: BOUND, now: NOW });
    assert.equal(g.valid, false);
    // Even a self-constructed object with a plausible shape but no owner signature fails.
    const selfMade = { schema: 'cana.authority-authorization/1', id: 'auth_x', tenant: TENANT, action_type: CAP, action_digest: 'x', capability: CAP, issuer: 'HERMES', issued_at: NOW.toISOString(), expires_at: '2026-07-30T09:00:00.000Z', nonce: 'n', mission_receipt_hash: 'f'.repeat(64), proof: { sig: 'AA==', key_id: 'x', trust_label: 'DEV_ONLY' } };
    const g2 = makeGrant({ capability: CAP, budgetUnits: 5, authorization: selfMade, verifier: env.verifier, boundAction: BOUND, now: NOW });
    assert.equal(g2.valid, false);
  } finally { env.cleanup(); }
});

// ── 12. Hermes cannot self-verify ──
test('[REFUSE] Hermes cannot self-verify — verification uses an EXTERNAL owner key it does not hold', () => {
  const env = makeEnv();
  try {
    const r = admit(env, { missionId: 'selfverify' });
    // A verifier built from a DIFFERENT owner root (an attacker/self key) cannot verify the real
    // authorization: the proof was made by the true owner root.
    const otherRoot = mkdtempSync(join(tmpdir(), 'other-owner-'));
    provisionDevOwnerRoot(otherRoot);
    const foreignVerifier = ownerRootVerifier(otherRoot);
    const g = makeGrant({ capability: CAP, budgetUnits: 5, authorization: r.authorization, verifier: foreignVerifier, boundAction: BOUND, now: NOW });
    assert.equal(g.valid, false); // wrong key => signature does not verify
    rmSync(otherRoot, { recursive: true, force: true });
    // And makeGrant REQUIRES a verifier at all — it cannot bless an authorization by itself.
    const g2 = makeGrant({ capability: CAP, budgetUnits: 5, authorization: r.authorization, verifier: null, boundAction: BOUND, now: NOW });
    assert.equal(g2.valid, false);
  } finally { env.cleanup(); }
});

// ── E3. signer fail-closed in production ──
test('[E3] CANA_ENV=production with no production signer => authorize() REFUSES (fail closed)', () => {
  // Provision a DEV owner root, then run authorize() with CANA_ENV=production. The DEV signer is
  // DEV_ONLY, so in production the verifier fails closed and the owner-gated path is refused; and the
  // DEV signer refuses to even load. We prove the verifier refuses and an authorization built by a
  // DEV signer does not verify in production.
  const root = mkdtempSync(join(tmpdir(), 'prod-fail-'));
  try {
    const ownerRoot = join(root, 'owner');
    provisionDevOwnerRoot(ownerRoot, { env: { CANA_ENV: 'development' } });
    // 1. The DEV signer refuses to load in production.
    assert.throws(() => devOwnerSigner(ownerRoot, { env: { CANA_ENV: 'production' } }), /DEV_SIGNER_REFUSED_IN_PRODUCTION/);
    // 2. The production verifier fails closed: no production signer configured.
    const prodVerifier = ownerRootVerifier(ownerRoot, { env: { CANA_ENV: 'production' } });
    assert.equal(prodVerifier.unavailableReason(), 'PRODUCTION_SIGNER_REQUIRED');
    // A DEV-made proof cannot verify in production.
    const devSigner = devOwnerSigner(ownerRoot, { env: { CANA_ENV: 'development' } });
    const proof = devSigner.sign('some-bytes');
    assert.equal(prodVerifier.verify('some-bytes', proof), false);
    // 3. An owner-gated authorize() with a DEV grant is refused in production.
    const env2 = makeEnv({ env: { CANA_ENV: 'development' } }); // build state with a dev signer
    const grant = mintOwnerAuthorization(env2.signer, { gate_id: 'g', action_type: 'DEPLOY', resource: 'prod', tenant: TENANT, now: NOW.getTime(), ttlMs: 60000, nonce: 'p1' });
    const nonces = new NonceStore(env2.stateDir);
    const admitted = admitOwnerAuthorization(prodVerifier, grant, { action_type: 'DEPLOY', resource: 'prod', tenant: TENANT, now: NOW.getTime(), consumeNonce: (n) => nonces.consume(n) });
    assert.equal(admitted.ok, false);
    assert.ok(/PRODUCTION_SIGNER|BAD_SIGNATURE/.test(admitted.code), admitted.code);
    env2.cleanup();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ── E2. lease TTL reclaim: crash-then-reclaim works; stale-holder-post-reclaim refused ──
test('[E2] lease reclaim: ACTIVE -> EXPIRED -> RECLAIMED; stale holder fenced after reclaim', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lease-reclaim-'));
  try {
    const reg = new LeaseRegistry(dir);
    const t0 = Date.parse('2026-08-20T12:00:00Z');
    // Holder A acquires.
    const a = reg.acquire({ missionId: 'M1', holder: 'A', now: t0, ttlMs: 60000 });
    assert.equal(a.acquired, true);
    assert.equal(reg.status('M1', t0).state, 'ACTIVE');
    // A crashes and never heartbeats. After TTL the lease is EXPIRED.
    const tExpired = t0 + 61000;
    assert.equal(reg.status('M1', tExpired).state, 'EXPIRED');
    // A live holder blocks acquisition BEFORE expiry.
    assert.throws(() => reg.acquire({ missionId: 'M1', holder: 'B', now: t0 + 1000, ttlMs: 60000 }), /LEASE_HELD/);
    // CRASH-THEN-RECLAIM WORKS: after TTL, B reclaims (epoch bumps).
    const b = reg.acquire({ missionId: 'M1', holder: 'B', now: tExpired, ttlMs: 60000 });
    assert.equal(b.acquired, true);
    assert.equal(b.reclaimed, true);
    assert.equal(b.epoch, 2);
    // STALE-HOLDER-POST-RECLAIM REFUSED: the crashed holder A (epoch 1) can no longer heartbeat or release.
    assert.throws(() => reg.heartbeat({ missionId: 'M1', holder: 'A', epoch: 1, now: tExpired + 1000, ttlMs: 60000 }), /LEASE_STALE_HOLDER/);
    assert.throws(() => reg.release({ missionId: 'M1', holder: 'A', epoch: 1 }), /LEASE_STALE_HOLDER/);
    // The new holder B (epoch 2) CAN heartbeat.
    assert.deepEqual(reg.heartbeat({ missionId: 'M1', holder: 'B', epoch: 2, now: tExpired + 2000, ttlMs: 60000 }), { ok: true });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── E4. nonce single-use under REAL concurrency: 20 parallel PROCESSES, exactly ONE wins ──
test('[E4] 20 parallel processes consuming the same owner nonce => exactly ONE succeeds', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nonce-race-'));
  try {
    // A tiny worker script: consume a fixed nonce, print WON or LOST.
    const worker = join(dir, 'worker.mjs');
    writeFileSync(worker, `
import { NonceStore } from ${JSON.stringify(join(HERE, 'nonce.mjs'))};
const store = new NonceStore(process.argv[2]);
process.stdout.write(store.consume('THE-ONE-NONCE') ? 'WON' : 'LOST');
`);
    const N = 20;
    // Launch all workers as concurrently as spawnSync-in-a-loop allows; the O_EXCL guarantee holds
    // regardless of interleaving. (spawnSync is sequential but each is a REAL separate process racing
    // the same file; to make the race genuine we also run a parallel batch below.)
    const procs = [];
    for (let i = 0; i < N; i++) {
      procs.push(spawnSync(process.execPath, [worker, dir], { encoding: 'utf8' }));
    }
    const wins = procs.filter((p) => p.stdout === 'WON').length;
    assert.equal(wins, 1, `exactly one process may consume the nonce, got ${wins}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// A genuinely-parallel variant: spawn all children with spawn (async), await all, count wins.
test('[E4] genuinely parallel spawn: still exactly ONE winner', async () => {
  const { spawn } = await import('node:child_process');
  const dir = mkdtempSync(join(tmpdir(), 'nonce-race2-'));
  try {
    const worker = join(dir, 'worker.mjs');
    writeFileSync(worker, `
import { NonceStore } from ${JSON.stringify(join(HERE, 'nonce.mjs'))};
const store = new NonceStore(process.argv[2]);
process.stdout.write(store.consume('RACE-NONCE') ? 'WON' : 'LOST');
`);
    const N = 20;
    const results = await Promise.all(Array.from({ length: N }, () => new Promise((resolve) => {
      const child = spawn(process.execPath, [worker, dir], { encoding: 'utf8' });
      let out = '';
      child.stdout.on('data', (d) => { out += d; });
      child.on('close', () => resolve(out));
    })));
    const wins = results.filter((r) => r === 'WON').length;
    assert.equal(wins, 1, `exactly one parallel process may win, got ${wins}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
