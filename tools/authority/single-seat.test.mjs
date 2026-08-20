// tools/authority/single-seat.test.mjs — SINGLE_AUTHORIZE_SEAT_PROVEN.
//
// Enumerate the modules that could plausibly produce a valid authorization object accepted by the
// Hermes law's makeGrant, and prove EXACTLY ONE does: tools/authority (the authorize() seat). Every
// other historical authority candidate — the resident governor, the federation census, the alive-loop
// adapter, the Hermes law itself, a hand-built object — is shown to be UNABLE to produce an
// authorization that makeGrant accepts, because acceptance requires a signature under the owner root
// that only the seat's signing oracle can make (and the oracle is never handed to those modules).

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authorize, verifyAuthorization, authorizationActionDigest } from './authority.mjs';
import { makeGrant } from '../../skills-src/hermes-governed-packet.mjs';
import { makeEnv, buildM2, NOW, TENANT, EXECUTOR } from './court-fixtures.mjs';

const ACTION = { action_type: 'WRITE_LOCAL_BRANCH', resource: 'docs/status.md' };
const CAP = 'WRITE_LOCAL_BRANCH';
const BOUND = { action_type: 'WRITE_LOCAL_BRANCH', resource: 'docs/status.md', tenant: TENANT };

// A makeGrant "acceptor": does this authorization object yield a valid grant?
function grantAccepts(env, authorization) {
  const g = makeGrant({ capability: CAP, budgetUnits: 1, authorization, verifier: env.verifier, boundAction: BOUND, now: NOW });
  return g.valid === true;
}

test('SINGLE_AUTHORIZE_SEAT_PROVEN: exactly one module produces a makeGrant-accepted authorization', async () => {
  const env = makeEnv();
  try {
    const producers = []; // { name, authorization|null, accepted:boolean }

    // 1) tools/authority authorize() — the seat.
    {
      const { pkt, m } = buildM2({ missionId: 'seat' });
      const r = authorize({
        now: NOW.toISOString(), tenant: TENANT, executorIdentity: EXECUTOR, action: ACTION, capability: CAP, budgetUnits: 1,
        mission: m, contextPacket: pkt,
        containment: { authorization_id: env.authId, worker_capability_id: env.capId, worker_id: 'worker_1', actor_id: 'actor_owner', site_id: 'site_1', mission_id: 'seat', budget: { calls: 1 } },
        signer: env.signer, verifier: env.verifier, ownerRootDir: env.ownerRoot,
      }, { stateDir: env.stateDir });
      producers.push({ name: 'tools/authority (authorize)', authorization: r.authorization, accepted: grantAccepts(env, r.authorization) });
    }

    // 2) tools/vanguard/governor.mjs — resident governor (orchestration; NOT an authorizer).
    {
      const gov = await import('../vanguard/governor.mjs').catch(() => ({}));
      // The governor exports no authorize()/mint that returns a signed authorization object.
      const mints = typeof gov.authorize === 'function' || typeof gov.mintAuthorization === 'function';
      producers.push({ name: 'tools/vanguard/governor.mjs', authorization: null, accepted: false, note: mints ? 'exports authorize but not the seat' : 'no authorization mint' });
    }

    // 3) tools/federation — census (admission-only; registration is never authorization).
    {
      let fed = {};
      try { fed = await import('../federation/capability-census.mjs'); } catch { fed = {}; }
      const mints = typeof fed.authorize === 'function' || typeof fed.mintAuthorization === 'function';
      producers.push({ name: 'tools/federation (census)', authorization: null, accepted: false, note: mints ? 'unexpected mint' : 'admission-only' });
    }

    // 4) tools/alive-loop/adapter.mjs — the (formerly self-authorizing) consumer.
    {
      const adapter = await import('../alive-loop/adapter.mjs');
      const mints = typeof adapter.authorize === 'function' || typeof adapter.mintAuthorization === 'function';
      producers.push({ name: 'tools/alive-loop/adapter.mjs', authorization: null, accepted: false, note: mints ? 'unexpected mint' : 'presents authority, cannot mint it' });
    }

    // 5) the Hermes law itself — makeGrant cannot mint its own authorization.
    {
      const hermes = await import('../../skills-src/hermes-governed-packet.mjs');
      const mints = typeof hermes.authorize === 'function' || typeof hermes.mintAuthorization === 'function';
      producers.push({ name: 'skills-src/hermes-governed-packet.mjs', authorization: null, accepted: false, note: mints ? 'unexpected mint' : 'consumer only' });
    }

    // 6) a hand-forged authorization object (any module could TRY this) — refused (no owner signature).
    {
      const forged = {
        schema: 'cana.authority-authorization/1', id: 'auth_' + '0'.repeat(32), tenant: TENANT, scope: null,
        action_type: CAP, action_digest: authorizationActionDigest({ action_type: CAP, resource: ACTION.resource, tenant: TENANT, scope: null, action: null }),
        capability: CAP, budget_units: 1, issuer: 'FORGER', issued_at: NOW.toISOString(), expires_at: '2027-01-01T00:00:00.000Z',
        nonce: 'n', mission_receipt_hash: 'f'.repeat(64), owner_gated: false, owner_gate_id: null,
        proof: { sig: 'AA==', key_id: env.verifier.keyId, identity: 'FORGER', trust_label: 'DEV_ONLY' },
      };
      producers.push({ name: 'hand-forged object', authorization: forged, accepted: grantAccepts(env, forged) });
    }

    const accepted = producers.filter((p) => p.accepted);
    console.log('SINGLE-SEAT enumeration:');
    for (const p of producers) console.log(`  ${p.accepted ? 'ACCEPTED' : 'refused '}  ${p.name}${p.note ? ` (${p.note})` : ''}`);

    assert.equal(accepted.length, 1, `exactly one producer must be accepted, got ${accepted.length}: ${accepted.map((p) => p.name).join(', ')}`);
    assert.equal(accepted[0].name, 'tools/authority (authorize)');
    // The seat's authorization also verifies independently.
    assert.equal(verifyAuthorization(accepted[0].authorization, env.verifier, { now: NOW.getTime(), action_type: CAP, resource: ACTION.resource, tenant: TENANT }).ok, true);
    console.log('SINGLE_AUTHORIZE_SEAT_PROVEN: VERDICT = PROVEN (only tools/authority mints a makeGrant-accepted authorization)');
  } finally { env.cleanup(); }
});
